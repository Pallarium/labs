/* The delver. Movement, roll with i-frames, weapon handling, lantern flare,
   and the stat block every relic edits. */

import { W, clamp, TAU, dist } from "./world.js";
import { Input } from "./input.js";
import { FX } from "./fx.js";
import { Sound } from "./audio.js";
import { WEAPONS } from "./weapons.js";
import { clampToRoom, resolvePillars, inPit } from "./rooms.js";
import { Shader } from "./shader.js";

export function makePlayer() {
  return {
    x: 200, y: 400, vx: 0, vy: 0, r: 15,
    ang: 0, facing: 1,
    hp: 100, maxHp: 100,
    shield: 0, maxShield: 0, shieldT: 0,
    dead: false,

    weapon: "sword",
    cool: 0,
    swingT: 0,          // visual swing timer
    swingDir: 1,

    dashes: 1, dashMax: 1, dashCd: 0, dashT: 0, dashAng: 0,
    iframes: 0,
    flareCd: 0,

    walkPhase: 0,
    hurtFlash: 0,
    lanternPhase: 0,

    relics: {},          // id -> stacks
    stats: baseStats(),
  };
}

export function baseStats() {
  return {
    speed: 250,
    dmg: 1,
    rate: 1,             // multiplier on fire cooldown (lower = faster)
    reach: 1,
    multishot: 1,
    pierce: 0,
    lifesteal: 0,
    crit: 0.04,
    critMult: 2,
    thorns: 0,
    dashIframes: 0.26,
    dashDist: 1,
    regen: 0,
    burnDmg: 0,
    luck: 0,
    coreMagnet: 1,
    onKillHeal: 0,
    flarePower: 1,
    moveWhileAttack: 0.5,
  };
}

export function recomputeStats(p) {
  p.stats = baseStats();
  for (const id in p.relics) {
    const def = RELIC_EFFECTS[id];
    if (def) for (let i = 0; i < p.relics[id]; i++) def(p.stats, p);
  }
  p.maxShield = p.stats.maxShieldBonus || 0;
  if (p.shield > p.maxShield) p.shield = p.maxShield;
  p.dashMax = 1 + (p.stats.extraDash || 0);
  if (p.dashes > p.dashMax) p.dashes = p.dashMax;
}

/* Relic stat deltas live here so weapons/enemies never import the relic module. */
export const RELIC_EFFECTS = {
  whetstone:   (s) => { s.dmg *= 1.16; },
  quickhand:   (s) => { s.rate *= 0.86; },
  longarm:     (s) => { s.reach *= 1.22; },
  boots:       (s) => { s.speed *= 1.12; },
  secondwind:  (s) => { s.extraDash = (s.extraDash || 0) + 1; },
  ghoststep:   (s) => { s.dashIframes += 0.14; s.dashDist *= 1.18; },
  leech:       (s) => { s.lifesteal += 0.05; },
  keeneye:     (s) => { s.crit += 0.1; },
  butcher:     (s) => { s.critMult += 0.7; },
  brambles:    (s) => { s.thorns += 12; },
  emberheart:  (s) => { s.burnDmg += 7; },
  fatspoon:    (s) => { s.onKillHeal += 2; },
  ward:        (s) => { s.maxShieldBonus = (s.maxShieldBonus || 0) + 25; },
  mossblood:   (s) => { s.regen += 1.1; },
  splitshot:   (s) => { s.multishot += 1; s.dmg *= 0.9; },
  boreworm:    (s) => { s.pierce += 1; },
  greedring:   (s) => { s.luck += 0.14; s.coreMagnet *= 1.4; },
  oilcloth:    (s) => { s.flarePower *= 1.5; },
  duelist:     (s) => { s.moveWhileAttack = 1; s.dmg *= 1.05; },
  ironblood:   (s, p) => { p.maxHp += 22; p.hp += 22; },
};

/* ------------------------------------------------------------------ *
 *  update
 * ------------------------------------------------------------------ */
