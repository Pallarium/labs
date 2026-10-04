/* Enemy archetypes and the four bosses.
   Every enemy is created by makeEnemy(type,x,y) and exposes update(dt),
   draw(ctx) and hurt(dmg,ang,knock). Behaviour is a small state machine:
   most of them telegraph, commit, then recover — so every death is readable. */

import { W, TAU, clamp, dist, angLerp } from "./world.js";
import { FX } from "./fx.js";
import { Sound } from "./audio.js";
import { enemyShot } from "./weapons.js";
import { clampToRoom, resolvePillars, spawnPoint } from "./rooms.js";
import { hurtPlayer } from "./player.js";

/* ------------------------------------------------------------------ *
 *  archetype table
 * ------------------------------------------------------------------ */
export const TYPES = {
  husk: {
    name: "Husk", hp: 52, r: 16, speed: 118, dmg: 12, touch: true,
    col: "#5e5140", dark: "#38301f", tier: 1, cores: 1,
  },
  crawler: {
    name: "Crawler", hp: 34, r: 13, speed: 214, dmg: 9, touch: true,
    col: "#6b4434", dark: "#3d2419", tier: 1, cores: 1, erratic: true,
  },
  archer: {
    name: "Bone Archer", hp: 44, r: 15, speed: 92, dmg: 14,
    col: "#8c8672", dark: "#4d4839", tier: 2, cores: 2, ranged: true,
    prefer: 300, fireRate: 1.9,
  },
  brute: {
    name: "Brute", hp: 160, r: 25, speed: 96, dmg: 24, touch: true,
    col: "#6d3b2c", dark: "#3c1f16", tier: 3, cores: 3, charger: true,
  },
  censerman: {
    name: "Ash Priest", hp: 76, r: 18, speed: 84, dmg: 11,
    col: "#5a4a64", dark: "#2f2536", tier: 3, cores: 3, ranged: true,
    prefer: 340, fireRate: 2.4, spread: true,
  },
  spitter: {
    name: "Bile Spitter", hp: 62, r: 17, speed: 74, dmg: 13,
    col: "#4f6340", dark: "#2a3522", tier: 2, cores: 2, ranged: true,
    prefer: 260, fireRate: 2.1, lob: true,
  },
  wraith: {
    name: "Wraith", hp: 70, r: 16, speed: 168, dmg: 16, touch: true,
    col: "#4a4258", dark: "#26202f", tier: 4, cores: 3, blink: true,
  },
  shieldbearer: {
    name: "Shieldbearer", hp: 190, r: 22, speed: 78, dmg: 18, touch: true,
    col: "#4c4a40", dark: "#2a2822", tier: 4, cores: 4, shielded: true,
  },
};

const BOSSES = {
  warden: { name: "THE WARDEN", sub: "keeper of the lower stair", hp: 900, r: 44, col: "#6d3b2c", dark: "#3a1d14" },
  choir: { name: "THE DROWNED CHOIR", sub: "they sing in three voices", hp: 1050, r: 40, col: "#3c5a58", dark: "#1e2e2d" },
  gravebride: { name: "THE GRAVE BRIDE", sub: "she keeps every ring", hp: 1200, r: 42, col: "#6a4a5c", dark: "#33232c" },
  hollowking: { name: "THE HOLLOW KING", sub: "the lantern was his", hp: 1650, r: 50, col: "#5a4a2c", dark: "#2c2416" },
};

/* ------------------------------------------------------------------ *
 *  factory
 * ------------------------------------------------------------------ */
export function makeEnemy(type, x, y) {
  const d = TYPES[type];
  const scale = 1 + (W.floor - 1) * 0.28;
  const e = {
    type, def: d, x, y, vx: 0, vy: 0, r: d.r,
    hp: d.hp * scale, maxHp: d.hp * scale,
    dmg: d.dmg * (1 + (W.floor - 1) * 0.2),
    dead: false, boss: false,
    ang: 0, phase: Math.random() * TAU,
    state: "idle", stateT: 0, tell: 0,
    cd: Math.random() * 1.4, stun: 0, burn: 0, burnT: 0,
    flash: 0, knockX: 0, knockY: 0,
    shieldAng: 0, blinkT: 0, legPhase: Math.random() * TAU,
    hurt(dmg, ang, knock) { return damage(this, dmg, ang, knock); },
    update(dt) { updateBasic(this, dt); },
    draw(ctx) { drawBasic(ctx, this); },
  };
  return e;
}

