import { PLAYER_W } from "./constants";
import type { GameEvent, World } from "./sim";

// Presentation-only effects. Nothing here feeds back into the simulation.

export type Popup = { text: string; x: number; y: number; life: number; color: string };
export type Ghost = { x: number; y: number; facing: number; holding: boolean; life: number };

export type Fx = {
  flash: number;
  flashColor: string;
  freeze: number;
  popups: Popup[];
  trail: Ghost[];
  iris: number;
  irisX: number;
  irisY: number;
  chain: number;
  coinChain: number;
  coinTimer: number;
  trailTick: number;
};

export function createFx(): Fx {
  return {
    flash: 0,
    flashColor: "#ffd27a",
    freeze: 0,
    popups: [],
    trail: [],
    iris: 1,
    irisX: 160,
    irisY: 120,
    chain: 0,
    coinChain: 0,
    coinTimer: 0,
    trailTick: 0,
  };
}

export function openIris(fx: Fx, x: number, y: number, reduced: boolean): void {
  fx.iris = reduced ? 1 : 0;
  fx.irisX = x;
  fx.irisY = y;
}

function pop(fx: Fx, text: string, x: number, y: number, color: string): void {
  fx.popups.push({ text, x, y, life: 0.7, color });
}

// Returns the pitch offset (in semitones) the matching sound should play at.
export function absorb(fx: Fx, world: World, event: GameEvent, reduced: boolean): number {
  const player = world.player;
  const px = player.x + PLAYER_W / 2;
  const flash = (amount: number, color: string) => {
    fx.flash = Math.max(fx.flash, reduced ? amount * 0.4 : amount);
    fx.flashColor = color;
  };
  switch (event.t) {
    case "coin": {
      fx.coinChain = fx.coinTimer > 0 ? Math.min(fx.coinChain + 1, 12) : 0;
      fx.coinTimer = 0.7;
      pop(fx, "+1", px - 6, player.y - 6, "#ffd27a");
      return fx.coinChain;
    }
    case "stomp": {
      fx.chain += 1;
      fx.freeze = Math.max(fx.freeze, 0.07);
      if (fx.chain > 1) pop(fx, `X${fx.chain}`, px - 6, player.y - 8, "#b7d1c0");
      return (fx.chain - 1) * 2;
    }
    case "lock":
      fx.freeze = Math.max(fx.freeze, 0.05);
      flash(0.18, "#b7d1c0");
      return 0;
    case "die":
      fx.freeze = Math.max(fx.freeze, 0.14);
      flash(0.45, "#ffb15a");
      fx.chain = 0;
      return 0;
    case "open":
      flash(0.22, "#b7d1c0");
      return 0;
    case "exit":
    case "secret":
      flash(0.5, event.t === "secret" ? "#b7d1c0" : "#ffd27a");
      return 0;
    case "flag":
      pop(fx, "LIT", px - 9, player.y - 8, "#ffb15a");
      return 0;
    default:
      return 0;
  }
}

export function tickFx(fx: Fx, world: World | null, dt: number, reduced: boolean): void {
  fx.flash = Math.max(0, fx.flash - dt * 2.4);
  fx.iris = Math.min(1, fx.iris + dt / 0.55);
  fx.coinTimer = Math.max(0, fx.coinTimer - dt);
  for (const popup of fx.popups) {
    popup.life -= dt;
    popup.y -= dt * 22;
  }
  fx.popups = fx.popups.filter((popup) => popup.life > 0);
  for (const ghost of fx.trail) ghost.life -= dt;
  fx.trail = fx.trail.filter((ghost) => ghost.life > 0);
  if (!world) return;
  const player = world.player;
  if (player.grounded) fx.chain = 0;
  fx.trailTick -= dt;
  const fast = Math.abs(player.vy) > 330 || (Math.abs(player.vx) >= 99 && !player.grounded);
  if (!reduced && fast && world.status === "play" && fx.trailTick <= 0) {
    fx.trailTick = 0.035;
    fx.trail.push({ x: player.x, y: player.y, facing: player.facing, holding: player.holding, life: 0.22 });
  }
}
