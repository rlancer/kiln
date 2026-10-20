import { BRICK_LIFE, PLAYER_W, TILE, VIEW_H, VIEW_W } from "./constants";
import { drawText, textWidth } from "./font";
import type { Fx } from "./fx";
import { LINKS, NODES, isVisible, type NodeId, type Progress } from "./map";
import { placeTarget, type World } from "./sim";

const soot = "#14110e";
const clay = "#b5523a";
const clayLight = "#d4785a";
const clayDark = "#5c261c";
const glaze = "#ffd27a";
const coal = "#ffb15a";
const slag = "#6e8b74";
const slagBright = "#b7d1c0";
const smoke = "#c4b8a8";
const hood = "#241c18";
const cloth = "#3e3832";

export type Scene =
  | { kind: "title"; time: number; reduced: boolean }
  | {
      kind: "map";
      time: number;
      reduced: boolean;
      progress: Progress;
      pos: { x: number; y: number };
      coins: number;
      mute: boolean;
    }
  | {
      kind: "play";
      world: World;
      reduced: boolean;
      banner: string | null;
      bannerT: number;
      paused: boolean;
    }
  | { kind: "won"; time: number; reduced: boolean };

type Light = { x: number; y: number; r: number; rgb: string; a: number };

const RGB = {
  coal: "255,150,70",
  glaze: "255,210,122",
  slag: "160,220,190",
  lava: "255,96,40",
} as const;

function hash(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) | 0;
  return Math.abs(n);
}

function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

// Additive glow pass: each light is a soft radial falloff blended with "lighter".
function drawLights(ctx: CanvasRenderingContext2D, lights: Light[]): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const light of lights) {
    if (light.x + light.r < 0 || light.x - light.r > VIEW_W) continue;
    const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.r);
    g.addColorStop(0, `rgba(${light.rgb},${light.a})`);
    g.addColorStop(0.45, `rgba(${light.rgb},${light.a * 0.35})`);
    g.addColorStop(1, `rgba(${light.rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(light.x - light.r, light.y - light.r, light.r * 2, light.r * 2);
  }
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D, strength: number): void {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 70, VIEW_W / 2, VIEW_H / 2, 230);
  g.addColorStop(0, "rgba(10,6,4,0)");
  g.addColorStop(1, `rgba(10,6,4,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function shadowText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
): void {
  drawText(ctx, value, x + scale, y + scale, soot, scale);
  drawText(ctx, value, x, y, color, scale);
}

function shadowCentered(
  ctx: CanvasRenderingContext2D,
  value: string,
  cx: number,
  y: number,
  color: string,
  scale = 1,
): void {
  shadowText(ctx, value, Math.round(cx - textWidth(value, scale) / 2), y, color, scale);
}

// Far beehive kilns with lit doors and smoke, then nearer chimney stacks.
function drawSky(ctx: CanvasRenderingContext2D, camX: number, heat: number, time: number): void {
  for (let y = 0; y < VIEW_H; y += 2) {
    const t = y / VIEW_H;
    const r = 18 + t * (70 + heat * 50);
    const g = 12 + t * 22;
    const b = 14 + t * 6;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(0, y, VIEW_W, 2);
  }
  for (let i = 0; i < 14; i++) {
    const sx = wrap(i * 53 - camX * 0.05, VIEW_W + 10) - 5;
    const sy = 8 + (hash(i, 9) % 70);
    if (Math.sin(time * (1 + (i % 3)) + i) > 0.2) {
      ctx.fillStyle = i % 4 === 0 ? glaze : "#7a5040";
      ctx.fillRect(sx | 0, sy, 1, 1);
    }
  }
  const pulse = 0.28 + Math.sin(time * 0.9) * 0.06;
  ctx.fillStyle = heat > 0.6 ? "#e07a3d" : "#8a4030";
  ctx.globalAlpha = pulse;
  ctx.fillRect(0, 156 - heat * 16, VIEW_W, 6);
  ctx.globalAlpha = pulse * 0.5;
  ctx.fillRect(0, 150 - heat * 16, VIEW_W, 4);
  ctx.globalAlpha = 1;

  const farSpan = VIEW_W + 140;
  const far = -camX * 0.12;
  for (let i = 0; i < 5; i++) {
    const cx = wrap(i * 92 + far + 30, farSpan) - 70;
    const w = 26 + (hash(i, 5) % 3) * 6;
    const h = 22 + (hash(i, 6) % 3) * 6;
    const base = 160;
    ctx.fillStyle = "#1f130f";
    for (let dy = 0; dy < h; dy += 2) {
      const half = Math.round(w * Math.sqrt(1 - (dy / h) ** 2));
      ctx.fillRect(Math.round(cx - half), base - dy - 2, half * 2, 2);
    }
    ctx.fillRect(Math.round(cx - 3), base - h - 10, 6, 10);
    const glow = 0.55 + Math.sin(time * 2.3 + i * 1.7) * 0.25;
    ctx.globalAlpha = glow;
    ctx.fillStyle = coal;
    ctx.fillRect(Math.round(cx - 4), base - 8, 8, 8);
    ctx.fillStyle = glaze;
    ctx.fillRect(Math.round(cx - 2), base - 5, 4, 5);
    ctx.globalAlpha = 1;
    for (let k = 0; k < 5; k++) {
      const age = wrap(time * 0.35 + k / 5 + i * 0.13, 1);
      const px = cx + Math.sin(age * 5 + i) * 4 + age * 18;
      const py = base - h - 12 - age * 70;
      const size = 3 + Math.round(age * 7);
      ctx.globalAlpha = 0.22 * (1 - age);
      ctx.fillStyle = "#4a3a34";
      ctx.fillRect(Math.round(px - size / 2), Math.round(py), size, size);
    }
    ctx.globalAlpha = 1;
  }

  const span = VIEW_W + 90;
  const par = -camX * 0.3;
  for (let i = 0; i < 9; i++) {
    const x = wrap(i * 74 + par, span) - 46;
    const h = 24 + (hash(i, 3) % 3) * 14;
    ctx.fillStyle = "#2a1814";
    ctx.fillRect(x, 170 - h, 26, h);
    ctx.fillStyle = "#3a2218";
    ctx.fillRect(x + 8, 170 - h - 8, 8, 8);
    ctx.fillStyle = "#1f120e";
    for (let wy = 170 - h + 6; wy < 166; wy += 10) ctx.fillRect(x + 4, wy, 18, 1);
    if (Math.sin(time * 3 + i * 2.1) > -0.3) {
      ctx.fillStyle = coal;
      ctx.fillRect(x + 10, 170 - h - 9, 4, 1);
    }
  }
}

// Molten floor glimpsed through open pits.
function drawLava(ctx: CanvasRenderingContext2D, x: number, tx: number, time: number, lights: Light[]): void {
  for (let i = 0; i < TILE; i += 2) {
    const wx = tx * TILE + i;
    const top = 229 + Math.round(Math.sin(time * 2.6 + wx * 0.22) * 1.5 + Math.sin(time * 1.3 + wx * 0.07));
    ctx.fillStyle = "#8a1e0e";
    ctx.fillRect(x + i, top, 2, VIEW_H - top);
    ctx.fillStyle = "#e0501e";
    ctx.fillRect(x + i, top, 2, 3);
    ctx.fillStyle = coal;
    ctx.fillRect(x + i, top, 2, 1);
    if (hash(wx, Math.floor(time * 3)) % 23 === 0) {
      ctx.fillStyle = "#fff2cc";
      ctx.fillRect(x + i, top + 4, 1, 1);
    }
  }
  lights.push({ x: x + 8, y: 236, r: 34, rgb: RGB.lava, a: 0.22 + Math.sin(time * 2 + tx) * 0.05 });
}

function drawClay(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, tint: string): void {
  const n = hash(tx, ty);
  ctx.fillStyle = clayDark;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = tint;
  ctx.fillRect(x, y, TILE - 1, TILE - 1);
  ctx.fillStyle = clayLight;
  ctx.fillRect(x, y, TILE - 1, 2);
  ctx.fillStyle = "#3d1c16";
  ctx.fillRect(x, y + 7, TILE - 1, 1);
  ctx.fillRect(x + 7, y, 1, 7);
  ctx.fillRect(x + (n % 6), y + 8, 1, 7);
}

function drawSocket(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.fillStyle = "#1a100e";
  ctx.fillRect(x + 2, y + 2, 12, 12);
  ctx.fillStyle = Math.sin(time * 4) > 0 ? slagBright : slag;
  for (const [ox, oy, w, h] of [
    [2, 2, 3, 1],
    [2, 2, 1, 3],
    [11, 2, 3, 1],
    [13, 2, 1, 3],
    [2, 13, 3, 1],
    [2, 11, 1, 3],
    [11, 13, 3, 1],
    [13, 11, 1, 3],
  ] as const) {
    ctx.fillRect(x + ox, y + oy, w, h);
  }
}

function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    const ox = x + 1 + i * 5;
    ctx.fillStyle = "#8d847c";
    ctx.fillRect(ox + 1, y + 5, 3, 9);
    ctx.fillRect(ox, y + 11, 5, 4);
    ctx.fillStyle = "#f0e6d8";
    ctx.fillRect(ox + 2, y + 5, 1, 3);
    ctx.fillStyle = "#c45032";
    ctx.fillRect(ox, y + 14, 5, 2);
  }
}