/* An elite is a normal enemy wearing one curse. Same silhouette, gold crown,
   one extra rule you have to read and respect. */
export const ELITES = {
  gilded:  { name: "Gilded",  col: "#c9a24a", hp: 2.4, dmg: 1.2, cores: 4 },
  scorched:{ name: "Scorched",col: "#e0862f", hp: 1.8, dmg: 1.3, cores: 3 },
  vengeful:{ name: "Vengeful",col: "#a8402c", hp: 1.9, dmg: 1.2, cores: 3 },
  swift:   { name: "Swift",   col: "#6e8352", hp: 1.5, dmg: 1.1, cores: 3 },
};

export function makeElite(type, x, y, rng) {
  const e = makeEnemy(type, x, y);
  const key = rng.pick(Object.keys(ELITES));
  const m = ELITES[key];
  e.elite = key;
  e.eliteDef = m;
  e.maxHp *= m.hp; e.hp = e.maxHp;
  e.dmg *= m.dmg;
  e.r *= 1.22;
  e.def = { ...e.def, cores: m.cores, speed: e.def.speed * (key === "swift" ? 1.45 : 0.92) };
  e.auraT = 0;
  return e;
}

export function makeBoss(kind, x, y) {
  const d = BOSSES[kind] || BOSSES.warden;
  const scale = 1 + (W.floor - 1) * 0.3;
  const e = {
    type: "boss", kind, def: { ...d, cores: 25, col: d.col, dark: d.dark },
    // the deep floors reuse the shapes, but they come back worse and named for it
    bossName: W.floor > 5 ? d.name + " REBOUND" : d.name,
    bossSub: W.floor > 5 ? "it remembers dying to you" : d.sub,
    x, y, vx: 0, vy: 0, r: d.r,
    hp: d.hp * scale, maxHp: d.hp * scale,
    dmg: 22 * (1 + (W.floor - 1) * 0.18),
    dead: false, boss: true,
    ang: 0, phase: 0, legPhase: 0,
    state: "idle", stateT: 0, tell: 0, cd: 1.4,
    stun: 0, burn: 0, burnT: 0, flash: 0,
    rage: 0, attackIdx: 0, addTimer: 8,
    hurt(dmg, ang, knock) { return damage(this, dmg, ang, knock * 0.12); },
    update(dt) { updateBoss(this, dt); },
    draw(ctx) { drawBoss(ctx, this); },
  };
  return e;
}

/* ------------------------------------------------------------------ *
 *  damage + death
 * ------------------------------------------------------------------ */
function damage(e, dmg, ang, knock) {
  if (e.dead) return false;
  const p = W.player;

  // shieldbearers block from the front
  if (e.def.shielded && ang != null) {
    let d = ((ang - e.shieldAng + Math.PI) % TAU) - Math.PI;
    if (d < -Math.PI) d += TAU;
    if (Math.abs(d) > Math.PI - 0.95) {
      dmg *= 0.15;
      FX.spark(e.x + Math.cos(ang + Math.PI) * e.r, e.y + Math.sin(ang + Math.PI) * e.r, 7,
        { col: "#cdc6b0", speed: 200, life: 0.25, dir: ang + Math.PI, spread: 1.6 });
      Sound.play("block");
      FX.text(e.x, e.y - e.r - 8, "BLOCK", "#9aa39a");
    }
  }

  let crit = false;
  if (p && Math.random() < p.stats.crit) { crit = true; dmg *= p.stats.critMult; }

  e.hp -= dmg;
  e.flash = 1;
  if (knock) {
    e.vx += Math.cos(ang) * knock;
    e.vy += Math.sin(ang) * knock;
  }

  FX.blood(e.x, e.y, ang ?? Math.random() * TAU, crit ? 14 : 7, e.def.dark);
  FX.text(e.x + (Math.random() - 0.5) * 12, e.y - e.r - 6,
    (crit ? "" : "") + Math.round(dmg), crit ? "#e0862f" : "#d8ccae", crit);
  if (crit) { FX.shake(4); FX.hitstop(0.03); }
  Sound.play(crit ? "flesh" : "hit");

  if (p && p.stats.lifesteal) {
    p.hp = Math.min(p.maxHp, p.hp + dmg * p.stats.lifesteal);
  }
  if (p && p.stats.burnDmg) e.burn = Math.max(e.burn, 1.6);

  if (e.hp <= 0) killEnemy(e, ang);
  return true;
}

