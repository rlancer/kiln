import {
  AIR_ACCEL,
  BRICK_LIFE,
  COYOTE,
  ENEMY_H,
  ENEMY_W,
  FRICTION,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_VEL,
  MAX_FALL,
  MAX_RUN,
  PLAYER_H,
  PLAYER_W,
  RUN_ACCEL,
  SHELF_SPAN,
  SHELF_W,
  SPRING_VEL,
  STOMP_VEL,
  TILE,
  VIEW_W,
} from "./constants";
import type { Level } from "./levels";

export type Input = {
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  placePressed: boolean;
};

export type GameEvent =
  | { t: "coin"; key: string }
  | { t: "jump" }
  | { t: "land" }
  | { t: "place" }
  | { t: "lock" }
  | { t: "expire" }
  | { t: "bump" }
  | { t: "brick" }
  | { t: "stomp" }
  | { t: "die" }
  | { t: "flag" }
  | { t: "exit" }
  | { t: "secret" }
  | { t: "fail" }
  | { t: "spring" }
  | { t: "open" };

type Cell = {
  solid: boolean;
  crack: boolean;
  socket: boolean;
  spike: boolean;
  coin: boolean;
  exit: boolean;
  secret: boolean;
  flag: boolean;
  spring: boolean;
  gate: boolean;
};

export type Brick = { tx: number; ty: number; ttl: number; locked: boolean };

type Actor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  jumpCut: boolean;
  holding: boolean;
  invuln: number;
  spawnX: number;
  spawnY: number;
  riding: number;
  landed: number;
  dust: number;
};

type Enemy = {
  x: number;
  y: number;
  vx: number;
  alive: boolean;
  kind: "crab" | "wasp";
  homeX: number;
  homeY: number;
  homeVx: number;
  phase: number;
  amp: number;
  squash: number;
};

export type Mover = {
  x: number;
  y: number;
  prevX: number;
  w: number;
  h: number;
  origin: number;
  span: number;
  phase: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  grav: number;
};

export type World = {
  level: Level;
  cells: Cell[];
  bricks: Brick[];
  player: Actor;
  enemies: Enemy[];
  time: number;
  hintLeft: number;
  coins: number;
  status: "play" | "dead" | "cleared" | "secret";
  deadTimer: number;
  bumps: Map<string, number>;
  flags: Set<string>;
  particles: Particle[];
  events: GameEvent[];
  collected: Set<string>;
  shake: number;
  camX: number;
  movers: Mover[];
  gatesOpen: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };

const EMPTY: Input = {
  left: false,
  right: false,
  jumpPressed: false,
  jumpHeld: false,
  placePressed: false,
};

function parseCell(ch: string): Cell {
  return {
    solid: ch === "#" || ch === "?" || ch === "G",
    crack: ch === "?",
    socket: ch === "s",
    spike: ch === "^",
    coin: ch === "c",
    exit: ch === "x",
    secret: ch === "z",
    flag: ch === "f",
    spring: ch === "*",
    gate: ch === "G",
  };
}

function idx(level: Level, tx: number, ty: number): number {
  return ty * level.width + tx;
}

export function createWorld(level: Level, alreadyCollected: ReadonlySet<string> = new Set()): World {
  const cells = level.rows.flatMap((row) => [...row].map(parseCell));
  const collected = new Set(alreadyCollected);
  let spawnX = TILE;
  let spawnY = 12 * TILE;
  const enemies: Enemy[] = [];
  const movers: Mover[] = [];

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const ch = level.rows[ty]![tx]!;
      const key = coinKey(level.id, tx, ty);
      if (ch === "c" && collected.has(key)) cells[idx(level, tx, ty)]!.coin = false;
      if (ch === "p") {
        spawnX = tx * TILE + (TILE - PLAYER_W) / 2;
        spawnY = (ty + 1) * TILE - PLAYER_H;
      }
      if (ch === "e" || ch === "w") {
        const wasp = ch === "w";
        const homeX = tx * TILE + 1;
        const homeY = wasp ? ty * TILE + 8 : (ty + 1) * TILE - ENEMY_H;
        const homeVx = wasp ? 32 : tx % 2 === 0 ? 36 : -36;
        enemies.push({
          x: homeX,
          y: homeY,
          vx: homeVx,
          alive: true,
          kind: wasp ? "wasp" : "crab",
          homeX,
          homeY,
          homeVx,
          phase: tx * 0.7,
          amp: wasp ? 10 : 0,
          squash: 0,
        });
      }
      if (ch === "=") {
        const origin = tx * TILE;
        movers.push({
          x: origin,
          prevX: origin,
          y: ty * TILE + 6,
          w: SHELF_W,
          h: 8,
          origin,
          span: SHELF_SPAN,
          phase: (tx % 7) * 0.55,
        });
      }
    }
  }

  const world: World = {
    level,
    cells,
    bricks: [],
    player: {
      x: spawnX,
      y: spawnY,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: true,
      coyote: COYOTE,
      jumpBuffer: 0,
      jumpCut: false,
      holding: false,
      invuln: 0,
      spawnX,
      spawnY,
      riding: -1,
      landed: 0,
      dust: 0,
    },
    enemies,
    time: 0,
    hintLeft: 7,
    coins: 0,
    status: "play",
    deadTimer: 0,
    bumps: new Map(),
    flags: new Set(),
    particles: [],
    events: [],
    collected,
    shake: 0,
    camX: 0,
    movers,
    gatesOpen: !cells.some((cell) => cell.coin),
  };
  for (const mover of movers) {
    mover.x = shelfX(mover, 0);
    mover.prevX = mover.x;
  }
  world.camX = cameraTarget(world);
  return world;
}