function drawCrack(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, bump: number): void {
  const lift = bump > 0 ? -Math.sin((1 - bump / 0.16) * Math.PI) * 4 : 0;
  drawClay(ctx, x, y + lift, tx, ty, "#c46a45");
  ctx.fillStyle = "#2a120e";
  ctx.fillRect(x + 4, y + lift + 3, 1, 8);
  ctx.fillRect(x + 4, y + lift + 7, 6, 1);
  ctx.fillStyle = glaze;
  ctx.fillRect(x + 8, y + lift + 5, 2, 2);
}

function drawBrick(ctx: CanvasRenderingContext2D, x: number, y: number, hot: number, locked: boolean): void {
  const tint = locked ? clay : hot > 0.66 ? glaze : hot > 0.33 ? coal : "#c45032";
  drawClay(ctx, x, y, 0, 0, tint);
  if (locked) {
    ctx.fillStyle = slag;
    ctx.fillRect(x + 3, y + 3, 2, 9);
    ctx.fillStyle = slagBright;
    ctx.fillRect(x + 3, y + 3, 2, 2);
  } else {
    ctx.fillStyle = "#fff2cc";
    ctx.globalAlpha = hot;
    ctx.fillRect(x + 6, y + 5, 3, 3);
    ctx.globalAlpha = 1;
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, tx: number): void {
  const bob = Math.round(Math.sin(time * 5 + tx) * 2);
  const half = Math.max(1, Math.round(Math.abs(Math.cos(time * 3.2 + tx * 0.6)) * 3));
  ctx.fillStyle = "#8a6430";
  ctx.fillRect(x + 8 - half, y + 4 + bob, half * 2, 8);
  ctx.fillStyle = glaze;
  ctx.fillRect(x + 9 - half, y + 5 + bob, Math.max(1, half * 2 - 2), 6);
  if (half > 1) {
    ctx.fillStyle = "#fff2cc";
    ctx.fillRect(x + 9 - half, y + 5 + bob, 1, 3);
  }
  if (Math.sin(time * 2 + tx * 1.3) > 0.94) {
    ctx.fillStyle = "#fff2cc";
    ctx.fillRect(x + 11, y + 2 + bob, 1, 3);
    ctx.fillRect(x + 10, y + 3 + bob, 3, 1);
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, x: number, y: number, secret: boolean, time: number): void {
  ctx.fillStyle = secret ? slag : clayDark;
  ctx.fillRect(x + 1, y + 2, 14, 3);
  ctx.fillRect(x + 1, y + 2, 2, 14);
  ctx.fillRect(x + 13, y + 2, 2, 14);
  ctx.fillStyle = "#1a100e";
  ctx.fillRect(x + 4, y + 6, 8, 10);
  const glow = 0.45 + Math.sin(time * 3) * 0.15;
  ctx.globalAlpha = glow;
  ctx.fillStyle = secret ? slagBright : coal;
  ctx.fillRect(x + 6, y + 10, 4, 6);
  ctx.globalAlpha = 1;
}

function drawBrazier(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean, time: number): void {
  ctx.fillStyle = smoke;
  ctx.fillRect(x + 7, y + 4, 2, 8);
  ctx.fillStyle = clayDark;
  ctx.fillRect(x + 4, y + 10, 8, 4);
  ctx.fillStyle = "#3d1c16";
  ctx.fillRect(x + 3, y + 13, 10, 3);
  if (lit) {
    const lick = Math.floor(time * 12) % 3;
    ctx.fillStyle = "#c45032";
    ctx.fillRect(x + 5, y + 5, 6, 5);
    ctx.fillStyle = coal;
    ctx.fillRect(x + 6, y + 2 + (lick === 1 ? 1 : 0), 4, 5);
    ctx.fillStyle = glaze;
    ctx.fillRect(x + 7, y + (lick === 2 ? 0 : 1), 2, 6);
    ctx.fillStyle = "#fff2cc";
    ctx.fillRect(x + 7, y + 6, 2, 2);
  }
}

function drawKeeper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: number,
  holding: boolean,
  pose: "idle" | "run" | "jump" | "fall" | "dead",
  tint?: string,
): void {
  const paint = (color: string) => {
    ctx.fillStyle = tint ?? color;
  };
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (facing < 0) {
    ctx.translate(PLAYER_W, 0);
    ctx.scale(-1, 1);
  }
  if (pose === "dead") {
    ctx.translate(0, 14);
    ctx.scale(1, -1);
  }
  const tuck = pose === "jump" ? -2 : pose === "fall" ? 1 : 0;
  // Scarf tail streams behind while moving.
  const flap = pose === "run" ? (frame === 1 ? 1 : 0) : pose === "jump" ? 2 : pose === "fall" ? -1 : 0;
  paint("#8a2e20");
  if (pose === "idle" || pose === "dead") {
    ctx.fillRect(0, 5, 2, 2);
    ctx.fillRect(-1, 7, 2, 3);
  } else {
    ctx.fillRect(-2, 5 + (flap < 0 ? 1 : 0), 3, 2);
    ctx.fillRect(-4, 5 + flap, 2, 2);
  }
  paint(hood);
  ctx.fillRect(2, 0, 6, 2);
  ctx.fillRect(1, 2, 8, 4);
  paint(smoke);
  ctx.fillRect(2, 0, 6, 1);
  paint(glaze);
  ctx.fillRect(6, 3, 2, 2);
  paint("#c4442e");
  ctx.fillRect(1, 5, 8, 2);
  paint(cloth);
  ctx.fillRect(2, 7, 6, 4);
  paint(holding ? glaze : "#5a4638");
  ctx.fillRect(4, 8, 2, 2);
  const step = pose === "run" && frame === 1 ? 1 : 0;
  paint(hood);
  ctx.fillRect(2, 11 + tuck, 2, 3);
  ctx.fillRect(6, 11 - step + tuck, 2, 3 + step);
  if (holding) {
    const bob = pose === "run" && frame === 1 ? -1 : 0;
    paint(glaze);
    ctx.fillRect(8, 5 + bob, 4, 3);
    paint("#fff2cc");
    ctx.fillRect(9, 5 + bob, 2, 1);
    paint(clay);
    ctx.fillRect(8, 7 + bob, 4, 1);
  }
  ctx.restore();
}

function drawSpring(ctx: CanvasRenderingContext2D, x: number, y: number, compressed: boolean): void {
  const squash = compressed ? 4 : 0;
  ctx.fillStyle = hood;
  ctx.fillRect(x + 2, y + 13, 12, 3);
  ctx.fillStyle = slag;
  ctx.fillRect(x + 3, y + 10 + squash, 10, 2);
  ctx.fillStyle = glaze;
  ctx.fillRect(x + 4, y + 7 + squash, 8, 2);
  ctx.fillStyle = coal;
  ctx.fillRect(x + 5, y + 4 + squash, 6, 2);
  ctx.fillStyle = "#fff2cc";
  ctx.fillRect(x + 6, y + 2 + squash, 4, 2);
}

function drawGate(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.fillStyle = "#1a100e";
  ctx.fillRect(x + 2, y, 12, TILE);
  ctx.fillStyle = slag;
  const shift = Math.floor(time * 3) % 2;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i * 3, y + shift, 1, TILE - 1);
  ctx.fillStyle = slagBright;
  ctx.fillRect(x + 2, y, 12, 1);
  ctx.fillRect(x + 2, y + TILE - 2, 12, 1);
}

