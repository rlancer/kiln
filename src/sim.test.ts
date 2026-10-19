import { expect, test } from "bun:test";
import { PLAYER_H, PLAYER_W, STEP, TILE } from "./constants";
import { LEVELS, levelById, type Level } from "./levels";
import { derive, isVisible, noteClear, pickNeighbor } from "./map";
import { createWorld, placeTarget, step, type Input, type World } from "./sim";

const hold: Input = {
  left: false,
  right: false,
  jumpPressed: false,
  jumpHeld: false,
  placePressed: false,
};

function frames(world: World, count: number, input: Input = hold): void {
  for (let i = 0; i < count; i++) step(world, input, STEP);
}

function gapLevel(emptyTiles: number): Level {
  const width = 32;
  const floor = Array<string>(width).fill("#");
  for (let i = 0; i < emptyTiles; i++) floor[10 + i] = ".";
  const rows = Array.from({ length: 15 }, () => ".".repeat(width));
  rows[12] = `${".".repeat(2)}p${".".repeat(21)}x${".".repeat(7)}`;
  rows[13] = floor.join("");
  rows[14] = floor.join("");
  return { id: "gap", name: "Gap", hint: "", heat: 0, width, height: 15, rows };
}

function solidAt(world: World, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= world.level.width || ty >= world.level.height) return false;
  if (world.bricks.some((brick) => brick.tx === tx && brick.ty === ty)) return true;
  const ch = world.level.rows[ty]![tx]!;
  return ch === "#" || ch === "?";
}

function pilotGap(emptyTiles: number, withLipBrick: boolean): string {
  const world = createWorld(gapLevel(emptyTiles));
  if (withLipBrick) world.bricks.push({ tx: 10, ty: 13, ttl: 99, locked: true });
  let jumpLock = 0;
  for (let i = 0; i < 520; i++) {
    jumpLock = Math.max(0, jumpLock - 1);
    const ahead = world.player.x + PLAYER_W + 2;
    const feet = world.player.y + PLAYER_H + 2;
    const atLip = world.player.grounded && !solidAt(world, ahead, feet);
    const input: Input = {
      left: false,
      right: true,
      jumpPressed: atLip && jumpLock === 0,
      jumpHeld: true,
      placePressed: false,
    };
    if (input.jumpPressed) jumpLock = 18;
    step(world, input, STEP);
    if (world.status === "dead") return "dead";
    const far = (10 + emptyTiles) * TILE;
    if (world.player.grounded && world.player.x + PLAYER_W > far + 4) return "crossed";
  }
  return `stuck x=${world.player.x.toFixed(1)} y=${world.player.y.toFixed(1)}`;
}

test("campaign rooms are well formed", () => {
  const ids = LEVELS.map((level) => level.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const level of LEVELS) {
    expect(level.rows).toHaveLength(15);
    for (const row of level.rows) expect(row).toHaveLength(level.width);
    const text = level.rows.join("");
    expect(text.split("p").length - 1).toBe(1);
    expect(text.split("x").length - 1).toBe(1);
  }
  expect(levelById.twin!.rows.join("")).toContain("z");
  const bellows = levelById.bellows!.rows.join("");
  expect(bellows).toContain("z");
  expect(bellows).toContain("*");
  expect(bellows).toContain("G");
  const draft = levelById.draft!.rows.join("");
  expect(draft).toContain("=");
  expect(draft).toContain("w");
});

test("a full jump rises about three and a half tiles", () => {
  const world = createWorld(levelById.kindling!);
  const start = world.player.y;
  frames(world, 1, { ...hold, jumpPressed: true, jumpHeld: true });
  let peak = world.player.y;
  for (let i = 0; i < 80 && world.player.vy < 0; i++) {
    step(world, { ...hold, jumpHeld: true }, STEP);
    peak = Math.min(peak, world.player.y);
  }
  const rise = start - peak;
  if (rise < 50 || rise > 62) throw new Error(`jump rose ${rise.toFixed(2)}px`);
});

test("a tap jump is much shorter", () => {
  const world = createWorld(levelById.kindling!);
  const start = world.player.y;
  frames(world, 1, { ...hold, jumpPressed: true, jumpHeld: false });
  let peak = world.player.y;
  for (let i = 0; i < 40 && world.player.vy <= 0; i++) {
    step(world, hold, STEP);
    peak = Math.min(peak, world.player.y);
  }
  const rise = start - peak;
  if (rise < 8 || rise > 24) throw new Error(`tap jump rose ${rise.toFixed(2)}px`);
});

test("three tiles is a running jump and four is not", () => {
  expect(pilotGap(3, false)).toBe("crossed");
  expect(pilotGap(4, false)).toBe("dead");
  expect(pilotGap(4, true)).toBe("crossed");
});

test("a cracked brick fills empty hands once", () => {
  const world = createWorld(levelById.kindling!);
  world.player.x = 6 * TILE + 2;
  world.player.y = 11 * TILE;
  world.player.vy = -280;
  world.player.grounded = false;
  frames(world, 20, { ...hold, jumpHeld: true });
  expect(world.player.holding).toBe(true);

  world.player.holding = true;
  world.player.y = 11 * TILE;
  world.player.vy = -280;
  world.bumps.clear();
  frames(world, 20, { ...hold, jumpHeld: true });
  expect(world.player.holding).toBe(true);
});

