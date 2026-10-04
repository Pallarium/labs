/* Chamber generation. Every room is a stone box with pillars, rubble, braziers
   and (deeper down) hazards. The floor texture is baked once into an offscreen
   canvas so the per-frame cost is a single drawImage. */

import { W, TAU } from "./world.js";
import { FX } from "./fx.js";

export const FLOORS = [
  { name: "THE UNDERCROFT",  tint: "#2a2118", accent: "#4a3826", boss: "warden" },
  { name: "FLOODED CISTERN", tint: "#1d2726", accent: "#2f4340", boss: "choir" },
  { name: "THE OSSUARY",     tint: "#2b2722", accent: "#4b4438", boss: "gravebride" },
  { name: "FORGE OF ASH",    tint: "#2e1d16", accent: "#5a2c1c", boss: "warden" },
  { name: "THE HOLLOW",      tint: "#1a1622", accent: "#332a44", boss: "hollowking" },
  { name: "SALT GALLERIES",  tint: "#232a2e", accent: "#3d4a52", boss: "choir" },
  { name: "THE LONG VIGIL",  tint: "#26201c", accent: "#463a2c", boss: "gravebride" },
  { name: "EMBER'S THROAT",  tint: "#33170f", accent: "#6b2a14", boss: "hollowking" },
];

export function floorDef(n) { return FLOORS[Math.min(n - 1, FLOORS.length - 1)]; }

export function makeRoom(rng, kind) {
  const big = kind === "boss";
  const w = big ? 1500 : rng.int(1020, 1340);
  const h = big ? 1000 : rng.int(720, 960);
  const room = {
    w, h, kind,
    pillars: [],
    rubble: [],
    braziers: [],
    pits: [],
    tex: null,
    doorSide: "right",
  };

  // pillars — solid, block movement and shots
  const pn = big ? rng.int(4, 6) : rng.int(3, 7);
  const margin = 150;
  for (let i = 0; i < pn; i++) {
    let tries = 0, ok = false, px = 0, py = 0, pr = rng.range(26, 40);
    while (tries++ < 40 && !ok) {
      px = rng.range(margin, w - margin);
      py = rng.range(margin, h - margin);
      ok = true;
      if (Math.hypot(px - w * 0.5, py - h * 0.5) < 180) ok = false;     // keep the middle clear
      for (const p of room.pillars) if (Math.hypot(px - p.x, py - p.y) < p.r + pr + 120) ok = false;
    }
    if (ok) room.pillars.push({ x: px, y: py, r: pr, seed: rng.next() });
  }

  // braziers give the only light besides the lantern
  const bn = rng.int(2, 4);
  for (let i = 0; i < bn; i++) {
    room.braziers.push({
      x: rng.range(110, w - 110), y: rng.range(110, h - 110),
      r: 13, flick: rng.next() * 10,
    });
  }

  // decorative rubble
  for (let i = 0; i < 40; i++) {
    room.rubble.push({
      x: rng.range(40, w - 40), y: rng.range(40, h - 40),
      r: rng.range(2, 7), a: rng.angle(), s: rng.range(0.4, 1),
    });
  }

  // pits appear from floor 2 — instant damage + knockback, not instant death
  if (W.floor >= 2 && !big && rng.chance(0.55)) {
    const cnt = rng.int(1, 2);
    for (let i = 0; i < cnt; i++) {
      room.pits.push({
        x: rng.range(220, w - 220), y: rng.range(200, h - 200),
        rx: rng.range(70, 130), ry: rng.range(50, 90),
      });
    }
  }

  room.tex = bakeFloor(room, rng);
  FX.initDecals(w, h);
  return room;
}

/* ------------------------------------------------------------------ *
 *  floor baking
 * ------------------------------------------------------------------ */