export function killEnemy(e, ang) {
  if (e.dead) return;
  e.dead = true;
  const p = W.player;

  W.kills++;
  W.combo = Math.min(99, W.combo + 1);
  W.comboT = 3.2;

  FX.gib(e.x, e.y, e.boss ? 40 : 10, e.def.dark);
  FX.blood(e.x, e.y, ang ?? Math.random() * TAU, e.boss ? 40 : 16, e.def.dark);
  FX.stain(e.x, e.y, e.r * 2.2, "rgba(80,22,16,1)", 0.5);
  FX.smoke(e.x, e.y, e.boss ? 20 : 5);
  FX.shake(e.boss ? 24 : 5);
  Sound.play(e.boss ? "bossDie" : "kill");
  if (e.boss) { FX.hitstop(0.35); FX.ring(e.x, e.y, 10, 400, "rgba(224,134,47,.7)", 1.1, 8); }

  const n = e.def.cores || 1;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = 60 + Math.random() * 140;
    W.pickups.push({
      kind: "core", x: e.x, y: e.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: 6, age: 0, life: 22, phase: Math.random() * TAU,
    });
  }
  if (Math.random() < 0.12 + (p ? p.stats.luck : 0)) {
    W.pickups.push({
      kind: "heart", x: e.x, y: e.y,
      vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80,
      r: 9, age: 0, life: 26, phase: 0,
    });
  }
  if (p && p.stats.onKillHeal) {
    p.hp = Math.min(p.maxHp, p.hp + p.stats.onKillHeal);
  }
}

/* ------------------------------------------------------------------ *
 *  shared movement helpers
 * ------------------------------------------------------------------ */
function steer(e, tx, ty, speed, dt) {
  const a = Math.atan2(ty - e.y, tx - e.x);
  e.vx += (Math.cos(a) * speed - e.vx) * Math.min(1, dt * 6);
  e.vy += (Math.sin(a) * speed - e.vy) * Math.min(1, dt * 6);
}