function drawShelf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.fillStyle = clayDark;
  ctx.fillRect(px, py, w, 8);
  ctx.fillStyle = clay;
  ctx.fillRect(px, py, w, 5);
  ctx.fillStyle = clayLight;
  ctx.fillRect(px, py, w, 2);
  ctx.fillStyle = slag;
  ctx.fillRect(px + 2, py + 3, 3, 2);
  ctx.fillRect(px + w - 5, py + 3, 3, 2);
}

function drawWasp(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const wing = frame ? 4 : 2;
  ctx.fillStyle = coal;
  ctx.fillRect(px + 1, py + 3 - wing, 4, wing);
  ctx.fillRect(px + 9, py + 3 - wing, 4, wing);
  ctx.fillStyle = hood;
  ctx.fillRect(px + 4, py + 3, 6, 5);
  ctx.fillStyle = glaze;
  ctx.fillRect(px + 5, py + 4, 2, 2);
  ctx.fillStyle = "#fff2cc";
  ctx.fillRect(px + 8, py + 4, 1, 1);
}

function drawCrab(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.fillStyle = hood;
  ctx.fillRect(px + 2, py + 3, 10, 5);
  ctx.fillStyle = slag;
  ctx.fillRect(px + 1, py + 4, 12, 4);
  ctx.fillStyle = hood;
  ctx.fillRect(px + 3, py + 5, 2, 2);
  ctx.fillRect(px + 9, py + 5, 2, 2);
  ctx.fillStyle = coal;
  ctx.fillRect(px + 3, py + 5, 1, 1);
  ctx.fillRect(px + 9, py + 5, 1, 1);
  const leg = frame ? 1 : 0;
  ctx.fillStyle = hood;
  ctx.fillRect(px + 1, py + 8, 2, 2 + leg);
  ctx.fillRect(px + 11, py + 8 - leg, 2, 2 + leg);
}