export function updatePlayer(p, dt) {
  if (p.dead) return;

  p.cool = Math.max(0, p.cool - dt);
  p.swingT = Math.max(0, p.swingT - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt * 3.4);
  p.flareCd = Math.max(0, p.flareCd - dt);
  p.lanternPhase += dt * 2.4;

  // regen + shield recharge
  if (p.stats.regen) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);
  if (p.maxShield > 0) {
    p.shieldT += dt;
    if (p.shieldT > 4 && p.shield < p.maxShield) {
      p.shield = Math.min(p.maxShield, p.shield + 16 * dt);
    }
  }

  // aim
  p.ang = Math.atan2(Input.wy - p.y, Input.wx - p.x);
  if (Math.abs(Math.cos(p.ang)) > 0.2) p.facing = Math.cos(p.ang) > 0 ? 1 : -1;

  /* ---- roll ---- */
  if (p.dashCd > 0) p.dashCd -= dt;
  if (p.dashes < p.dashMax && p.dashCd <= 0) { p.dashes++; p.dashCd = 1.15; }

  if (p.dashT > 0) {
    p.dashT -= dt;
    const sp = 720 * p.stats.dashDist;
    p.vx = Math.cos(p.dashAng) * sp;
    p.vy = Math.sin(p.dashAng) * sp;
    if (Math.random() < 0.8) {
      FX.spark(p.x, p.y, 1, { col: "#6b6252", speed: 40, life: 0.3, r: 3, glow: false });
    }
  } else {
    const m = Input.move();
    const attacking = p.swingT > 0 ? p.stats.moveWhileAttack : 1;
    const target = p.stats.speed * attacking;
    p.vx += (m.x * target - p.vx) * Math.min(1, dt * 15);
    p.vy += (m.y * target - p.vy) * Math.min(1, dt * 15);
    if (Math.hypot(m.x, m.y) > 0.1) p.walkPhase += dt * 11;
  }

  if (Input.pressed("Space") && p.dashT <= 0 && p.dashes > 0) {
    const m = Input.move();
    const a = (m.x || m.y) ? Math.atan2(m.y, m.x) : p.ang;
    p.dashAng = a;
    p.dashT = 0.17;
    p.dashes--;
    p.iframes = p.stats.dashIframes;
    FX.ring(p.x, p.y, 6, 44, "rgba(201,162,74,.5)", 0.3, 2);
    FX.spark(p.x, p.y, 10, { dir: a + Math.PI, spread: 1.1, col: "#7a6c55", speed: 220, life: 0.3 });
    Sound.play("roll");
  }

  /* ---- lantern flare ---- */
  if ((Input.pressed("AltFire") || Input.pressed("KeyQ")) && p.flareCd <= 0) {
    flare(p);
  }

  /* ---- attack ---- */
  const w = WEAPONS[p.weapon];
  if (Input.fire && p.cool <= 0 && p.dashT <= 0) {
    w.fire(p, p.ang);
    p.cool = w.rate * p.stats.rate;
    p.swingT = Math.min(0.24, w.rate * 0.7);
    p.swingDir *= -1;
  }

  p.x += p.vx * dt; p.y += p.vy * dt;
  resolvePillars(p, p.r);
  clampToRoom(p, p.r);

  // pits hurt and shove you out
  const pit = inPit(p.x, p.y);
  if (pit && p.dashT <= 0) {
    const a = Math.atan2(p.y - pit.y, p.x - pit.x);
    p.vx += Math.cos(a) * 520; p.vy += Math.sin(a) * 520;
    hurtPlayer(p, 8, a);
  }
}

export function flare(p) {
  p.flareCd = 6;
  const power = p.stats.flarePower;
  const radius = 190 * power;
  FX.ring(p.x, p.y, 10, radius, "rgba(224,134,47,.8)", 0.45, 6);
  FX.ember(p.x, p.y, 26);
  FX.smoke(p.x, p.y, 10);
  FX.shake(6);
  FX.scorch(p.x, p.y, 60 * power);
  Shader.kick("flare");
  Sound.play("flame");

  for (const e of W.enemies) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < radius) {
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      const falloff = 1 - d / radius;
      e.hurt(34 * power * falloff + 12, a, 620 * falloff);
      e.burn = Math.max(e.burn || 0, 2.4);
      e.stun = Math.max(e.stun || 0, 0.35);
    }
  }
  // burn away enemy fire in the blast
  for (let i = W.ebullets.length - 1; i >= 0; i--) {
    const b = W.ebullets[i];
    if (dist(p.x, p.y, b.x, b.y) < radius * 0.8) {
      FX.spark(b.x, b.y, 3, { col: "#e0862f", speed: 120, life: 0.2 });
      W.ebullets.splice(i, 1);
    }
  }
}