function coinKey(levelId: string, tx: number, ty: number): string {
  return `${levelId}:${tx}:${ty}`;
}

function inBounds(world: World, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < world.level.width && ty < world.level.height;
}

function cellAt(world: World, tx: number, ty: number): Cell | null {
  if (!inBounds(world, tx, ty)) return null;
  return world.cells[idx(world.level, tx, ty)]!;
}

function brickAt(world: World, tx: number, ty: number): Brick | undefined {
  return world.bricks.find((brick) => brick.tx === tx && brick.ty === ty);
}

function isSolid(world: World, tx: number, ty: number): boolean {
  const cell = cellAt(world, tx, ty);
  if (!cell) return false;
  if (cell.gate && world.gatesOpen) return false;
  return cell.solid || brickAt(world, tx, ty) !== undefined;
}

function shelfX(mover: Mover, time: number): number {
  return mover.origin + Math.sin(time * 1.15 + mover.phase) * mover.span;
}

function playerRect(player: Actor): Rect {
  return { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
}

function tilesTouching(rect: Rect, pred: (tx: number, ty: number) => boolean): { tx: number; ty: number }[] {
  const x0 = Math.floor(rect.x / TILE);
  const y0 = Math.floor(rect.y / TILE);
  const x1 = Math.floor((rect.x + rect.w - 0.001) / TILE);
  const y1 = Math.floor((rect.y + rect.h - 0.001) / TILE);
  const hits: { tx: number; ty: number }[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (pred(tx, ty)) hits.push({ tx, ty });
    }
  }
  return hits;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function burst(world: World, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const life = 0.28 + Math.random() * 0.28;
    world.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 90,
      vy: -30 - Math.random() * 70,
      life,
      max: life,
      color,
      grav: 280,
    });
  }
}

export function placeTarget(world: World): { tx: number; ty: number } | null {
  const player = world.player;
  const feet = player.y + PLAYER_H;
  const supportTy = Math.floor((feet + 0.01) / TILE);
  const bodyTx = Math.floor((player.x + PLAYER_W / 2) / TILE);
  const frontTx = bodyTx + player.facing;
  const candidates = [
    [frontTx, supportTy],
    [frontTx, supportTy - 1],
    [frontTx, supportTy - 2],
  ];
  for (const [tx, ty] of candidates) {
    if (tx === undefined || ty === undefined) continue;
    if (!inBounds(world, tx, ty)) continue;
    if (isSolid(world, tx, ty)) continue;
    return { tx, ty };
  }
  return null;
}

function nudgeOut(player: Actor, tx: number, ty: number): void {
  const tileX = tx * TILE;
  const tileY = ty * TILE;
  const rect = playerRect(player);
  if (!overlaps(rect, { x: tileX, y: tileY, w: TILE, h: TILE })) return;
  player.x = player.facing > 0 ? tileX - PLAYER_W : tileX + TILE;
}