function drawWorld(ctx: CanvasRenderingContext2D, world: World, reduced: boolean, fx: Fx): void {
  const cam = Math.round(world.camX);
  const lights: Light[] = [];
  const flicker = (seed: number) => (reduced ? 1 : 0.85 + Math.sin(world.time * 9 + seed) * 0.08 + Math.sin(world.time * 23 + seed * 3) * 0.07);
  drawSky(ctx, cam, world.level.heat, reduced ? 0 : world.time);
  const x0 = Math.max(0, Math.floor(cam / TILE) - 1);
  const x1 = Math.min(world.level.width - 1, Math.ceil((cam + VIEW_W) / TILE) + 1);
  const bottom = world.level.height - 1;

  // Open pits and spike beds both sit over molten slag.
  const molten = new Set<number>();
  for (let tx = x0; tx <= x1; tx++) {
    const floor = world.cells[bottom * world.level.width + tx]!;
    const bed = world.cells[(bottom - 1) * world.level.width + tx]!;
    if (!floor.solid || bed.spike) {
      molten.add(tx);
      ctx.fillStyle = "#1a0c08";
      ctx.fillRect(tx * TILE - cam, bottom * TILE, TILE, TILE);
      drawLava(ctx, tx * TILE - cam, tx, world.time, lights);
    }
  }

  for (let ty = 0; ty < world.level.height; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const cell = world.cells[ty * world.level.width + tx]!;
      const x = tx * TILE - cam;
      const y = ty * TILE;
      if (cell.solid && cell.crack) {
        drawCrack(ctx, x, y, tx, ty, world.bumps.get(`${tx},${ty}`) ?? 0);
        lights.push({ x: x + 9, y: y + 6, r: 12, rgb: RGB.glaze, a: 0.12 + Math.sin(world.time * 4 + tx) * 0.05 });
      } else if (cell.solid && !(ty === bottom && molten.has(tx))) {
        drawClay(ctx, x, y, tx, ty, (hash(tx, ty) % 5 === 0 ? "#a24b38" : clay));
        const above = ty > 0 ? world.cells[(ty - 1) * world.level.width + tx] : undefined;
        if (above && !above.solid && !above.gate) {
          ctx.fillStyle = "#e8946e";
          ctx.fillRect(x, y, TILE - 1, 1);
        }
      }
      if (cell.socket) {
        drawSocket(ctx, x, y, world.time);
        lights.push({ x: x + 8, y: y + 8, r: 16, rgb: RGB.slag, a: 0.1 + Math.max(0, Math.sin(world.time * 4)) * 0.12 });
      }
      if (cell.spike && !world.bricks.some((brick) => brick.tx === tx && brick.ty === ty)) drawSpikes(ctx, x, y);
      if (cell.spring) {
        drawSpring(ctx, x, y, (world.bumps.get(`s${tx},${ty}`) ?? 0) > 0);
        lights.push({ x: x + 8, y: y + 6, r: 18, rgb: RGB.glaze, a: 0.16 });
      }
      if (cell.gate && !world.gatesOpen) {
        drawGate(ctx, x, y, world.time);
        lights.push({ x: x + 8, y: y + 8, r: 14, rgb: RGB.slag, a: 0.12 });
      }
      if (cell.coin) {
        drawCoin(ctx, x, y, world.time, tx);
        lights.push({ x: x + 8, y: y + 8, r: 14, rgb: RGB.glaze, a: 0.16 });
      }
      if (cell.exit) {
        drawMouth(ctx, x, y, false, world.time);
        lights.push({ x: x + 8, y: y + 12, r: 46, rgb: RGB.coal, a: 0.4 * flicker(tx) });
      }
      if (cell.secret) {
        drawMouth(ctx, x, y, true, world.time);
        lights.push({ x: x + 8, y: y + 12, r: 40, rgb: RGB.slag, a: 0.32 * flicker(tx) });
      }
      if (cell.flag) {
        const lit = world.flags.has(`${tx},${ty}`);
        drawBrazier(ctx, x, y, lit, world.time);
        if (lit) lights.push({ x: x + 8, y: y + 5, r: 36, rgb: RGB.coal, a: 0.38 * flicker(tx + ty) });
      }
    }
  }

  for (const mover of world.movers) drawShelf(ctx, mover.x - cam, mover.y, mover.w);

  for (const brick of world.bricks) {
    const hot = brick.locked ? 1 : Math.max(0, brick.ttl / BRICK_LIFE);
    const flash = !brick.locked && brick.ttl < 1.5 && Math.floor(world.time * 10) % 2 === 0;
    const bx = brick.tx * TILE - cam;
    const by = brick.ty * TILE;
    drawBrick(ctx, bx, by, flash ? 1 : hot, brick.locked);
    lights.push(
      brick.locked
        ? { x: bx + 8, y: by + 8, r: 20, rgb: RGB.slag, a: 0.14 }
        : { x: bx + 8, y: by + 8, r: 16 + hot * 18, rgb: RGB.glaze, a: 0.1 + hot * 0.3 },
    );
  }

  if (world.player.holding && world.status === "play") {
    const ghost = placeTarget(world);
    if (ghost) {
      const cell = world.cells[ghost.ty * world.level.width + ghost.tx];
      ctx.globalAlpha = 0.55;
      drawBrick(ctx, ghost.tx * TILE - cam, ghost.ty * TILE, 1, cell?.socket === true);
      ctx.globalAlpha = 1;
    }
  }

  const frame = Math.floor(world.time * 8) % 2;
  for (const enemy of world.enemies) {
    if (!enemy.alive && enemy.squash <= 0) continue;
    if (enemy.squash > 0 && !enemy.alive) {
      ctx.fillStyle = enemy.kind === "wasp" ? coal : hood;
      ctx.fillRect(Math.round(enemy.x - cam) + 1, Math.round(enemy.y) + 7, 12, 3);
      continue;
    }
    ctx.fillStyle = "rgba(10,6,4,0.35)";
    if (enemy.kind === "crab") ctx.fillRect(Math.round(enemy.x - cam) + 2, Math.round(enemy.y) + 10, 10, 1);
    if (enemy.kind === "wasp") {
      drawWasp(ctx, enemy.x - cam, enemy.y, frame);
      lights.push({ x: enemy.x - cam + 6, y: enemy.y + 5, r: 12, rgb: RGB.coal, a: 0.14 });
    } else drawCrab(ctx, enemy.x - cam, enemy.y, frame);
  }

  for (const ghost of fx.trail) {
    ctx.globalAlpha = Math.max(0, ghost.life / 0.22) * 0.35;
    drawKeeper(ctx, ghost.x - cam, ghost.y, 0, ghost.facing, ghost.holding, "jump", coal);
  }
  ctx.globalAlpha = 1;

  if (world.player.holding && world.status !== "dead") {
    lights.push({
      x: world.player.x - cam + PLAYER_W / 2 + world.player.facing * 5,
      y: world.player.y + 6,
      r: 30,
      rgb: RGB.glaze,
      a: 0.28 * flicker(1),
    });
  }

  const blink = world.player.invuln > 0 && Math.floor(world.time * 14) % 2 === 0;
  if (!blink) {
    const airborne = !world.player.grounded;
    const pose =
      world.status === "dead"
        ? "dead"
        : airborne && world.player.vy < -30
          ? "jump"
          : airborne
            ? "fall"
            : Math.abs(world.player.vx) > 20
              ? "run"
              : "idle";
    const squash = !reduced && world.player.landed > 0 && world.player.grounded ? 1 : airborne && !reduced ? -1 : 0;
    drawKeeper(
      ctx,
      world.player.x - cam,
      world.player.y + squash,
      frame,
      world.player.facing,
      world.player.holding,
      reduced && pose === "jump" ? "idle" : pose,
    );
  }

  for (const particle of world.particles) {
    const fade = Math.max(0, particle.life / particle.max);
    const px = Math.round(particle.x - cam);
    const py = Math.round(particle.y);
    ctx.globalAlpha = fade;
    ctx.fillStyle = particle.color;
    ctx.fillRect(px, py, 2, 2);
    const hot = particle.color === coal || particle.color === glaze || particle.color === "#c45032";
    if (hot) lights.push({ x: px + 1, y: py + 1, r: 6, rgb: particle.color === glaze ? RGB.glaze : RGB.coal, a: 0.3 * fade });
    if (hot && fade > 0.6) {
      ctx.fillStyle = "#fff2cc";
      ctx.fillRect(px, py, 1, 1);
    }
  }
  ctx.globalAlpha = 1;

  drawLights(ctx, lights);
  drawVignette(ctx, 0.5);

  for (const popup of fx.popups) {
    ctx.globalAlpha = Math.min(1, popup.life / 0.25);
    shadowText(ctx, popup.text, Math.round(popup.x - cam), Math.round(popup.y), popup.color, 1);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = soot;
  ctx.fillRect(8, 6, 12, 10);
  ctx.fillStyle = world.player.holding ? glaze : clayDark;
  ctx.fillRect(9, 7, 10, 8);
  if (!world.player.holding) {
    ctx.fillStyle = soot;
    ctx.fillRect(11, 9, 6, 4);
  }
  const loose = world.bricks.filter((brick) => !brick.locked);
  if (loose.length > 0) {
    const ttl = Math.min(...loose.map((brick) => brick.ttl));
    const hot = Math.max(0, Math.min(1, ttl / BRICK_LIFE));
    const warn = ttl < 1.6 && Math.floor(world.time * 8) % 2 === 0;
    ctx.fillStyle = hood;
    ctx.fillRect(24, 8, 28, 4);
    ctx.fillStyle = warn ? "#fff2cc" : hot > 0.45 ? glaze : coal;
    ctx.fillRect(25, 9, Math.max(1, Math.round(26 * hot)), 2);
  }
  const coinCount = String(world.collected.size);
  const coinX = VIEW_W - 22 - coinCount.length * 6;
  drawCoin(ctx, coinX, 2, world.time, 1);
  shadowText(ctx, coinCount, VIEW_W - 8 - coinCount.length * 6, 8, glaze, 1);
  const hasGate = world.cells.some((cell) => cell.gate);
  if (hasGate && !world.gatesOpen) {
    const left = world.cells.reduce((sum, cell) => sum + (cell.coin ? 1 : 0), 0);
    if (left > 0) {
      const label = `${left} LEFT`;
      shadowText(ctx, label, coinX - 8 - label.length * 6, 8, smoke, 1);
    }
  }

  if (world.time < 2) {
    shadowCentered(ctx, world.level.name, VIEW_W / 2, 8, smoke, 1);
  } else if (world.hintLeft > 0) {
    shadowCentered(ctx, world.level.hint, VIEW_W / 2, 8, smoke, 1);
  }
}