export function hurtPlayer(p, amount, fromAng) {
  if (p.dead || p.iframes > 0) return false;
  let dmg = amount;
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed; dmg -= absorbed;
    Sound.play("block");
    FX.ring(p.x, p.y, 16, 40, "rgba(143,166,184,.85)", 0.22, 3);
  }
  p.shieldT = 0;
  if (dmg > 0) {
    p.hp -= dmg;
    p.hurtFlash = 1;
    p.iframes = Math.max(p.iframes, 0.5);
    FX.blood(p.x, p.y, (fromAng ?? Math.random() * TAU) + Math.PI, 12);
    FX.shake(9);
    FX.hitstop(0.05);
    FX.text(p.x, p.y - 26, "-" + Math.round(dmg), "#d8544a");
    Shader.kick("hurt");
    Sound.play("hurt");
    W.combo = 1;
  }
  if (p.hp <= 0) { p.hp = 0; p.dead = true; }
  return true;
}

export function healPlayer(p, amount) {
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const got = Math.round(p.hp - before);
  if (got > 0) {
    FX.text(p.x, p.y - 30, "+" + got, "#7fa05c");
    FX.spark(p.x, p.y, 8, { col: "#7fa05c", speed: 90, life: 0.5 });
  }
}

/* ------------------------------------------------------------------ *
 *  draw — a hooded delver with a swinging lantern
 * ------------------------------------------------------------------ */
