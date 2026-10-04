/* Shared mutable run state. Every system imports this instead of each other,
   which keeps the module graph a star and not a knot. */

export const W = {
  /* timing */
  t: 0, dt: 0, frame: 0, hitstop: 0, slowmo: 0,

  /* flow */
  state: "menu",           // menu | playing | draft | pause | over
  floor: 1,
  roomIdx: 0,
  roomsPerFloor: 8,
  runTime: 0,
  kills: 0,
  cores: 0,
  combo: 1,
  comboT: 0,

  /* entities */
  player: null,
  enemies: [],
  bullets: [],   // player owned
  ebullets: [],  // enemy owned
  pickups: [],
  hazards: [],   // beams, zones, telegraphs

  /* space */
  room: null,
  cam: { x: 0, y: 0, tx: 0, ty: 0, zoom: 1, tzoom: 1, sx: 0, sy: 0, shake: 0 },
  view: { w: 1280, h: 720 },

  rng: null,
  meta: null,
  boss: null,
  gateOpen: false,
  cleared: false,
};

export function resetRun() {
  W.t = 0; W.hitstop = 0; W.slowmo = 0;
  W.floor = 1; W.roomIdx = 0; W.runTime = 0;
  W.kills = 0; W.cores = 0; W.combo = 1; W.comboT = 0;
  W.enemies.length = 0; W.bullets.length = 0; W.ebullets.length = 0;
  W.pickups.length = 0; W.hazards.length = 0;
  W.boss = null; W.gateOpen = false; W.cleared = false;
}

/* tiny shared helpers used everywhere */
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const TAU = Math.PI * 2;
export function approach(v, target, rate) {
  return v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
}
export function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