function drawGroundLine(ctx: CanvasRenderingContext2D, y: number): void {
  for (let x = 16; x < VIEW_W - 16; x += TILE) drawClay(ctx, x, y, x, 1, clay);
}

function drawEmbers(ctx: CanvasRenderingContext2D, time: number, count: number, lights: Light[]): void {
  for (let i = 0; i < count; i++) {
    const period = 3 + (hash(i, 1) % 30) / 10;
    const age = wrap(time / period + (hash(i, 2) % 100) / 100, 1);
    const x = Math.round((hash(i, 3) % VIEW_W) + Math.sin(time * 1.5 + i) * 6 - age * 24);
    const y = Math.round(VIEW_H + 8 - age * 230);
    const fade = 1 - age;
    ctx.globalAlpha = fade;
    ctx.fillStyle = i % 3 === 0 ? glaze : i % 3 === 1 ? coal : "#c45032";
    const size = i % 5 === 0 ? 2 : 1;
    ctx.fillRect(x, y, size, size);
    if (size === 2) lights.push({ x, y, r: 6, rgb: RGB.coal, a: 0.3 * fade });
  }
  ctx.globalAlpha = 1;
}

function drawTitle(ctx: CanvasRenderingContext2D, time: number, reduced: boolean): void {
  const lights: Light[] = [];
  const t = reduced ? 0 : time;
  drawSky(ctx, t * 8, 0.8, t);
  if (!reduced) drawEmbers(ctx, time, 46, lights);
  drawGroundLine(ctx, 168);
  const socketX = 152;
  drawSocket(ctx, socketX, 168, time);
  const cycle = reduced ? 1 : (time % 2.4) / 2.4;
  const drop = cycle < 0.55 ? Math.round((1 - cycle / 0.55) * 36) : 0;
  const locked = cycle >= 0.55;
  drawBrick(ctx, socketX, 168 - drop, locked ? 0.2 : 1, locked);
  lights.push(
    locked
      ? { x: socketX + 8, y: 176, r: 26 + (1 - Math.min(1, (cycle - 0.55) * 4)) * 30, rgb: RGB.slag, a: 0.3 }
      : { x: socketX + 8, y: 176 - drop, r: 26, rgb: RGB.glaze, a: 0.35 },
  );
  if (locked && cycle < 0.62 && !reduced) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI + Math.PI;
      const r = (cycle - 0.55) * 300;
      ctx.fillStyle = slagBright;
      ctx.fillRect(Math.round(socketX + 8 + Math.cos(a) * r), Math.round(170 + Math.sin(a) * r * 0.5), 2, 2);
    }
  }
  drawKeeper(ctx, 118, 154, Math.floor(time * 3) % 2, 1, false, "idle");

  const flick = reduced ? 1 : 0.85 + Math.sin(time * 7) * 0.06 + Math.sin(time * 17) * 0.05;
  lights.push({ x: VIEW_W / 2, y: 62, r: 90, rgb: RGB.coal, a: 0.28 * flick });
  drawLights(ctx, lights);
  drawVignette(ctx, 0.55);

  const title = "Kiln";
  const tx = Math.round(VIEW_W / 2 - textWidth(title, 6) / 2);
  drawText(ctx, title, tx + 3, 42, soot, 6);
  drawText(ctx, title, tx + 2, 41, clayDark, 6);
  drawText(ctx, title, tx + 1, 40, "#c45032", 6);
  drawText(ctx, title, tx, 38, glaze, 6);
  ctx.globalAlpha = 0.5 * flick;
  drawText(ctx, title, tx, 38, "#fff2cc", 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = coal;
  ctx.fillRect(tx, 86, textWidth(title, 6) - 6, 2);
  shadowCentered(ctx, "One brick. Every fire.", VIEW_W / 2, 96, smoke, 1);
  if (reduced || Math.floor(time * 2) % 2 === 0) shadowCentered(ctx, "Jump to start", VIEW_W / 2, 124, glaze, 1);
  shadowCentered(ctx, "Arrows move   Z jumps   X sets a brick", VIEW_W / 2, 208, slagBright, 1);
  shadowCentered(ctx, "R restarts   M mutes   Esc pauses", VIEW_W / 2, 220, "#7a9a84", 1);
}