export function drawPlayer(ctx, p) {
  const bob = Math.sin(p.walkPhase) * 2.2;
  const lean = clamp(p.vx / 700, -0.22, 0.22);

  ctx.save();
  ctx.translate(p.x, p.y + bob);

  // ground shadow
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(0, 14 - bob, 15, 6, 0, 0, TAU); ctx.fill();
  ctx.restore();

  // roll = tuck and spin
  if (p.dashT > 0) ctx.rotate((0.17 - p.dashT) / 0.17 * TAU * (p.facing > 0 ? 1 : -1));
  else ctx.rotate(lean);

  const flash = p.hurtFlash;

  // cloak
  ctx.fillStyle = flash > 0 ? "#c9b19f" : "#312a24";
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.quadraticCurveTo(-15, -6, -13, 14);
  ctx.quadraticCurveTo(0, 18, 13, 14);
  ctx.quadraticCurveTo(15, -6, 0, -20);
  ctx.closePath(); ctx.fill();

  // cloak trim
  ctx.strokeStyle = "rgba(201,162,74,.35)";
  ctx.lineWidth = 1.4; ctx.stroke();

  // hood
  ctx.fillStyle = flash > 0 ? "#d9c6b4" : "#3c332b";
  ctx.beginPath(); ctx.ellipse(p.facing * 2, -18, 10.5, 9.5, 0, 0, TAU); ctx.fill();
  // face void
  ctx.fillStyle = "#0a0806";
  ctx.beginPath(); ctx.ellipse(p.facing * 4.5, -17, 6, 5.5, 0, 0, TAU); ctx.fill();
  // eye glint
  ctx.fillStyle = "#e0862f";
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(p.facing * 6, -17.5, 1.5, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();

  // lantern hangs off the back hand, swings with motion
  const lsw = Math.sin(p.walkPhase * 0.85) * 7;
  const lx = p.x - p.facing * 15 + lsw * 0.4;
  const ly = p.y + 2 + Math.abs(lsw) * 0.18;
  drawLantern(ctx, lx, ly, p.lanternPhase);

  // weapon
  drawWeapon(ctx, p);

  // i-frame shimmer
  if (p.iframes > 0 && p.dashT <= 0) {
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(W.t * 40) * 0.16;
    ctx.strokeStyle = "#c9a24a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 6, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

function drawLantern(ctx, x, y, phase) {
  const f = 0.86 + Math.sin(phase * 3.1) * 0.08 + Math.sin(phase * 7.7) * 0.05;
  ctx.save();
  // glow
  const g = ctx.createRadialGradient(x, y, 0, x, y, 46 * f);
  g.addColorStop(0, "rgba(255,196,110,.55)");
  g.addColorStop(0.4, "rgba(224,134,47,.22)");
  g.addColorStop(1, "rgba(224,134,47,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, 46 * f, 0, TAU); ctx.fill();
  // body
  ctx.fillStyle = "#1a1512";
  ctx.fillRect(x - 4, y - 5, 8, 10);
  ctx.fillStyle = "#ffcf86";
  ctx.globalAlpha = f;
  ctx.fillRect(x - 2.5, y - 3.5, 5, 7);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#c9a24a"; ctx.lineWidth = 1;
  ctx.strokeRect(x - 4, y - 5, 8, 10);
  ctx.restore();
}

function drawWeapon(ctx, p) {
  const w = WEAPONS[p.weapon];
  const sw = p.swingT / 0.24;
  ctx.save();
  ctx.translate(p.x, p.y);

  if (w.kind === "melee") {
    const base = p.ang - p.swingDir * 0.9;
    const a = base + p.swingDir * (1 - sw) * 1.8;
    ctx.rotate(a);
    const len = (w.range * p.stats.reach) * 0.62;
    // hilt
    ctx.strokeStyle = "#3a2b1e"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(16, 0); ctx.stroke();
    // blade
    const grad = ctx.createLinearGradient(16, 0, len, 0);
    grad.addColorStop(0, "#8e8878");
    grad.addColorStop(0.5, "#cdc6b0");
    grad.addColorStop(1, "#7d7666");
    ctx.strokeStyle = grad;
    ctx.lineWidth = p.weapon === "maul" ? 9 : p.weapon === "cleaver" ? 7 : 4.5;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(len, 0); ctx.stroke();
    if (p.weapon === "maul") {
      ctx.fillStyle = "#4a443a";
      ctx.fillRect(len - 12, -9, 14, 18);
      ctx.strokeStyle = "#2a251f"; ctx.lineWidth = 1.5;
      ctx.strokeRect(len - 12, -9, 14, 18);
    }
  } else {
    ctx.rotate(p.ang);
    ctx.strokeStyle = "#6b5334"; ctx.lineWidth = 3; ctx.lineCap = "round";
    if (p.weapon === "bow") {
      ctx.beginPath(); ctx.arc(16, 0, 13, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = "rgba(220,210,180,.7)"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16 + Math.cos(-1.25) * 13, Math.sin(-1.25) * 13);
      ctx.lineTo(16 - sw * 7, 0);
      ctx.lineTo(16 + Math.cos(1.25) * 13, Math.sin(1.25) * 13);
      ctx.stroke();
    } else if (p.weapon === "censer") {
      ctx.strokeStyle = "rgba(180,160,120,.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(20, 0); ctx.stroke();
      ctx.fillStyle = "#43372a";
      ctx.beginPath(); ctx.arc(24, 0, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(224,134,47," + (0.6 + Math.sin(W.t * 20) * 0.3) + ")";
      ctx.beginPath(); ctx.arc(24, 0, 3.4, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = "#b9c0c8";
      ctx.save(); ctx.translate(18, 0); ctx.rotate(0.3);
      ctx.fillRect(-2, -1.4, 12, 2.8);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** the swept blade streak, drawn separately so it sits above enemies */
export function drawMeleeArcs(ctx) {
  for (const h of W.hazards) {
    if (h.type !== "arc" || h.owner !== "player") continue;
    const k = h.age / h.life;
    const spread = h.half * 2;
    const a0 = h.ang - h.half + spread * k * 0.55;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.55;
    const g = ctx.createRadialGradient(h.x, h.y, h.r * 0.35, h.x, h.y, h.r);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.7, h.heavy ? "rgba(224,134,47,.55)" : "rgba(232,220,192,.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.arc(h.x, h.y, h.r, a0 - spread * 0.35, a0 + spread * 0.35);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