test("the lip mark locks and a loose brick cools", () => {
  const world = createWorld(levelById.kindling!);
  world.player.x = 11 * TILE + 2;
  world.player.y = 13 * TILE - PLAYER_H;
  world.player.facing = 1;
  world.player.holding = true;
  expect(placeTarget(world)).toEqual({ tx: 12, ty: 13 });
  step(world, { ...hold, placePressed: true }, STEP);
  expect(world.bricks.some((brick) => brick.tx === 12 && brick.ty === 13 && brick.locked)).toBe(true);
  frames(world, 12 * 60);
  expect(world.bricks.some((brick) => brick.locked)).toBe(true);

  const loose = createWorld(levelById.cinder!);
  loose.player.x = 13 * TILE + 2;
  loose.player.y = 13 * TILE - PLAYER_H;
  loose.player.facing = 1;
  loose.player.holding = true;
  const target = placeTarget(loose);
  expect(target?.ty).toBe(13);
  step(loose, { ...hold, placePressed: true }, STEP);
  expect(loose.bricks[0]?.locked).toBe(false);
  frames(loose, 8 * 60);
  expect(loose.bricks).toHaveLength(0);
});

test("a wall mark is the step in front of the ledge", () => {
  const world = createWorld(levelById.hearth!);
  world.player.x = 38 * TILE + 2;
  world.player.y = 13 * TILE - PLAYER_H;
  world.player.facing = 1;
  world.player.holding = true;
  expect(placeTarget(world)).toEqual({ tx: 39, ty: 12 });
});

test("stomping lives and walking into a patrol dies", () => {
  const world = createWorld(levelById.patrol!);
  const enemy = world.enemies[0]!;
  world.player.x = enemy.x;
  world.player.y = enemy.y - PLAYER_H - 2;
  world.player.vy = 180;
  world.player.grounded = false;
  frames(world, 8);
  expect(world.status).toBe("play");
  expect(world.enemies.some((item) => !item.alive)).toBe(true);

  const side = createWorld(levelById.patrol!);
  const other = side.enemies[0]!;
  side.player.x = other.x;
  side.player.y = 13 * TILE - PLAYER_H;
  side.player.vy = 0;
  side.player.grounded = true;
  step(side, hold, STEP);
  expect(side.status).toBe("dead");
});

test("the secret mouth is not the main mouth", () => {
  const world = createWorld(levelById.twin!);
  const row = levelById.twin!.rows[8]!;
  const zx = row.indexOf("z");
  world.player.x = zx * TILE;
  world.player.y = 8 * TILE;
  step(world, hold, STEP);
  expect(world.status).toBe("secret");
});

test("kindling can be lit from a standing start", () => {
  const world = createWorld(levelById.kindling!);
  let jumpLock = 0;
  for (let i = 0; i < 60 * 30; i++) {
    jumpLock = Math.max(0, jumpLock - 1);
    const player = world.player;
    const ghost = placeTarget(world);
    const onSocket = ghost?.tx === 12 && ghost.ty === 13;
    const locked = world.bricks.some((brick) => brick.locked);
    let right = true;
    let left = false;
    let jump = false;
    let place = false;
    if (!player.holding && !locked) {
      const underCrack = player.x < 7 * TILE && player.x + PLAYER_W > 6 * TILE;
      if (player.grounded && jumpLock === 0 && underCrack) {
        jump = true;
        jumpLock = 35;
      }
    } else if (player.holding) {
      if (onSocket) {
        place = true;
        right = false;
      } else if (player.x > 11 * TILE) {
        right = false;
        left = true;
      }
    } else if (player.grounded && jumpLock === 0 && !solidAt(world, player.x + PLAYER_W + 2, player.y + PLAYER_H + 2)) {
      jump = true;
      jumpLock = 20;
    }
    step(world, { left, right, jumpPressed: jump, jumpHeld: true, placePressed: place }, STEP);
    if (world.status === "cleared") return;
  }
  throw new Error(
    `status=${world.status} holding=${world.player.holding} bricks=${world.bricks.length} x=${world.player.x.toFixed(1)} y=${world.player.y.toFixed(1)}`,
  );
});

test("the flue opens forward, and the cinder path is a shortcut", () => {
  let progress = derive([], []);
  expect(progress.unlocked).toEqual(["kindling"]);
  expect(isVisible("hearth", progress)).toBe(true);
  expect(isVisible("cinder", progress)).toBe(false);

  progress = noteClear(progress, "kindling", false);
  progress = noteClear(progress, "hearth", false);
  progress = noteClear(progress, "twin", false);
  expect(progress.unlocked).toContain("patrol");
  expect(progress.unlocked).not.toContain("cinder");
  expect(pickNeighbor("twin", 1, 0, progress)).toBe("patrol");

  progress = noteClear(progress, "twin", true);
  expect(progress.unlocked).toContain("cinder");
  expect(pickNeighbor("twin", 0, -1, progress)).toBe("cinder");

  progress = noteClear(progress, "cinder", false);
  expect(progress.unlocked).toContain("gate");
  expect(progress.unlocked).not.toContain("kiln");
  progress = noteClear(progress, "gate", false);
  expect(progress.unlocked).toContain("kiln");
});