function drawTunnel(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  hot: boolean,
  secret: boolean,
  time: number,
): void {
  const length = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, length / 8);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    ctx.fillStyle = "#140c0a";
    ctx.fillRect(x - (secret ? 3 : 4), y - 3, secret ? 6 : 8, 6);
    ctx.fillStyle = secret ? (hot ? slag : "#2a3832") : hot ? clay : "#3a241c";
    ctx.fillRect(x - (secret ? 2 : 3), y - 2, secret ? 4 : 6, 4);
  }
  if (!hot) return;
  const dots = Math.max(1, Math.round(length / 28));
  for (let k = 0; k < dots; k++) {
    const t = wrap(time * (40 / length) + k / dots, 1);
    ctx.fillStyle = secret ? slagBright : glaze;
    ctx.fillRect(Math.round(ax + (bx - ax) * t) - 1, Math.round(ay + (by - ay) * t) - 1, 2, 2);
  }
}

function drawMap(ctx: CanvasRenderingContext2D, scene: Extract<Scene, { kind: "map" }>): void {
  const time = scene.reduced ? 0 : scene.time;
  const lights: Light[] = [];
  drawSky(ctx, 20, 0.55, time);
  ctx.fillStyle = "#2a1814";
  ctx.fillRect(18, 16, 18, 210);
  for (let y = 16; y < 226; y += 8) {
    ctx.fillStyle = y % 16 === 0 ? clayDark : "#3a221c";
    ctx.fillRect(18, y, 18, 7);
  }
  for (let k = 0; k < 6; k++) {
    const age = wrap(time * 0.3 + k / 6, 1);
    const size = 4 + Math.round(age * 10);
    ctx.globalAlpha = 0.3 * (1 - age);
    ctx.fillStyle = "#5a4a44";
    ctx.fillRect(Math.round(27 - size / 2 + Math.sin(age * 6) * 5), Math.round(12 - age * 40), size, size);
  }
  ctx.globalAlpha = 1;

  for (const link of LINKS) {
    if (!isVisible(link.to, scene.progress) || !isVisible(link.from, scene.progress)) continue;
    const a = NODES[link.from];
    const b = NODES[link.to];
    const hot = scene.progress.cleared.includes(link.from);
    drawTunnel(ctx, a.x, a.y, b.x, b.y, hot, link.gate === "secret", time);
  }

  const here = (Object.keys(NODES) as NodeId[]).find(
    (id) => Math.hypot(NODES[id].x - scene.pos.x, NODES[id].y - scene.pos.y) < 2,
  );

  for (const id of Object.keys(NODES) as NodeId[]) {
    if (!isVisible(id, scene.progress)) continue;
    const node = NODES[id];
    const unlocked = scene.progress.unlocked.includes(id);
    const cleared = scene.progress.cleared.includes(id);
    if (id === here && unlocked) {
      const pulse = Math.round((Math.sin(time * 5) + 1) * 1.5);
      ctx.fillStyle = slagBright;
      ctx.fillRect(node.x - 18 - pulse, node.y - 20 - pulse, 36 + pulse * 2, 1);
      ctx.fillRect(node.x - 18 - pulse, node.y + 9 + pulse, 36 + pulse * 2, 1);
      ctx.fillRect(node.x - 18 - pulse, node.y - 20 - pulse, 1, 30 + pulse * 2);
      ctx.fillRect(node.x + 17 + pulse, node.y - 20 - pulse, 1, 30 + pulse * 2);
    }
    ctx.fillStyle = unlocked ? clayDark : "#2a201c";
    ctx.fillRect(node.x - 16, node.y - 18, 32, 26);
    ctx.fillStyle = unlocked ? "#7a3a2c" : "#2a201c";
    ctx.fillRect(node.x - 16, node.y - 18, 32, 1);
    ctx.fillStyle = cleared ? coal : unlocked ? "#6a3028" : "#1a100e";
    ctx.fillRect(node.x - 12, node.y - 12, 24, 16);
    if (cleared) {
      ctx.fillStyle = "#c45032";
      ctx.fillRect(node.x - 12, node.y, 24, 4);
      const lick = Math.floor(time * 10 + node.x) % 3;
      ctx.fillStyle = glaze;
      ctx.fillRect(node.x - 6 + lick, node.y - 4, 3, 4);
      ctx.fillRect(node.x + 3 - lick, node.y - 3, 3, 3);
      lights.push({ x: node.x, y: node.y - 4, r: 30, rgb: RGB.coal, a: 0.3 + Math.sin(time * 6 + node.x) * 0.05 });
    } else if (unlocked) {
      lights.push({ x: node.x, y: node.y - 4, r: 18, rgb: RGB.coal, a: 0.08 });
    }
    if (id === "cinder" || scene.progress.secrets.includes(id)) {
      ctx.fillStyle = slag;
      ctx.fillRect(node.x - 12, node.y - 14, 24, 2);
      lights.push({ x: node.x, y: node.y - 13, r: 16, rgb: RGB.slag, a: 0.16 });
    }
    shadowCentered(ctx, node.name, node.x, node.y + 14, unlocked ? smoke : "#6a5a50", 1);
    if (cleared) {
      ctx.fillStyle = "#fff2cc";
      ctx.fillRect(node.x - 2, node.y - 8, 4, 4);
    }
  }

  drawLights(ctx, lights);
  drawVignette(ctx, 0.45);
  const bob = Math.round(Math.sin(time * 4));
  ctx.fillStyle = "rgba(10,6,4,0.5)";
  ctx.fillRect(Math.round(scene.pos.x) - 4, Math.round(scene.pos.y) - 8, 9, 2);
  drawKeeper(ctx, scene.pos.x - 5, scene.pos.y - 22 + bob, Math.floor(scene.time * 4) % 2, 1, false, "idle");
  shadowText(ctx, "The flue", 44, 12, glaze, 2);
  const coinCount = String(scene.coins);
  drawCoin(ctx, VIEW_W - 22 - coinCount.length * 6, 10, scene.time, 2);
  shadowText(ctx, coinCount, VIEW_W - 8 - coinCount.length * 6, 16, glaze, 1);
  shadowCentered(ctx, "Arrows move    jump enters", VIEW_W / 2, 222, slagBright, 1);
  if (scene.mute) shadowText(ctx, "Muted", 44, 30, smoke, 1);
}