function bakeFloor(room, rng) {
  const f = floorDef(W.floor);
  const c = document.createElement("canvas");
  c.width = room.w; c.height = room.h;
  const g = c.getContext("2d");

  g.fillStyle = f.tint;
  g.fillRect(0, 0, room.w, room.h);

  // flagstones
  const TS = 84;
  for (let y = 0; y < room.h; y += TS) {
    for (let x = 0; x < room.w; x += TS) {
      const j = rng.range(-2, 2);
      const v = rng.range(-0.05, 0.06);
      g.fillStyle = shade(f.tint, v);
      g.fillRect(x + 1 + j * 0.3, y + 1 + j * 0.3, TS - 3, TS - 3);
      // mortar shadow
      g.strokeStyle = "rgba(0,0,0,.34)";
      g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 1.5, TS - 4, TS - 4);
      // cracks
      if (rng.chance(0.16)) {
        g.strokeStyle = "rgba(0,0,0,.4)";
        g.beginPath();
        let cx = x + rng.range(6, TS - 6), cy = y + rng.range(6, TS - 6);
        g.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) {
          cx += rng.range(-18, 18); cy += rng.range(-18, 18);
          g.lineTo(cx, cy);
        }
        g.stroke();
      }
    }
  }

  // grime blotches
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, room.w), y = rng.range(0, room.h), r = rng.range(20, 90);
    const rad = g.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, "rgba(0,0,0,.16)");
    rad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rad;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  // pits cut through
  for (const p of room.pits) {
    const rad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(p.rx, p.ry));
    rad.addColorStop(0, "#000");
    rad.addColorStop(0.72, "#050403");
    rad.addColorStop(1, "rgba(5,4,3,0)");
    g.save(); g.translate(p.x, p.y); g.scale(1, p.ry / p.rx);
    g.fillStyle = rad;
    g.beginPath(); g.arc(0, 0, p.rx, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 3;
    g.save(); g.translate(p.x, p.y); g.scale(1, p.ry / p.rx);
    g.beginPath(); g.arc(0, 0, p.rx * 0.82, 0, TAU); g.stroke();
    g.restore();
  }

  // wall inner shadow
  const vg = g.createLinearGradient(0, 0, 0, room.h);
  vg.addColorStop(0, "rgba(0,0,0,.5)"); vg.addColorStop(0.12, "rgba(0,0,0,0)");
  vg.addColorStop(0.88, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.5)");
  g.fillStyle = vg; g.fillRect(0, 0, room.w, room.h);
  const hg = g.createLinearGradient(0, 0, room.w, 0);
  hg.addColorStop(0, "rgba(0,0,0,.5)"); hg.addColorStop(0.1, "rgba(0,0,0,0)");
  hg.addColorStop(0.9, "rgba(0,0,0,0)"); hg.addColorStop(1, "rgba(0,0,0,.5)");
  g.fillStyle = hg; g.fillRect(0, 0, room.w, room.h);

  return c;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * (1 + amt))));
  gg = Math.max(0, Math.min(255, Math.round(gg * (1 + amt))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + amt))));
  return "#" + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1);
}

/* ------------------------------------------------------------------ *
 *  collision helpers used by everything that moves
 * ------------------------------------------------------------------ */
export function clampToRoom(e, pad) {
  const r = W.room; if (!r) return;
  const p = pad ?? e.r ?? 12;
  if (e.x < p) { e.x = p; if (e.vx < 0) e.vx *= -0.3; }
  if (e.x > r.w - p) { e.x = r.w - p; if (e.vx > 0) e.vx *= -0.3; }
  if (e.y < p) { e.y = p; if (e.vy < 0) e.vy *= -0.3; }
  if (e.y > r.h - p) { e.y = r.h - p; if (e.vy > 0) e.vy *= -0.3; }
}

/** push a circle out of any pillar it overlaps */
export function resolvePillars(e, radius) {
  const r = W.room; if (!r) return false;
  let hit = false;
  for (const p of r.pillars) {
    const dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.hypot(dx, dy), min = p.r + radius;
    if (d < min && d > 0.0001) {
      const nx = dx / d, ny = dy / d;
      e.x = p.x + nx * min; e.y = p.y + ny * min;
      hit = true;
    }
  }
  return hit;
}

/** does a point sit inside a pillar? (used by projectiles) */
export function pointInPillar(x, y, pad) {
  const r = W.room; if (!r) return false;
  for (const p of r.pillars) {
    if (Math.hypot(x - p.x, y - p.y) < p.r + (pad || 0)) return true;
  }
  return false;
}

export function inPit(x, y) {
  const r = W.room; if (!r) return null;
  for (const p of r.pits) {
    const dx = (x - p.x) / p.rx, dy = (y - p.y) / p.ry;
    if (dx * dx + dy * dy < 0.62) return p;
  }
  return null;
}

/** free spot to drop an enemy: away from the player and out of geometry */
export function spawnPoint(rng, awayFrom, minDist) {
  const r = W.room;
  for (let i = 0; i < 80; i++) {
    const x = rng.range(90, r.w - 90), y = rng.range(90, r.h - 90);
    if (awayFrom && Math.hypot(x - awayFrom.x, y - awayFrom.y) < (minDist || 260)) continue;
    if (pointInPillar(x, y, 40)) continue;
    if (inPit(x, y)) continue;
    return { x, y };
  }
  return { x: r.w * 0.5, y: r.h * 0.25 };
}

/** the gate the player walks into to continue */
export function gatePos() {
  const r = W.room;
  return { x: r.w - 42, y: r.h * 0.5 };
}