function tryPlace(world: World): void {
  const player = world.player;
  const target = placeTarget(world);
  if (!player.holding || !target) {
    world.events.push({ t: "fail" });
    return;
  }
  const cell = cellAt(world, target.tx, target.ty);
  const locked = cell?.socket === true;
  world.bricks.push({
    tx: target.tx,
    ty: target.ty,
    ttl: BRICK_LIFE,
    locked,
  });
  player.holding = false;
  nudgeOut(player, target.tx, target.ty);
  world.events.push({ t: locked ? "lock" : "place" });
  if (locked) world.shake = Math.max(world.shake, 1.5);
  burst(world, target.tx * TILE + 8, target.ty * TILE + 8, locked ? "#b7d1c0" : "#ffd27a", 6);
}

function moveX(world: World, dt: number): void {
  const player = world.player;
  player.x += player.vx * dt;
  const maxX = world.level.width * TILE - PLAYER_W;
  if (player.x < 0) {
    player.x = 0;
    player.vx = 0;
  } else if (player.x > maxX) {
    player.x = maxX;
    player.vx = 0;
  }
  const body: Rect = { x: player.x, y: player.y + 1, w: PLAYER_W, h: PLAYER_H - 2 };
  const hits = tilesTouching( body, (tx, ty) => isSolid(world, tx, ty));
  if (hits.length === 0) return;
  if (player.vx > 0) {
    player.x = Math.min(...hits.map((hit) => hit.tx * TILE - PLAYER_W));
  } else if (player.vx < 0) {
    player.x = Math.max(...hits.map((hit) => hit.tx * TILE + TILE));
  } else {
    const hit = hits[0]!;
    const tileMid = hit.tx * TILE + TILE / 2;
    player.x = player.x + PLAYER_W / 2 < tileMid ? hit.tx * TILE - PLAYER_W : hit.tx * TILE + TILE;
  }
  player.vx = 0;
}

function bumpCrack(world: World, tx: number, ty: number): void {
  const cell = cellAt(world, tx, ty);
  if (!cell?.crack) return;
  const key = `${tx},${ty}`;
  if ((world.bumps.get(key) ?? 0) > 0) return;
  world.bumps.set(key, 0.16);
  world.events.push({ t: "bump" });
  if (!world.player.holding) {
    world.player.holding = true;
    world.events.push({ t: "brick" });
  }
}

function shelfUnder(world: World, prevBottom: number, bottom: number): Mover | null {
  const player = world.player;
  let best: Mover | null = null;
  for (const mover of world.movers) {
    const overlap = player.x + PLAYER_W - 2 > mover.x && player.x + 2 < mover.x + mover.w;
    if (!overlap) continue;
    if (prevBottom > mover.y + 1 || bottom < mover.y) continue;
    if (!best || mover.y < best.y) best = mover;
  }
  return best;
}

function moveY(world: World, dt: number): void {
  const player = world.player;
  const before = player.vy;
  const prevBottom = player.y + PLAYER_H;
  player.y += player.vy * dt;
  if (player.y < 0) {
    player.y = 0;
    player.vy = 0;
  }
  const body: Rect = { x: player.x + 1, y: player.y, w: PLAYER_W - 2, h: PLAYER_H };
  const hits = tilesTouching(body, (tx, ty) => isSolid(world, tx, ty));
  const bottom = player.y + PLAYER_H;
  const shelf = before > 0 ? shelfUnder(world, prevBottom, bottom) : null;
  if (before > 0 && (hits.length > 0 || shelf)) {
    const tileTop = hits.length > 0 ? Math.min(...hits.map((hit) => hit.ty * TILE)) : Number.POSITIVE_INFINITY;
    const shelfTop = shelf ? shelf.y : Number.POSITIVE_INFINITY;
    if (shelf && shelfTop <= tileTop) {
      player.y = shelf.y - PLAYER_H;
      player.vy = 0;
      player.grounded = true;
      player.riding = world.movers.indexOf(shelf);
      if (before > 80) player.landed = 0.1;
      return;
    }
    player.y = tileTop - PLAYER_H;
    player.riding = -1;
    if (before > 80) player.landed = 0.1;
    if (before > 160) {
      world.events.push({ t: "land" });
      burst(world, player.x + PLAYER_W / 2, player.y + PLAYER_H, "#5c261c", 4);
    }
    player.vy = 0;
    player.grounded = true;
    return;
  }
  if (before < 0 && hits.length > 0) {
    for (const hit of hits) bumpCrack(world, hit.tx, hit.ty);
    player.y = Math.max(...hits.map((hit) => hit.ty * TILE + TILE));
    player.vy = 0;
    player.grounded = false;
    player.riding = -1;
    return;
  }
  player.grounded = false;
}

