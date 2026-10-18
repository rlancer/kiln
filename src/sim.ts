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
  | { t: "fail" };

type Cell = {
  solid: boolean;
  crack: boolean;
  socket: boolean;
  spike: boolean;
  coin: boolean;
  exit: boolean;
  secret: boolean;
  flag: boolean;
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
};

type Enemy = {
  x: number;
  y: number;
  vx: number;
  alive: boolean;
  homeX: number;
  homeY: number;
  homeVx: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
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
    solid: ch === "#" || ch === "?",
    crack: ch === "?",
    socket: ch === "s",
    spike: ch === "^",
    coin: ch === "c",
    exit: ch === "x",
    secret: ch === "z",
    flag: ch === "f",
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

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const ch = level.rows[ty]![tx]!;
      const key = coinKey(level.id, tx, ty);
      if (ch === "c" && collected.has(key)) cells[idx(level, tx, ty)]!.coin = false;
      if (ch === "p") {
        spawnX = tx * TILE + (TILE - PLAYER_W) / 2;
        spawnY = (ty + 1) * TILE - PLAYER_H;
      }
      if (ch === "e") {
        const homeX = tx * TILE + 1;
        const homeY = (ty + 1) * TILE - ENEMY_H;
        const homeVx = tx % 2 === 0 ? 36 : -36;
        enemies.push({ x: homeX, y: homeY, vx: homeVx, alive: true, homeX, homeY, homeVx });
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
  };
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
  return cell.solid || brickAt(world, tx, ty) !== undefined;
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

function moveY(world: World, dt: number): void {
  const player = world.player;
  const before = player.vy;
  player.y += player.vy * dt;
  if (player.y < 0) {
    player.y = 0;
    player.vy = 0;
  }
  const body: Rect = { x: player.x + 1, y: player.y, w: PLAYER_W - 2, h: PLAYER_H };
  const hits = tilesTouching( body, (tx, ty) => isSolid(world, tx, ty));
  if (hits.length === 0) {
    player.grounded = false;
    return;
  }
  if (before > 0) {
    player.y = Math.min(...hits.map((hit) => hit.ty * TILE - PLAYER_H));
    if (before > 160) {
      world.events.push({ t: "land" });
      burst(world, player.x + PLAYER_W / 2, player.y + PLAYER_H, "#5c261c", 4);
    }
    player.vy = 0;
    player.grounded = true;
    return;
  }
  if (before < 0) {
    for (const hit of hits) bumpCrack(world, hit.tx, hit.ty);
    player.y = Math.max(...hits.map((hit) => hit.ty * TILE + TILE));
    player.vy = 0;
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
  world.deadTimer = 0.42;
  world.shake = 4;
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
  world.status = "play";
  for (const enemy of world.enemies) {
    enemy.x = enemy.homeX;
    enemy.y = enemy.homeY;
    enemy.vx = enemy.homeVx;
    enemy.alive = true;
  }
}

function stepEnemies(world: World, dt: number): void {
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
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
      player.vy = STOMP_VEL;
      player.grounded = false;
      world.events.push({ t: "stomp" });
      burst(world, enemy.x + 7, enemy.y + 4, "#6e8b74", 6);
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
  const look = world.player.facing * 22;
  const target = world.player.x + PLAYER_W / 2 - VIEW_W / 2 + look;
  return Math.max(0, Math.min(max, target));
}

function tickAmbient(world: World, dt: number): void {
  world.time += dt;
  world.hintLeft = Math.max(0, world.hintLeft - dt);
  world.shake = Math.max(0, world.shake - dt * 10);
  if (world.player.invuln > 0) world.player.invuln -= dt;
  for (const [key, left] of world.bumps) {
    const next = left - dt;
    if (next <= 0) world.bumps.delete(key);
    else world.bumps.set(key, next);
  }
  for (const particle of world.particles) {
    particle.life -= dt;
    particle.vy += 280 * dt;
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
    world.deadTimer -= dt;
    if (world.deadTimer <= 0) respawn(world);
    return;
  }
  if (world.status !== "play") return;

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
    world.events.push({ t: "jump" });
  } else {
    if (!input.jumpHeld && player.vy < 0 && !player.jumpCut) {
      player.vy *= JUMP_CUT;
      player.jumpCut = true;
    }
    player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
  }

  moveY(world, dt);
  if (player.vy >= 0 && probeGround(world)) player.grounded = true;

  if (input.placePressed) tryPlace(world);
  stepEnemies(world, dt);
  stepCombat(world, dt);
  if (world.status === "play") stepOverlays(world);
  if (world.status === "play" && player.y > world.level.height * TILE) die(world);

  const target = cameraTarget(world);
  world.camX += (target - world.camX) * Math.min(1, dt * 7);
}
