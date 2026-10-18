import { PLAYER_W, TILE, VIEW_H, VIEW_W } from "./constants";
import { drawText, drawTextCentered } from "./font";
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
  | { kind: "play"; world: World; reduced: boolean; banner: string | null; paused: boolean }
  | { kind: "won"; time: number; reduced: boolean };

function hash(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) | 0;
  return Math.abs(n);
}

function drawSky(ctx: CanvasRenderingContext2D, camX: number, heat: number): void {
  for (let y = 0; y < VIEW_H; y += 2) {
    const t = y / VIEW_H;
    const r = 18 + t * (70 + heat * 50);
    const g = 12 + t * 22;
    const b = 14 + t * 6;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(0, y, VIEW_W, 2);
  }
  ctx.fillStyle = heat > 0.6 ? "#e07a3d" : "#8a4030";
  ctx.globalAlpha = 0.28;
  ctx.fillRect(0, 156 - heat * 16, VIEW_W, 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#2a1814";
  const par = -camX * 0.3;
  for (let i = 0; i < 9; i++) {
    const x = ((((i * 74 + par) % (VIEW_W + 90)) + VIEW_W + 90) % (VIEW_W + 90)) - 46;
    const h = 24 + (hash(i, 3) % 3) * 14;
    ctx.fillRect(x, 170 - h, 26, h);
    ctx.fillStyle = "#3a2218";
    ctx.fillRect(x + 8, 170 - h - 8, 8, 8);
    ctx.fillStyle = "#2a1814";
  }
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
  ctx.fillStyle = "#8a6430";
  ctx.fillRect(x + 5, y + 4 + bob, 6, 8);
  ctx.fillStyle = glaze;
  ctx.fillRect(x + 6, y + 5 + bob, 4, 6);
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

function drawBrazier(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean): void {
  ctx.fillStyle = smoke;
  ctx.fillRect(x + 7, y + 4, 2, 8);
  ctx.fillStyle = clayDark;
  ctx.fillRect(x + 4, y + 10, 8, 4);
  if (lit) {
    ctx.fillStyle = glaze;
    ctx.fillRect(x + 6, y + 6, 4, 4);
    ctx.fillStyle = coal;
    ctx.fillRect(x + 7, y + 3, 2, 3);
  }
}

function drawKeeper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: number,
  holding: boolean,
): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (facing < 0) {
    ctx.translate(PLAYER_W, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = hood;
  ctx.fillRect(2, 0, 6, 2);
  ctx.fillRect(1, 2, 8, 4);
  ctx.fillStyle = smoke;
  ctx.fillRect(2, 0, 6, 1);
  ctx.fillStyle = glaze;
  ctx.fillRect(6, 3, 2, 2);
  ctx.fillStyle = cloth;
  ctx.fillRect(2, 6, 6, 5);
  ctx.fillStyle = holding ? glaze : "#5a4638";
  ctx.fillRect(4, 7, 2, 2);
  const step = frame === 1 ? 1 : 0;
  ctx.fillStyle = hood;
  ctx.fillRect(2, 11, 2, 3);
  ctx.fillRect(6, 11 - step, 2, 3 + step);
  if (holding) {
    ctx.fillStyle = glaze;
    ctx.fillRect(8, 6, 4, 3);
    ctx.fillStyle = clay;
    ctx.fillRect(8, 8, 4, 1);
  }
  ctx.restore();
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

function drawWorld(ctx: CanvasRenderingContext2D, world: World, reduced: boolean): void {
  const cam = Math.round(world.camX);
  drawSky(ctx, cam, world.level.heat);
  const x0 = Math.max(0, Math.floor(cam / TILE) - 1);
  const x1 = Math.min(world.level.width - 1, Math.ceil((cam + VIEW_W) / TILE) + 1);

  for (let ty = 0; ty < world.level.height; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const cell = world.cells[ty * world.level.width + tx]!;
      const x = tx * TILE - cam;
      const y = ty * TILE;
      if (cell.solid && cell.crack) {
        drawCrack(ctx, x, y, tx, ty, world.bumps.get(`${tx},${ty}`) ?? 0);
      } else if (cell.solid) {
        drawClay(ctx, x, y, tx, ty, (hash(tx, ty) % 5 === 0 ? "#a24b38" : clay));
      }
      if (cell.socket) drawSocket(ctx, x, y, world.time);
      if (cell.spike && !world.bricks.some((brick) => brick.tx === tx && brick.ty === ty)) drawSpikes(ctx, x, y);
      if (cell.coin) drawCoin(ctx, x, y, world.time, tx);
      if (cell.exit) drawMouth(ctx, x, y, false, world.time);
      if (cell.secret) drawMouth(ctx, x, y, true, world.time);
      if (cell.flag) drawBrazier(ctx, x, y, world.flags.has(`${tx},${ty}`));
    }
  }

  for (const brick of world.bricks) {
    const hot = brick.locked ? 1 : Math.max(0, brick.ttl / 6);
    drawBrick(ctx, brick.tx * TILE - cam, brick.ty * TILE, hot, brick.locked);
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
    if (!enemy.alive) continue;
    drawCrab(ctx, enemy.x - cam, enemy.y, frame);
  }

  const blink = world.player.invuln > 0 && Math.floor(world.time * 14) % 2 === 0;
  if (world.status !== "dead" && !blink) {
    const squash = world.player.grounded && world.player.vy === 0 ? 0 : -1;
    drawKeeper(
      ctx,
      world.player.x - cam,
      world.player.y + (reduced ? 0 : squash),
      world.player.grounded && Math.abs(world.player.vx) > 20 ? frame : 0,
      world.player.facing,
      world.player.holding,
    );
  }

  for (const particle of world.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.max);
    ctx.fillStyle = particle.color;
    ctx.fillRect(Math.round(particle.x - cam), Math.round(particle.y), 2, 2);
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
  const coinCount = String(world.collected.size);
  drawCoin(ctx, VIEW_W - 22 - coinCount.length * 6, 2, world.time, 1);
  drawText(ctx, coinCount, VIEW_W - 8 - coinCount.length * 6, 8, glaze, 1);

  if (world.time < 2) {
    drawTextCentered(ctx, world.level.name, VIEW_W / 2, 8, smoke, 1);
  } else if (world.hintLeft > 0) {
    drawTextCentered(ctx, world.level.hint, VIEW_W / 2, 8, smoke, 1);
  }
}

function drawGroundLine(ctx: CanvasRenderingContext2D, y: number): void {
  for (let x = 16; x < VIEW_W - 16; x += TILE) drawClay(ctx, x, y, x, 1, clay);
}

function drawTitle(ctx: CanvasRenderingContext2D, time: number, reduced: boolean): void {
  drawSky(ctx, 0, 0.8);
  drawGroundLine(ctx, 168);
  const socketX = 152;
  drawSocket(ctx, socketX, 168, time);
  const cycle = reduced ? 1 : (time % 2.4) / 2.4;
  const drop = cycle < 0.55 ? Math.round((1 - cycle / 0.55) * 36) : 0;
  const locked = cycle >= 0.55;
  drawBrick(ctx, socketX, 168 - drop, locked ? 0.2 : 1, locked);
  drawTextCentered(ctx, "Kiln", VIEW_W / 2, 48, glaze, 4);
  drawTextCentered(ctx, "Jump to start", VIEW_W / 2, 92, smoke, 1);
  drawTextCentered(ctx, "Arrows move   Z jumps   X sets a brick", VIEW_W / 2, 210, slagBright, 1);
}

function drawTunnel(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, hot: boolean): void {
  const steps = Math.max(2, Math.hypot(bx - ax, by - ay) / 8);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    ctx.fillStyle = hot ? clay : "#3a241c";
    ctx.fillRect(x - 3, y - 2, 6, 4);
  }
}

function drawMap(ctx: CanvasRenderingContext2D, scene: Extract<Scene, { kind: "map" }>): void {
  drawSky(ctx, 20, 0.55);
  ctx.fillStyle = "#2a1814";
  ctx.fillRect(18, 16, 18, 210);
  for (let y = 16; y < 226; y += 8) {
    ctx.fillStyle = y % 16 === 0 ? clayDark : "#3a221c";
    ctx.fillRect(18, y, 18, 7);
  }

  for (const link of LINKS) {
    if (!isVisible(link.to, scene.progress) || !isVisible(link.from, scene.progress)) continue;
    const a = NODES[link.from];
    const b = NODES[link.to];
    const hot = scene.progress.cleared.includes(link.from);
    drawTunnel(ctx, a.x, a.y, b.x, b.y, hot);
  }

  for (const id of Object.keys(NODES) as NodeId[]) {
    if (!isVisible(id, scene.progress)) continue;
    const node = NODES[id];
    const unlocked = scene.progress.unlocked.includes(id);
    const cleared = scene.progress.cleared.includes(id);
    ctx.fillStyle = unlocked ? clayDark : "#2a201c";
    ctx.fillRect(node.x - 16, node.y - 18, 32, 26);
    ctx.fillStyle = cleared ? coal : unlocked ? "#6a3028" : "#1a100e";
    ctx.fillRect(node.x - 12, node.y - 12, 24, 16);
    if (id === "cinder") {
      ctx.fillStyle = slag;
      ctx.fillRect(node.x - 12, node.y - 14, 24, 2);
    }
    drawTextCentered(ctx, node.name, node.x, node.y + 14, unlocked ? smoke : "#6a5a50", 1);
    if (cleared) {
      ctx.fillStyle = glaze;
      ctx.fillRect(node.x - 2, node.y - 8, 4, 4);
    }
  }

  drawKeeper(ctx, scene.pos.x - 5, scene.pos.y - 22, Math.floor(scene.time * 4) % 2, 1, false);
  drawText(ctx, "The flue", 44, 12, glaze, 2);
  const coinCount = String(scene.coins);
  drawCoin(ctx, VIEW_W - 22 - coinCount.length * 6, 10, scene.time, 2);
  drawText(ctx, coinCount, VIEW_W - 8 - coinCount.length * 6, 16, glaze, 1);
  drawTextCentered(ctx, "Arrows move    jump enters", VIEW_W / 2, 222, slagBright, 1);
  if (scene.mute) drawText(ctx, "Muted", 44, 30, smoke, 1);
}

function drawWon(ctx: CanvasRenderingContext2D, time: number): void {
  drawSky(ctx, 0, 1);
  drawGroundLine(ctx, 176);
  drawBrick(ctx, 152, 160, 0.4, true);
  drawMouth(ctx, 152, 144, false, time);
  drawTextCentered(ctx, "The kiln stays lit", VIEW_W / 2, 64, glaze, 2);
  drawTextCentered(ctx, "Jump returns to the flue", VIEW_W / 2, 210, smoke, 1);
}

export function draw(ctx: CanvasRenderingContext2D, scene: Scene): void {
  ctx.fillStyle = soot;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (scene.kind === "title") drawTitle(ctx, scene.time, scene.reduced);
  if (scene.kind === "map") drawMap(ctx, scene);
  if (scene.kind === "won") drawWon(ctx, scene.time);
  if (scene.kind === "play") {
    const shake = scene.reduced ? 0 : Math.round(scene.world.shake);
    ctx.save();
    if (shake > 0) ctx.translate((hash(shake, scene.world.time * 10 | 0) % 3) - 1, 0);
    drawWorld(ctx, scene.world, scene.reduced);
    ctx.restore();
    if (scene.banner) {
      ctx.fillStyle = "rgba(20,17,14,0.55)";
      ctx.fillRect(0, 96, VIEW_W, 36);
      drawTextCentered(ctx, scene.banner, VIEW_W / 2, 108, glaze, 2);
    }
    if (scene.paused) {
      ctx.fillStyle = "rgba(20,17,14,0.72)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      drawTextCentered(ctx, "Paused", VIEW_W / 2, 96, glaze, 3);
      drawTextCentered(ctx, "Jump continues", VIEW_W / 2, 128, smoke, 1);
      drawTextCentered(ctx, "X leaves the chamber", VIEW_W / 2, 142, smoke, 1);
    }
  }
}