function probeGround(world: World): boolean {
  const rect: Rect = {
    x: world.player.x + 1,
    y: world.player.y + PLAYER_H,
    w: PLAYER_W - 2,
    h: 0.6,
  };
  return tilesTouching( rect, (tx, ty) => isSolid(world, tx, ty)).length > 0;
}

function tickBricks(world: World, dt: number): void {
  for (const brick of world.bricks) {
    if (!brick.locked) brick.ttl -= dt;
  }
  const expired = world.bricks.filter((brick) => !brick.locked && brick.ttl <= 0);
  if (expired.length === 0) return;
  world.bricks = world.bricks.filter((brick) => brick.locked || brick.ttl > 0);
  for (const brick of expired) {
    world.events.push({ t: "expire" });
    burst(world, brick.tx * TILE + 8, brick.ty * TILE + 8, "#c4b8a8", 7);
  }
}

function die(world: World): void {
  if (world.player.invuln > 0 || world.status !== "play") return;
  world.status = "dead";
  world.deadTimer = 0.5;
  world.shake = 4;
  world.player.vy = -300;
  world.player.vx *= 0.25;
  world.player.riding = -1;
  world.events.push({ t: "die" });
  burst(world, world.player.x + PLAYER_W / 2, world.player.y + 6, "#ffb15a", 8);
}

function respawn(world: World): void {
  const player = world.player;
  player.x = player.spawnX;
  player.y = player.spawnY;
  player.vx = 0;
  player.vy = 0;
  player.grounded = true;
  player.invuln = 0.75;
  player.jumpCut = false;
  player.riding = -1;
  player.landed = 0;
  world.status = "play";
  for (const enemy of world.enemies) {
    enemy.x = enemy.homeX;
    enemy.y = enemy.homeY;
    enemy.vx = enemy.homeVx;
    enemy.alive = true;
    enemy.squash = 0;
  }
}

function stepEnemies(world: World, dt: number): void {
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    if (enemy.kind === "wasp") {
      const next = enemy.x + enemy.vx * dt;
      const rect = { x: next, y: enemy.y, w: ENEMY_W, h: ENEMY_H };
      const blocked = tilesTouching(rect, (tx, ty) => isSolid(world, tx, ty)).length > 0;
      const minX = enemy.homeX - 56;
      const maxX = enemy.homeX + 56;
      if (blocked || next < minX || next > maxX) enemy.vx *= -1;
      else enemy.x = next;
      const bob = enemy.homeY + Math.sin(world.time * 2.6 + enemy.phase) * enemy.amp;
      const body = { x: enemy.x, y: bob, w: ENEMY_W, h: ENEMY_H };
      const jammed = tilesTouching(body, (tx, ty) => isSolid(world, tx, ty)).length > 0;
      enemy.y = jammed ? enemy.homeY : bob;
      continue;
    }
    const next = enemy.x + enemy.vx * dt;
    const rect = { x: next, y: enemy.y, w: ENEMY_W, h: ENEMY_H };
    const blocked = tilesTouching( rect, (tx, ty) => isSolid(world, tx, ty)).length > 0;
    const front = enemy.vx > 0 ? next + ENEMY_W + 1 : next - 1;
    const feet = enemy.y + ENEMY_H + 2;
    const tx = Math.floor(front / TILE);
    const ty = Math.floor(feet / TILE);
    const supported = isSolid(world, tx, ty);
    const minX = 0;
    const maxX = world.level.width * TILE - ENEMY_W;
    if (blocked || !supported || next < minX || next > maxX) {
      enemy.vx *= -1;
      continue;
    }
    enemy.x = next;
  }
}

function stepCombat(world: World, dt: number): void {
  const player = world.player;
  const prevBottom = player.y + PLAYER_H - player.vy * dt;
  const rect = playerRect(player);
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const body = { x: enemy.x, y: enemy.y, w: ENEMY_W, h: ENEMY_H };
    if (!overlaps(rect, body)) continue;
    const stomp = player.vy > 0 && prevBottom <= enemy.y + 5;
    if (stomp) {
      enemy.alive = false;
      enemy.squash = 0.32;
      player.vy = STOMP_VEL;
      player.grounded = false;
      player.riding = -1;
      world.events.push({ t: "stomp" });
      burst(world, enemy.x + 7, enemy.y + 4, enemy.kind === "wasp" ? "#ffb15a" : "#6e8b74", 6);
      continue;
    }
    die(world);
    return;
  }
}