const SPARK_RGB = [RGB.glaze, RGB.coal, RGB.slag] as const;
const SPARK_HEX = [glaze, coal, slagBright] as const;

function drawWon(ctx: CanvasRenderingContext2D, time: number, reduced: boolean): void {
  const lights: Light[] = [];
  drawSky(ctx, reduced ? 0 : time * 4, 1, reduced ? 0 : time);
  if (!reduced) {
    drawEmbers(ctx, time, 60, lights);
    const period = 1.8;
    for (let b = 0; b < 4; b++) {
      const local = time + b * 0.45;
      const round = Math.floor(local / period);
      const age = local - round * period;
      const cx = 40 + (hash(round, b + 7) % 240);
      const cy = 30 + (hash(b + 3, round) % 70);
      const tone = hash(round, b) % 3;
      const fade = Math.max(0, 1 - age / 1.2);
      if (fade <= 0) continue;
      ctx.fillStyle = SPARK_HEX[tone]!;
      ctx.globalAlpha = fade;
      for (let k = 0; k < 20; k++) {
        const angle = (k / 20) * Math.PI * 2;
        const speed = 34 + (hash(k, round + b) % 18);
        const x = cx + Math.cos(angle) * speed * age;
        const y = cy + Math.sin(angle) * speed * age + 26 * age * age;
        ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
      }
      ctx.globalAlpha = 1;
      lights.push({ x: cx, y: cy, r: 50 * (0.5 + age), rgb: SPARK_RGB[tone]!, a: 0.35 * fade });
    }
  }
  drawGroundLine(ctx, 176);
  drawBrick(ctx, 152, 160, 0.4, true);
  drawMouth(ctx, 152, 144, false, time);
  drawKeeper(ctx, 128, 162, 0, 1, false, reduced || Math.floor(time * 2) % 2 === 0 ? "idle" : "jump");
  lights.push({ x: 160, y: 156, r: 70, rgb: RGB.coal, a: 0.4 + Math.sin(time * 5) * 0.05 });
  drawLights(ctx, lights);
  drawVignette(ctx, 0.5);
  shadowCentered(ctx, "The kiln stays lit", VIEW_W / 2, 64, glaze, 2);
  if (reduced || Math.floor(time * 2) % 2 === 0) shadowCentered(ctx, "Jump returns to the flue", VIEW_W / 2, 210, smoke, 1);
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string, t: number): void {
  const open = easeOut(Math.min(1, t / 0.18));
  const half = Math.round(18 * open);
  ctx.fillStyle = "rgba(20,17,14,0.7)";
  ctx.fillRect(0, 114 - half, VIEW_W, half * 2);
  ctx.fillStyle = coal;
  ctx.fillRect(0, 114 - half, VIEW_W, 1);
  ctx.fillRect(0, 113 + half, VIEW_W, 1);
  const slide = Math.round((1 - easeOut(Math.min(1, t / 0.3))) * -VIEW_W);
  drawLights(ctx, [{ x: VIEW_W / 2 + slide, y: 114, r: 110, rgb: RGB.coal, a: 0.3 * open }]);
  shadowCentered(ctx, text, VIEW_W / 2 + slide, 108, glaze, 2);
}

