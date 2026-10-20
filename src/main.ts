import { play, setBed, setMuted, unlock } from "./audio";
import { PLAYER_H, PLAYER_W, STEP, VIEW_H, VIEW_W } from "./constants";
import { absorb, createFx, openIris, tickFx } from "./fx";
import { levelById } from "./levels";
import {
  NODES,
  derive,
  noteClear,
  pickNeighbor,
  resumeNode,
  type NodeId,
  type Progress,
} from "./map";
import { draw, type Scene } from "./render";
import { createWorld, step, type Input, type World } from "./sim";

type Save = {
  cleared: string[];
  secrets: string[];
  coins: string[];
  mute: boolean;
};

type MapAnim = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  dest: NodeId;
  t: number;
  dur: number;
};

const SAVE_KEY = "kiln-save-v1";

function emptySave(): Save {
  return { cleared: [], secrets: [], coins: [], mute: false };
}

function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as Partial<Save>;
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
    return {
      cleared: strings(parsed.cleared),
      secrets: strings(parsed.secrets),
      coins: strings(parsed.coins),
      mute: parsed.mute === true,
    };
  } catch {
    return emptySave();
  }
}

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  const status = document.querySelector<HTMLElement>("#status");
  if (!canvas || !status) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const save = loadSave();
  setMuted(save.mute);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  const chamber = params.get("chamber");

  let progress: Progress = derive(save.cleared, save.secrets);
  let mode: "title" | "map" | "play" | "pause" | "won" = chamber && levelById[chamber] ? "play" : "title";
  let node: NodeId = resumeNode(progress);
  let token: { x: number; y: number } = { x: NODES[node].x, y: NODES[node].y };
  let mapAnim: MapAnim | null = null;
  let world: World | null = chamber && levelById[chamber] ? createWorld(levelById[chamber], new Set(save.coins)) : null;
  if (world && chamber && chamber in NODES) node = chamber as NodeId;
  let banner = "";
  let bannerLeft = 0;
  let outcome: "cleared" | "secret" | null = null;
  let resetArm = 0;
  let clock = 0;
  const fx = createFx();
  const BANNER = 1.15;

  const keys = new Set<string>();
  const touch = new Set<string>();
  let jumpEdge = false;
  let placeEdge = false;
  let rEdge = false;
  let dirEdge: { x: number; y: number } | null = null;

  const persist = () => localStorage.setItem(SAVE_KEY, JSON.stringify(save));

  const say = (text: string) => {
    if (status.textContent !== text) status.textContent = text;
  };

  const irisOnPlayer = (w: World) => {
    openIris(fx, w.player.x + PLAYER_W / 2 - w.camX, w.player.y + PLAYER_H / 2, reduced);
  };
  const irisOnToken = () => openIris(fx, token.x, token.y - 14, reduced);

  const enter = (id: NodeId) => {
    const level = levelById[id];
    if (!level) return;
    world = createWorld(level, new Set(save.coins));
    node = id;
    mode = "play";
    banner = "";
    bannerLeft = 0;
    outcome = null;
    if (world) irisOnPlayer(world);
    say(`${level.name}. ${level.hint}`);
  };

  const finishChamber = () => {
    const secret = outcome === "secret";
    progress = noteClear(progress, node, secret);
    save.cleared = progress.cleared;
    save.secrets = progress.secrets;
    persist();
    banner = "";
    bannerLeft = 0;
    outcome = null;
    world = null;
    token = { x: NODES[node].x, y: NODES[node].y };
    mapAnim = null;
    if (node === "kiln" && !secret) {
      mode = "won";
      openIris(fx, VIEW_W / 2, 150, reduced);
      say("The kiln stays lit. Jump returns to the flue.");
      return;
    }
    mode = "map";
    irisOnToken();
    say(`The flue. ${NODES[node].name} is lit.`);
  };

  const readInput = (): Input => ({
    left: keys.has("ArrowLeft") || keys.has("KeyA") || touch.has("left"),
    right: keys.has("ArrowRight") || keys.has("KeyD") || touch.has("right"),
    jumpPressed: jumpEdge,
    jumpHeld:
      keys.has("Space") ||
      keys.has("KeyZ") ||
      keys.has("ArrowUp") ||
      keys.has("KeyW") ||
      touch.has("jump"),
    placePressed: placeEdge,
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    keys.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    if (event.code === "Space" || event.code === "KeyZ" || event.code === "KeyW" || event.code === "ArrowUp") {
      jumpEdge = true;
    }
    if (event.code === "KeyX" || event.code === "KeyJ" || event.code === "ShiftLeft" || event.code === "ShiftRight") {
      placeEdge = true;
    }
    if (event.code === "ArrowLeft" || event.code === "KeyA") dirEdge = { x: -1, y: 0 };
    if (event.code === "ArrowRight" || event.code === "KeyD") dirEdge = { x: 1, y: 0 };
    if (event.code === "ArrowUp" || event.code === "KeyW") dirEdge = { x: 0, y: -1 };
    if (event.code === "ArrowDown" || event.code === "KeyS") dirEdge = { x: 0, y: 1 };
    if (event.code === "KeyR") rEdge = true;
    if (event.code === "KeyM") {
      save.mute = !save.mute;
      setMuted(save.mute);
      persist();
    }
    unlock();
    if (event.code === "Escape" && mode === "play") mode = "pause";
    else if (event.code === "Escape" && mode === "pause") mode = "play";
    canvas.focus();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.code);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerdown", () => unlock());

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-k]"))) {
    const name = button.dataset.k ?? "";
    const press = (event: PointerEvent) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      touch.add(name);
      if (name === "jump") jumpEdge = true;
      if (name === "place") placeEdge = true;
    if (name === "left") dirEdge = { x: -1, y: 0 };
    if (name === "right") dirEdge = { x: 1, y: 0 };
    if (name === "up") {
      dirEdge = { x: 0, y: -1 };
      jumpEdge = true;
    }
    if (name === "down") dirEdge = { x: 0, y: 1 };
      unlock();
      canvas.focus();
    };
    const release = () => touch.delete(name);
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
  }

  // Faint CRT rows, one dark line per game pixel, only once pixels are big enough to read them.
  let scanlines: CanvasPattern | null = null;
  const fit = () => {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, (window.innerHeight - 8) / VIEW_H)));
    canvas.width = VIEW_W * scale;
    canvas.height = VIEW_H * scale;
    canvas.style.width = `${VIEW_W * scale}px`;
    canvas.style.height = `${VIEW_H * scale}px`;
    scanlines = null;
    if (scale >= 3) {
      const tile = document.createElement("canvas");
      tile.width = 1;
      tile.height = scale;
      const tctx = tile.getContext("2d");
      if (tctx) {
        tctx.fillStyle = "rgba(0,0,0,0.16)";
        tctx.fillRect(0, scale - 1, 1, 1);
        scanlines = ctx.createPattern(tile, "repeat");
      }
    }
  };
  fit();
  window.addEventListener("resize", fit);
  canvas.focus();

  if (mode === "title") say("Kiln. Jump to start. Arrows move, Z jumps, X sets a brick, R restarts.");
  if (mode === "play" && world) say(`${world.level.name}. ${world.level.hint}`);

  let last = performance.now();
  let acc = 0;
  let frame = 0;

  const tick = (dt: number) => {
    clock += dt;
    resetArm = Math.max(0, resetArm - dt);
    const input = readInput();

    tickFx(fx, mode === "play" ? world : null, dt, reduced);

    if (mode === "title" && input.jumpPressed) {
      mode = "map";
      irisOnToken();
      say("The flue. Jump enters a chamber.");
      play("lock");
    } else if (mode === "won" && input.jumpPressed) {
      mode = "map";
      irisOnToken();
      say("The flue.");
    } else if ((mode === "play" || mode === "pause") && world && rEdge) {
      const level = world.level;
      world = createWorld(level, new Set(save.coins));
      mode = "play";
      banner = "";
      bannerLeft = 0;
      outcome = null;
      irisOnPlayer(world);
      say(`${level.name}. ${level.hint}`);
    } else if (mode === "pause") {
      say("Paused. Jump continues. R restarts. X leaves the chamber.");
      if (input.jumpPressed) mode = "play";
      if (input.placePressed && world) {
        mode = "map";
        world = null;
        token = { x: NODES[node].x, y: NODES[node].y };
        irisOnToken();
        say(`The flue. Left ${NODES[node].name}.`);
      }
    } else if (mode === "map") {
      if (mapAnim) {
        mapAnim.t += dt;
        const t = mapAnim.dur <= 0 ? 1 : Math.min(1, mapAnim.t / mapAnim.dur);
        token = {
          x: mapAnim.fromX + (mapAnim.toX - mapAnim.fromX) * t,
          y: mapAnim.fromY + (mapAnim.toY - mapAnim.fromY) * t,
        };
        if (t >= 1) {
          node = mapAnim.dest;
          token = { x: mapAnim.toX, y: mapAnim.toY };
          mapAnim = null;
        }
      } else if (dirEdge) {
        const next = pickNeighbor(node, dirEdge.x, dirEdge.y, progress);
        if (next) {
          const dest = NODES[next];
          const dur = reduced ? 0 : Math.hypot(dest.x - token.x, dest.y - token.y) / 160;
          mapAnim = { fromX: token.x, fromY: token.y, toX: dest.x, toY: dest.y, dest: next, t: 0, dur };
          play("bump");
        }
      }
      if (input.jumpPressed && !mapAnim && progress.unlocked.includes(node)) {
        enter(node);
        play("jump");
      }
      if (rEdge) {
        if (resetArm > 0) {
          save.cleared = [];
          save.secrets = [];
          save.coins = [];
          persist();
          progress = derive([], []);
          node = "kindling";
          token = { x: NODES.kindling.x, y: NODES.kindling.y };
          mapAnim = null;
          resetArm = 0;
          say("The flue is cold again.");
        } else {
          resetArm = 1.2;
          say("Press R again to reset the flue.");
        }
      }
    } else if (mode === "play" && world && fx.freeze > 0) {
      // Hit-stop: hold the frame for a beat on heavy impacts.
      fx.freeze -= dt;
    } else if (mode === "play" && world) {
      step(world, input, dt);
      for (const event of world.events) {
        if (event.t === "coin" && !save.coins.includes(event.key)) {
          save.coins.push(event.key);
          persist();
        }
        play(event.t, absorb(fx, world, event, reduced));
        if (event.t === "exit" || event.t === "secret") {
          outcome = event.t === "secret" ? "secret" : "cleared";
          banner = event.t === "secret" ? "A side flue opens" : `${world.level.name} lit`;
          bannerLeft = BANNER;
        }
      }
      if (bannerLeft > 0) {
        bannerLeft -= dt;
        if (bannerLeft <= 0 && outcome) finishChamber();
      }
    }

    setBed(mode === "play" || mode === "pause" ? "chamber" : "hearth");

    jumpEdge = false;
    placeEdge = false;
    rEdge = false;
    dirEdge = null;
  };

  const frameLoop = (now: number) => {
    frame = requestAnimationFrame(frameLoop);
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      tick(STEP);
      acc -= STEP;
    }
    const scale = canvas.width / VIEW_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const scene: Scene =
      mode === "title"
        ? { kind: "title", time: clock, reduced }
        : mode === "won"
          ? { kind: "won", time: clock, reduced }
          : mode === "map"
            ? {
                kind: "map",
                time: clock,
                reduced,
                progress,
                pos: token,
                coins: save.coins.length,
                mute: save.mute,
              }
            : {
                kind: "play",
                world: world ?? createWorld(levelById.kindling!, new Set(save.coins)),
                reduced,
                banner: bannerLeft > 0 ? banner : null,
                bannerT: BANNER - bannerLeft,
                paused: mode === "pause",
              };
    draw(ctx, scene, fx);
    if (scanlines) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = scanlines;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  frame = requestAnimationFrame(frameLoop);
  void frame;
}

boot();