function stepOverlays(world: World): void {
  const rect = playerRect(world.player);
  const hits = tilesTouching( rect, (tx, ty) => cellAt(world, tx, ty) !== null);
  for (const hit of hits) {
    const cell = cellAt(world, hit.tx, hit.ty);
    if (!cell) continue;
    if (cell.spike && !brickAt(world, hit.tx, hit.ty)) {
      die(world);
      return;
    }
    if (cell.coin) {
      cell.coin = false;
      const key = coinKey(world.level.id, hit.tx, hit.ty);
      world.collected.add(key);
      world.coins += 1;
      world.events.push({ t: "coin", key });
      burst(world, hit.tx * TILE + 8, hit.ty * TILE + 8, "#ffd27a", 4);
      refreshGates(world);
    }
    if (cell.flag) {
      const key = `${hit.tx},${hit.ty}`;
      if (!world.flags.has(key)) {
        world.flags.add(key);
        world.player.spawnX = hit.tx * TILE + (TILE - PLAYER_W) / 2;
        world.player.spawnY = (hit.ty + 1) * TILE - PLAYER_H;
        world.events.push({ t: "flag" });
      }
    }
    if (world.status !== "play") return;
    if (cell.secret) {
      world.status = "secret";
      world.events.push({ t: "secret" });
      return;
    }
    if (cell.exit) {
      world.status = "cleared";
      world.events.push({ t: "exit" });
      return;
    }
  }
}

function cameraTarget(world: World): number {
  const max = Math.max(0, world.level.width * TILE - VIEW_W);
  const speed = Math.min(1, Math.abs(world.player.vx) / MAX_RUN);
  const look = world.player.facing * (16 + speed * 40);
  const target = world.player.x + PLAYER_W / 2 - VIEW_W / 2 + look;
  return Math.max(0, Math.min(max, target));
}

function refreshGates(world: World): void {
  const open = !world.cells.some((cell) => cell.coin);
  const hasGate = world.cells.some((cell) => cell.gate);
  if (open && !world.gatesOpen && hasGate) {
    world.events.push({ t: "open" });
    world.shake = Math.max(world.shake, 1.4);
    for (let ty = 0; ty < world.level.height; ty++) {
      for (let tx = 0; tx < world.level.width; tx++) {
        const cell = world.cells[idx(world.level, tx, ty)]!;
        if (cell.gate) burst(world, tx * TILE + 8, ty * TILE + 8, "#b7d1c0", 4);
      }
    }
  }
  world.gatesOpen = open;
}

function syncShelves(world: World): void {
  for (const mover of world.movers) {
    mover.prevX = mover.x;
    mover.x = shelfX(mover, world.time);
  }
}

function carryShelf(world: World): void {
  const player = world.player;
  if (player.riding < 0) return;
  const mover = world.movers[player.riding];
  if (!mover) {
    player.riding = -1;
    return;
  }
  player.x += mover.x - mover.prevX;
}

function stickShelf(world: World): void {
  const player = world.player;
  if (player.riding < 0 || player.vy < 0) return;
  const mover = world.movers[player.riding];
  if (!mover) {
    player.riding = -1;
    return;
  }
  const overlap = player.x + PLAYER_W - 1 > mover.x && player.x + 1 < mover.x + mover.w;
  const bottom = player.y + PLAYER_H;
  if (!overlap || bottom > mover.y + 5) {
    player.riding = -1;
    return;
  }
  player.y = mover.y - PLAYER_H;
  player.vy = 0;
  player.grounded = true;
}

function stepSprings(world: World): void {
  const player = world.player;
  if (player.vy < 0) return;
  const rect: Rect = {
    x: player.x + 1,
    y: player.y + PLAYER_H * 0.35,
    w: PLAYER_W - 2,
    h: PLAYER_H * 0.65,
  };
  const hits = tilesTouching(rect, (tx, ty) => cellAt(world, tx, ty)?.spring === true);
  const hit = hits[0];
  if (!hit) return;
  player.vy = SPRING_VEL;
  player.grounded = false;
  player.riding = -1;
  player.jumpCut = true;
  player.coyote = 0;
  player.jumpBuffer = 0;
  world.events.push({ t: "spring" });
  world.bumps.set(`s${hit.tx},${hit.ty}`, 0.18);
  burst(world, hit.tx * TILE + 8, hit.ty * TILE + 12, "#ffd27a", 5);
}

