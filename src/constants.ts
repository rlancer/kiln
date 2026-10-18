export const TILE = 16;
export const VIEW_W = 320;
export const VIEW_H = 240;
export const PLAYER_W = 10;
export const PLAYER_H = 14;
export const ENEMY_W = 14;
export const ENEMY_H = 10;
export const STEP = 1 / 60;

// A running jump lands between a 3-tile gap (48px) and a 4-tile gap (64px).
// One brick in the lip of a 4-tile gap leaves a 3-tile jump. sim.test.ts locks this.
export const GRAVITY = 1400;
export const JUMP_VEL = -396;
export const MAX_RUN = 100;
export const RUN_ACCEL = 380;
export const AIR_ACCEL = 220;
export const FRICTION = 780;
export const MAX_FALL = 340;
export const COYOTE = 0.04;
export const JUMP_BUFFER = 0.1;
export const JUMP_CUT = 0.48;
export const BRICK_LIFE = 6;
export const STOMP_VEL = -220;