test("bellows is the road after the hearth, and its secret opens the draft", () => {
  let progress = derive([], []);
  progress = noteClear(progress, "kindling", false);
  progress = noteClear(progress, "hearth", false);
  expect(progress.unlocked).toContain("bellows");
  expect(progress.unlocked).not.toContain("twin");
  expect(progress.unlocked).not.toContain("draft");

  progress = noteClear(progress, "bellows", true);
  expect(progress.secrets).toContain("bellows");
  expect(progress.unlocked).toContain("draft");
  expect(progress.unlocked).toContain("twin");
  expect(progress.unlocked).not.toContain("patrol");
  expect(pickNeighbor("bellows", 1, 0, progress)).toBe("draft");
});

function blankRoom(width = 24): string[] {
  return Array.from({ length: 15 }, () => ".".repeat(width));
}

test("a coil throws you onto a shelf a jump cannot reach", () => {
  const width = 24;
  const rows = blankRoom(width);
  rows[8] = `${".".repeat(9)}${"#".repeat(8)}${".".repeat(7)}`;
  rows[12] = `${".".repeat(2)}p${".".repeat(4)}*${".".repeat(16)}`;
  rows[13] = "#".repeat(width);
  rows[14] = "#".repeat(width);
  const world = createWorld({ id: "coil", name: "Coil", hint: "", heat: 0, width, height: 15, rows });
  let high = false;
  for (let i = 0; i < 240; i++) {
    step(world, { left: false, right: true, jumpPressed: false, jumpHeld: true, placePressed: false }, STEP);
    if (world.player.grounded && world.player.y < 9 * TILE) high = true;
  }
  if (!high) {
    throw new Error(`missed the shelf x=${world.player.x.toFixed(1)} y=${world.player.y.toFixed(1)} status=${world.status}`);
  }
});

test("a shelf carries you over spikes", () => {
  const width = 28;
  const rows = blankRoom(width);
  rows[12] = `${".".repeat(4)}=${".".repeat(23)}`;
  const floor = Array<string>(width).fill("#");
  for (let x = 6; x <= 22; x++) floor[x] = "^";
  rows[13] = floor.join("");
  rows[14] = "#".repeat(width);
  const world = createWorld({ id: "shelf", name: "Shelf", hint: "", heat: 0, width, height: 15, rows });
  const shelf = world.movers[0]!;
  world.player.x = shelf.x + 6;
  world.player.y = shelf.y - PLAYER_H;
  world.player.riding = 0;
  world.player.grounded = true;
  const start = world.player.x;
  frames(world, 100);
  expect(world.status).toBe("play");
  expect(Math.abs(world.player.x - (world.movers[0]!.x + 6))).toBeLessThan(24);
  expect(Math.abs(world.player.x - start)).toBeGreaterThan(8);
});

test("a grate stays shut until every coin is taken", () => {
  const width = 18;
  const rows = blankRoom(width);
  rows[9] = `${".".repeat(8)}G${".".repeat(9)}`;
  rows[10] = `${".".repeat(8)}G${".".repeat(9)}`;
  rows[11] = `${".".repeat(8)}G${".".repeat(9)}`;
  rows[12] = "..p..c..G.......x.";
  rows[13] = "#".repeat(width);
  rows[14] = "#".repeat(width);
  const level: Level = { id: "grate", name: "Grate", hint: "", heat: 0, width, height: 15, rows };
  const blocked = createWorld(level);
  blocked.player.x = 7 * TILE;
  blocked.player.y = 13 * TILE - PLAYER_H;
  frames(blocked, 90, { ...hold, right: true });
  expect(blocked.gatesOpen).toBe(false);
  expect(blocked.player.x).toBeLessThan(8 * TILE);
  expect(blocked.status).toBe("play");

  const open = createWorld(level);
  let took = false;
  for (let i = 0; i < 240 && !took; i++) {
    step(open, { ...hold, right: true }, STEP);
    took = open.events.some((event) => event.t === "coin") || open.gatesOpen;
  }
  expect(open.gatesOpen).toBe(true);

  const remembered = createWorld(level, new Set(["grate:5:12"]));
  expect(remembered.gatesOpen).toBe(true);
});

test("landing on a wasp stomps it", () => {
  const world = createWorld(levelById.draft!);
  const wasp = world.enemies.find((enemy) => enemy.kind === "wasp");
  if (!wasp) throw new Error("draft has no wasp");
  world.player.x = wasp.x;
  world.player.y = wasp.y - PLAYER_H - 2;
  world.player.vy = 200;
  world.player.grounded = false;
  frames(world, 8);
  expect(wasp.alive).toBe(false);
  expect(world.status).toBe("play");
});