function drawIris(ctx: CanvasRenderingContext2D, fx: Fx): void {
  if (fx.iris >= 1) return;
  const radius = Math.max(0.1, easeOut(fx.iris) * 300);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_W, VIEW_H);
  ctx.arc(fx.irisX, fx.irisY, radius, 0, Math.PI * 2);
  ctx.fillStyle = soot;
  ctx.fill("evenodd");
  ctx.beginPath();
  ctx.arc(fx.irisX, fx.irisY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = coal;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 1 - fx.iris;
  ctx.stroke();
  ctx.restore();
}

export function draw(ctx: CanvasRenderingContext2D, scene: Scene, fx: Fx): void {
  ctx.fillStyle = soot;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (scene.kind === "title") drawTitle(ctx, scene.time, scene.reduced);
  if (scene.kind === "map") drawMap(ctx, scene);
  if (scene.kind === "won") drawWon(ctx, scene.time, scene.reduced);
  if (scene.kind === "play") {
    const amp = scene.reduced ? 0 : Math.min(3, Math.round(scene.world.shake));
    ctx.save();
    if (amp > 0) {
      const seed = (scene.world.time * 30) | 0;
      ctx.translate((hash(seed, 1) % (amp * 2 + 1)) - amp, (hash(1, seed) % (amp * 2 + 1)) - amp);
    }
    drawWorld(ctx, scene.world, scene.reduced, fx);
    ctx.restore();
    if (scene.banner) drawBanner(ctx, scene.banner, scene.reduced ? 1 : scene.bannerT);
    if (scene.paused) {
      ctx.fillStyle = "rgba(20,17,14,0.72)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      shadowCentered(ctx, "Paused", VIEW_W / 2, 96, glaze, 3);
      shadowCentered(ctx, "Jump continues", VIEW_W / 2, 124, smoke, 1);
      shadowCentered(ctx, "R restarts the chamber", VIEW_W / 2, 138, smoke, 1);
      shadowCentered(ctx, "X leaves the chamber", VIEW_W / 2, 152, smoke, 1);
    }
  }
  if (fx.flash > 0) {
    ctx.globalAlpha = Math.min(0.6, fx.flash);
    ctx.fillStyle = fx.flashColor;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
  drawIris(ctx, fx);
}