function commonPost(e, dt) {
  e.x += e.vx * dt; e.y += e.vy * dt;
  e.vx *= Math.exp(-2.6 * dt); e.vy *= Math.exp(-2.6 * dt);
  resolvePillars(e, e.r);
  clampToRoom(e, e.r);

  if (e.burn > 0) {
    e.burn -= dt; e.burnT += dt;
    if (e.burnT > 0.4) {
      e.burnT = 0;
      const p = W.player;
      const dot = (p && p.stats.burnDmg) ? p.stats.burnDmg : 4;
      e.hp -= dot;
      FX.ember(e.x, e.y, 3);
      if (e.hp <= 0) killEnemy(e, Math.random() * TAU);
    }
  }

  // elite curses tick here so every archetype gets them for free
  if (e.elite) {
    e.auraT += dt;
    const pl = W.player;
    if (e.elite === "scorched") {
      if (Math.random() < 0.6) FX.ember(e.x, e.y - e.r * 0.3, 1);
      if (e.auraT > 0.3) {
        e.auraT = 0;
        if (pl && !pl.dead && dist(e.x, e.y, pl.x, pl.y) < e.r + 62) {
          hurtPlayer(pl, 5, Math.atan2(pl.y - e.y, pl.x - e.x));
        }
      }
    } else if (e.elite === "vengeful" && e.auraT > 1.9) {
      e.auraT = 0;
      if (pl && !pl.dead) {
        const a = Math.atan2(pl.y - e.y, pl.x - e.x);
        for (let i = -1; i <= 1; i++) {
          enemyShot(e.x, e.y, a + i * 0.3, 260, e.dmg * 0.5, { col: "#a8402c", r: 6 });
        }
      }
    } else if (e.elite === "gilded" && e.auraT > 4) {
      e.auraT = 0;
      W.pickups.push({
        kind: "core", x: e.x, y: e.y,
        vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120,
        r: 6, age: 0, life: 20, phase: Math.random() * TAU,
      });
    }
  }

  // touch damage
  const p = W.player;
  if (e.touchCd > 0) e.touchCd -= dt;
  if (p && !p.dead && e.def.touch && !e.dead && e.touchCd <= 0) {
    if (dist(e.x, e.y, p.x, p.y) < e.r + p.r - 2) {
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      e.touchCd = 0.85;
      if (hurtPlayer(p, e.dmg, a)) {
        p.vx += Math.cos(a) * 280; p.vy += Math.sin(a) * 280;
        if (p.stats.thorns) e.hurt(p.stats.thorns, a + Math.PI, 160);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  basic AI
 * ------------------------------------------------------------------ */
function updateBasic(e, dt) {
  if (e.dead) return;
  const p = W.player;
  e.flash = Math.max(0, e.flash - dt * 4);
  e.phase += dt;
  if (e.stun > 0) { e.stun -= dt; commonPost(e, dt); return; }
  if (!p || p.dead) { commonPost(e, dt); return; }

  const d = dist(e.x, e.y, p.x, p.y);
  e.ang = angLerp(e.ang, Math.atan2(p.y - e.y, p.x - e.x), Math.min(1, dt * 7));
  const def = e.def;
  const spd = def.speed * (1 + (W.floor - 1) * 0.05);

  if (def.shielded) e.shieldAng = angLerp(e.shieldAng, Math.atan2(p.y - e.y, p.x - e.x), Math.min(1, dt * 3));

  /* --- ranged kite + shoot --- */
  if (def.ranged) {
    e.cd -= dt;
    if (e.state === "tell") {
      e.tell -= dt;
      if (e.tell <= 0) {
        e.state = "idle";
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        if (def.spread) {
          for (let i = -1; i <= 1; i++) {
            enemyShot(e.x, e.y, a + i * 0.24, 240, e.dmg, { col: "#8a6ab0", r: 7, homing: 0.6 });
          }
        } else if (def.lob) {
          enemyShot(e.x, e.y, a, 260, e.dmg, { col: "#7d9152", r: 9, wob: 1.4 });
        } else {
          enemyShot(e.x, e.y, a, 420, e.dmg, { col: "#d8ccae", r: 4 });
        }
        Sound.play("bow");
        e.cd = def.fireRate * (0.7 + Math.random() * 0.6) / (1 + (W.floor - 1) * 0.12);
      }
      e.vx *= 0.9; e.vy *= 0.9;
      commonPost(e, dt); return;
    }
    if (e.cd <= 0 && d < 560) {
      e.state = "tell"; e.tell = 0.5;
      commonPost(e, dt); return;
    }
    const want = def.prefer;
    if (d < want - 70) steer(e, p.x, p.y, -spd, dt);
    else if (d > want + 70) steer(e, p.x, p.y, spd, dt);
    else {
      const strafe = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * (Math.sin(e.phase * 0.7) > 0 ? 1 : -1);
      e.vx += (Math.cos(strafe) * spd * 0.7 - e.vx) * Math.min(1, dt * 4);
      e.vy += (Math.sin(strafe) * spd * 0.7 - e.vy) * Math.min(1, dt * 4);
    }
    commonPost(e, dt); return;
  }

  /* --- brute: telegraph then charge --- */
  if (def.charger) {
    e.cd -= dt;
    if (e.state === "charge") {
      e.stateT -= dt;
      const sp = spd * 4.2;
      e.vx = Math.cos(e.chargeAng) * sp;
      e.vy = Math.sin(e.chargeAng) * sp;
      FX.spark(e.x, e.y, 1, { col: "#6d3b2c", speed: 40, life: 0.24, glow: false, r: 3 });
      if (e.stateT <= 0) { e.state = "idle"; e.cd = 2.2; e.stun = 0.5; }
      commonPost(e, dt); return;
    }
    if (e.state === "tell") {
      e.tell -= dt;
      e.vx *= 0.82; e.vy *= 0.82;
      if (e.tell <= 0) {
        e.state = "charge"; e.stateT = 0.6;
        e.chargeAng = Math.atan2(p.y - e.y, p.x - e.x);
        FX.ring(e.x, e.y, 8, 60, "rgba(168,64,44,.7)", 0.3, 3);
        Sound.play("hammer");
      }
      commonPost(e, dt); return;
    }
    if (e.cd <= 0 && d < 400 && d > 70) { e.state = "tell"; e.tell = 0.72; }
    steer(e, p.x, p.y, spd, dt);
    commonPost(e, dt); return;
  }

  /* --- wraith: blink toward you --- */
  if (def.blink) {
    e.blinkT -= dt;
    if (e.blinkT <= 0 && d > 130) {
      e.blinkT = 2.6 + Math.random();
      FX.smoke(e.x, e.y, 8, "rgba(74,66,88,1)");
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      e.x += Math.cos(a) * Math.min(220, d - 60);
      e.y += Math.sin(a) * Math.min(220, d - 60);
      FX.smoke(e.x, e.y, 8, "rgba(74,66,88,1)");
      resolvePillars(e, e.r);
    }
    steer(e, p.x, p.y, spd, dt);
    commonPost(e, dt); return;
  }

  /* --- default chase, crawlers weave --- */
  let tx = p.x, ty = p.y;
  if (def.erratic) {
    tx += Math.cos(e.phase * 3.1) * 90;
    ty += Math.sin(e.phase * 2.7) * 90;
  }
  steer(e, tx, ty, spd, dt);
  e.legPhase += dt * (Math.hypot(e.vx, e.vy) / 40);
  commonPost(e, dt);
}

/* ------------------------------------------------------------------ *
 *  boss AI — three-attack rotation, harder past half health
 * ------------------------------------------------------------------ */
function updateBoss(e, dt) {
  if (e.dead) return;
  const p = W.player;
  e.flash = Math.max(0, e.flash - dt * 4);
  e.phase += dt;
  e.rage = e.hp / e.maxHp < 0.5 ? 1 : 0;
  if (e.stun > 0) { e.stun -= dt; commonPost(e, dt); return; }
  if (!p || p.dead) { commonPost(e, dt); return; }

  const d = dist(e.x, e.y, p.x, p.y);
  e.ang = angLerp(e.ang, Math.atan2(p.y - e.y, p.x - e.x), Math.min(1, dt * 3));

  // periodic adds keep the arena busy
  e.addTimer -= dt;
  if (e.addTimer <= 0) {
    e.addTimer = e.rage ? 7 : 11;
    const n = e.rage ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const sp = spawnPoint(W.rng, p, 300);
      const t = W.rng.pick(W.floor >= 3 ? ["crawler", "husk", "archer"] : ["crawler", "husk"]);
      const add = makeEnemy(t, sp.x, sp.y);
      add.spawnT = 0.5;
      W.enemies.push(add);
      FX.ring(sp.x, sp.y, 4, 40, "rgba(168,64,44,.7)", 0.4, 2);
      FX.smoke(sp.x, sp.y, 6);
    }
  }

  e.cd -= dt;

  if (e.state === "tell") {
    e.tell -= dt;
    e.vx *= 0.85; e.vy *= 0.85;
    if (e.tell <= 0) { e.state = "fire"; e.stateT = 0; fireBossAttack(e, p); }
    commonPost(e, dt); return;
  }

  if (e.state === "fire") {
    e.stateT += dt;
    if (e.attack === "sweep") {
      // rotating bullet fan
      const rate = e.rage ? 0.055 : 0.085;
      if (e.stateT - (e.lastShot || 0) > rate) {
        e.lastShot = e.stateT;
        const a = e.fireAng + e.stateT * (e.sweepDir * (e.rage ? 3.4 : 2.4));
        for (let i = 0; i < (e.rage ? 3 : 2); i++) {
          enemyShot(e.x, e.y, a + i * (TAU / (e.rage ? 3 : 2)), 250, e.dmg * 0.6,
            { col: e.def.col, r: 8 });
        }
      }
      if (e.stateT > 2.6) endBossAttack(e);
    } else if (e.attack === "slam") {
      if (e.stateT < 0.14 && !e.slammed) {
        e.slammed = true;
        FX.ring(e.x, e.y, 10, 300, "rgba(224,134,47,.8)", 0.5, 9);
        FX.shake(22); FX.scorch(e.x, e.y, 120);
        Sound.play("explode");
        if (d < 300) {
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          if (hurtPlayer(p, e.dmg * 1.3, a)) { p.vx += Math.cos(a) * 700; p.vy += Math.sin(a) * 700; }
        }
        for (let i = 0; i < 18; i++) {
          enemyShot(e.x, e.y, (i / 18) * TAU, 300, e.dmg * 0.5, { col: e.def.dark, r: 7 });
        }
      }
      if (e.stateT > 0.7) { e.slammed = false; endBossAttack(e); }
    } else if (e.attack === "dash") {
      const sp = 620;
      e.vx = Math.cos(e.fireAng) * sp; e.vy = Math.sin(e.fireAng) * sp;
      FX.spark(e.x, e.y, 2, { col: e.def.col, speed: 60, life: 0.3, glow: false, r: 4 });
      if (dist(e.x, e.y, p.x, p.y) < e.r + p.r + 4) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        if (hurtPlayer(p, e.dmg, a)) { p.vx += Math.cos(a) * 640; p.vy += Math.sin(a) * 640; }
      }
      if (e.stateT > 0.75) { e.stun = 0.6; endBossAttack(e); }
    } else if (e.attack === "summonwall") {
      if (e.stateT - (e.lastShot || 0) > 0.3) {
        e.lastShot = e.stateT;
        const base = W.rng.angle();
        for (let i = 0; i < 10; i++) {
          enemyShot(e.x, e.y, base + (i / 10) * TAU, 180, e.dmg * 0.5,
            { col: e.def.col, r: 9, accel: 150, life: 4 });
        }
      }
      if (e.stateT > 1.6) endBossAttack(e);
    }
    commonPost(e, dt); return;
  }

  // reposition between attacks
  const want = 230;
  if (d > want + 90) steer(e, p.x, p.y, 150, dt);
  else if (d < want - 90) steer(e, p.x, p.y, -110, dt);
  else {
    const s = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2;
    e.vx += (Math.cos(s) * 90 - e.vx) * Math.min(1, dt * 3);
    e.vy += (Math.sin(s) * 90 - e.vy) * Math.min(1, dt * 3);
  }

  if (e.cd <= 0) {
    const pool = e.rage
      ? ["sweep", "slam", "dash", "summonwall"]
      : ["sweep", "slam", "dash"];
    e.attack = pool[e.attackIdx++ % pool.length];
    e.state = "tell";
    e.tell = e.attack === "slam" ? 0.85 : 0.62;
    e.sweepDir = W.rng.sign();
    e.fireAng = Math.atan2(p.y - e.y, p.x - e.x);
    e.lastShot = 0;
    Sound.play("bossIn");
  }
  commonPost(e, dt);
}

function fireBossAttack(e, p) {
  e.stateT = 0; e.lastShot = 0;
  if (e.attack === "dash" || e.attack === "sweep") {
    e.fireAng = Math.atan2(p.y - e.y, p.x - e.x);
  }
}
function endBossAttack(e) {
  e.state = "idle";
  e.cd = e.rage ? 1.1 : 1.8;
}

/* ------------------------------------------------------------------ *
 *  drawing
 * ------------------------------------------------------------------ */
function bodyShade(e) {
  return e.flash > 0.02 ? "#f0e6d0" : e.def.col;
}

function drawBasic(ctx, e) {
  const def = e.def;
  const wob = Math.sin(e.legPhase) * 2;
  ctx.save();
  ctx.translate(e.x, e.y);

  // shadow
  ctx.globalAlpha = 0.4; ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(0, e.r * 0.82, e.r * 0.92, e.r * 0.34, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  if (e.spawnT > 0) {
    ctx.globalAlpha = 1 - e.spawnT / 0.5;
  }

  const col = bodyShade(e);

  if (e.type === "crawler") {
    // low scuttling thing with legs
    ctx.strokeStyle = def.dark; ctx.lineWidth = 2.6; ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.sin(e.legPhase + i) * 0.3;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (e.r + 7), Math.sin(a) * (e.r + 5));
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.78, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#e0862f";
    ctx.beginPath(); ctx.arc(Math.cos(e.ang) * 5, Math.sin(e.ang) * 5, 2.2, 0, TAU); ctx.fill();
  } else if (e.type === "wraith") {
    ctx.globalAlpha *= 0.82;
    const s = 1 + Math.sin(e.phase * 2.4) * 0.06;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 1.2 * s);
    ctx.quadraticCurveTo(-e.r, 0, -e.r * 0.7, e.r * 0.9 + wob);
    ctx.quadraticCurveTo(0, e.r * 0.5, e.r * 0.7, e.r * 0.9 - wob);
    ctx.quadraticCurveTo(e.r, 0, 0, -e.r * 1.2 * s);
    ctx.fill();
    ctx.fillStyle = "#cfc0e0";
    ctx.beginPath(); ctx.arc(-4, -e.r * 0.45, 2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -e.r * 0.45, 2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // upright humanoid: legs, torso, head
    ctx.strokeStyle = def.dark; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-4, e.r * 0.4); ctx.lineTo(-5 + wob, e.r * 0.95);
    ctx.moveTo(4, e.r * 0.4); ctx.lineTo(5 - wob, e.r * 0.95);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 0.9);
    ctx.quadraticCurveTo(-e.r * 0.85, -e.r * 0.2, -e.r * 0.66, e.r * 0.5);
    ctx.lineTo(e.r * 0.66, e.r * 0.5);
    ctx.quadraticCurveTo(e.r * 0.85, -e.r * 0.2, 0, -e.r * 0.9);
    ctx.fill();

    ctx.fillStyle = def.dark;
    ctx.beginPath(); ctx.arc(0, -e.r * 1.05, e.r * 0.42, 0, TAU); ctx.fill();
    ctx.fillStyle = "#e0862f";
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(-2.4, -e.r * 1.05, 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(2.4, -e.r * 1.05, 1.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    if (e.type === "archer") {
      ctx.strokeStyle = "#6b5334"; ctx.lineWidth = 2;
      ctx.save(); ctx.rotate(e.ang);
      ctx.beginPath(); ctx.arc(e.r * 0.7, 0, 10, -1.2, 1.2); ctx.stroke();
      ctx.restore();
    }
    if (def.shielded) {
      ctx.save(); ctx.rotate(e.shieldAng);
      ctx.fillStyle = "#3f3d34";
      ctx.beginPath();
      ctx.moveTo(e.r * 0.85, -e.r * 0.95);
      ctx.lineTo(e.r * 1.25, 0);
      ctx.lineTo(e.r * 0.85, e.r * 0.95);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#c9a24a"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
    if (e.type === "brute") {
      ctx.fillStyle = def.dark;
      ctx.beginPath(); ctx.arc(-e.r * 0.8, -e.r * 0.1, e.r * 0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(e.r * 0.8, -e.r * 0.1, e.r * 0.4, 0, TAU); ctx.fill();
    }
  }
  // elite crown + name, drawn in local space before the restore
  if (e.elite) {
    const ec = e.eliteDef.col;
    ctx.save();
    ctx.rotate(e.phase * 0.6);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const rr = e.r * 1.35 + Math.sin(e.phase * 4 + i) * 2;
      ctx.fillStyle = ec; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = ec; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, e.r + 5, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  if (e.elite) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.textAlign = "center";
    ctx.font = '600 9px "SF Mono",monospace';
    ctx.fillStyle = e.eliteDef.col;
    ctx.fillText(e.eliteDef.name.toUpperCase(), e.x, e.y - e.r - 22);
    ctx.restore();
    if (e.elite === "scorched") {
      ctx.save();
      ctx.globalAlpha = 0.1 + Math.sin(W.t * 6) * 0.04;
      ctx.fillStyle = "#e0862f";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 62, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  // burning
  if (e.burn > 0 && Math.random() < 0.5) FX.ember(e.x, e.y - e.r * 0.4, 1);

  // telegraph ring
  if (e.state === "tell") {
    const k = 1 - e.tell / (e.def.charger ? 0.72 : 0.5);
    ctx.save();
    ctx.globalAlpha = 0.35 + k * 0.4;
    ctx.strokeStyle = "#a8402c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 8 + k * 9, 0, TAU); ctx.stroke();
    if (e.def.charger) {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#a8402c"; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(e.x, e.y);
      const a = Math.atan2(W.player.y - e.y, W.player.x - e.x);
      ctx.lineTo(e.x + Math.cos(a) * 320, e.y + Math.sin(a) * 320);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHpBar(ctx, e);
}

function drawHpBar(ctx, e) {
  if (e.hp >= e.maxHp || e.dead) return;
  const w = e.r * 2.2, h = 3.4;
  const x = e.x - w / 2, y = e.y - e.r - 15;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = "#a8402c";
  ctx.fillRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), h);
  ctx.restore();
}

function drawBoss(ctx, e) {
  const def = e.def;
  ctx.save();
  ctx.translate(e.x, e.y);

  ctx.globalAlpha = 0.5; ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(0, e.r * 0.85, e.r * 1.1, e.r * 0.4, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  const breathe = 1 + Math.sin(e.phase * 1.6) * 0.035;
  ctx.scale(breathe, breathe);

  const col = e.flash > 0.02 ? "#f0e6d0" : def.col;

  // ragged cloak body
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -e.r * 1.05);
  const pts = 10;
  for (let i = 0; i <= pts; i++) {
    const a = -Math.PI / 2 + (i / pts) * TAU;
    const rag = 1 + Math.sin(i * 2.7 + e.phase * 1.2) * 0.08;
    ctx.lineTo(Math.cos(a) * e.r * rag, Math.sin(a) * e.r * rag * 1.08);
  }
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = "rgba(201,162,74,.28)"; ctx.lineWidth = 2; ctx.stroke();

  // inner dark
  ctx.fillStyle = def.dark;
  ctx.beginPath(); ctx.ellipse(0, e.r * 0.05, e.r * 0.6, e.r * 0.7, 0, 0, TAU); ctx.fill();

  // crown of embers
  ctx.save(); ctx.rotate(e.phase * 0.4);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const rr = e.r * 1.28 + Math.sin(e.phase * 3 + i) * 3;
    ctx.fillStyle = e.rage ? "#e0862f" : "#c9a24a";
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 3.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // eyes track you
  const ex = Math.cos(e.ang) * e.r * 0.3, ey = Math.sin(e.ang) * e.r * 0.3;
  ctx.fillStyle = e.rage ? "#ff7a3a" : "#e0862f";
  ctx.beginPath(); ctx.arc(ex - 7, ey - e.r * 0.25, 3.6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(ex + 7, ey - e.r * 0.25, 3.6, 0, TAU); ctx.fill();

  ctx.restore();

  if (e.state === "tell") {
    const k = 1 - e.tell / 0.85;
    ctx.save();
    ctx.globalAlpha = 0.3 + k * 0.45;
    ctx.strokeStyle = e.attack === "slam" ? "#e0862f" : "#a8402c";
    ctx.lineWidth = 3;
    if (e.attack === "slam") {
      ctx.beginPath(); ctx.arc(e.x, e.y, 300 * k, 0, TAU); ctx.stroke();
    } else if (e.attack === "dash") {
      ctx.lineWidth = 12; ctx.globalAlpha = 0.2;
      ctx.beginPath(); ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.fireAng) * 460, e.y + Math.sin(e.fireAng) * 460);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 12 + k * 14, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ *
 *  wave composition
 * ------------------------------------------------------------------ */
export function rollWave(rng, floor, roomIdx) {
  // floor one opens gently so the first chambers teach instead of execute
  const ramp = floor === 1 ? 1.2 : 2.2;
  const budget = (floor === 1 ? 1.5 : 3) + floor * ramp + roomIdx * (floor === 1 ? 0.9 : 1.5);
  const pool = [];
  for (const k in TYPES) {
    const t = TYPES[k];
    const unlockFloor = Math.max(1, t.tier - 1);
    if (floor >= unlockFloor) pool.push({ k, w: 6 / t.tier + (floor >= t.tier ? 2 : 0) });
  }
  const out = [];
  let spent = 0;
  let guard = 0;
  // deep floors get NASTIER, not just more numerous — a hard body cap keeps the
  // late game readable instead of a screen-filling swarm
  const maxBodies = Math.min(16, 7 + floor);
  while (spent < budget && out.length < maxBodies && guard++ < 60) {
    const pick = rng.weighted(pool);
    const cost = TYPES[pick.k].tier;
    if (spent + cost > budget + 1.5) break;
    out.push(pick.k);
    spent += cost;
  }
  if (!out.length) out.push("husk", "crawler");
  return out;
}