function approachCamera(world: World, dt: number): void {
  const target = cameraTarget(world);
  world.camX += (target - world.camX) * Math.min(1, dt * 7);
}

function tickAmbient(world: World, dt: number): void {
  world.time += dt;
  world.hintLeft = Math.max(0, world.hintLeft - dt);
  world.shake = Math.max(0, world.shake - dt * 10);
  if (world.player.invuln > 0) world.player.invuln -= dt;
  if (world.player.landed > 0) world.player.landed -= dt;
  for (const enemy of world.enemies) {
    if (enemy.squash > 0) enemy.squash = Math.max(0, enemy.squash - dt);
  }
  syncShelves(world);
  const player = world.player;
  if (player.grounded && Math.abs(player.vx) > 48 && world.status === "play") {
    player.dust -= dt;
    if (player.dust <= 0) {
      player.dust = 0.08;
      const life = 0.22;
      world.particles.push({
        x: player.x + (player.vx > 0 ? 1 : PLAYER_W - 2),
        y: player.y + PLAYER_H - 2,
        vx: -Math.sign(player.vx) * 18,
        vy: -12,
        life,
        max: life,
        color: "#5c261c",
        grav: 280,
      });
    }
  }
  if (world.particles.length < 28 && Math.random() < world.level.heat * 0.18) {
    const life = 0.7 + Math.random() * 0.45;
    world.particles.push({
      x: world.camX + Math.random() * VIEW_W,
      y: 120 + Math.random() * 100,
      vx: -6 - Math.random() * 12,
      vy: -14 - Math.random() * 16,
      life,
      max: life,
      color: Math.random() > 0.45 ? "#ffb15a" : "#c45032",
      grav: 24,
    });
  }
  for (const [key, left] of world.bumps) {
    const next = left - dt;
    if (next <= 0) world.bumps.delete(key);
    else world.bumps.set(key, next);
  }
  for (const particle of world.particles) {
    particle.life -= dt;
    particle.vy += particle.grav * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }
  world.particles = world.particles.filter((particle) => particle.life > 0);
}

export function step(world: World, input: Input = EMPTY, dt: number): void {
  world.events = [];
  tickAmbient(world, dt);
  tickBricks(world, dt);

  if (world.status === "dead") {
    const player = world.player;
    player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
    player.y += player.vy * dt;
    player.x += player.vx * dt;
    world.deadTimer -= dt;
    if (world.deadTimer <= 0) respawn(world);
    approachCamera(world, dt);
    return;
  }
  if (world.status !== "play") return;

  carryShelf(world);
  const player = world.player;
  if (input.left && !input.right) player.facing = -1;
  if (input.right && !input.left) player.facing = 1;

  const accel = player.grounded ? RUN_ACCEL : AIR_ACCEL;
  if (input.left !== input.right) {
    const dir = input.left ? -1 : 1;
    player.vx += dir * accel * dt;
    if (player.vx > MAX_RUN) player.vx = MAX_RUN;
    if (player.vx < -MAX_RUN) player.vx = -MAX_RUN;
  } else if (player.grounded) {
    if (Math.abs(player.vx) < FRICTION * dt) player.vx = 0;
    else player.vx -= Math.sign(player.vx) * FRICTION * dt;
  }

  moveX(world, dt);

  if (player.grounded) player.coyote = COYOTE;
  else player.coyote = Math.max(0, player.coyote - dt);
  if (input.jumpPressed) player.jumpBuffer = JUMP_BUFFER;
  else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

  const jumping = player.jumpBuffer > 0 && (player.grounded || player.coyote > 0);
  if (jumping) {
    player.vy = JUMP_VEL;
    player.grounded = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
    player.jumpCut = false;
    player.riding = -1;
    world.events.push({ t: "jump" });
  } else {
    if (!input.jumpHeld && player.vy < 0 && !player.jumpCut) {
      player.vy *= JUMP_CUT;
      player.jumpCut = true;
    }
    player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
  }

  moveY(world, dt);
  stickShelf(world);
  if (player.vy >= 0 && probeGround(world)) player.grounded = true;
  stepSprings(world);

  if (input.placePressed) tryPlace(world);
  stepEnemies(world, dt);
  stepCombat(world, dt);
  if (world.status === "play") stepOverlays(world);
  if (world.status === "play" && player.y > world.level.height * TILE) die(world);

  approachCamera(world, dt);
}
