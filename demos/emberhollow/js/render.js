/* Renderer. Draw order: floor bake -> decals -> pits -> pickups -> entities ->
   projectiles -> fx -> lighting pass -> vignette.
   Lighting is a single multiply-composited darkness layer with holes punched
   for the lantern, braziers, the flare and every bullet. */

import { W, TAU, clamp, lerp } from "./world.js";
import { FX } from "./fx.js";
import { drawPlayer, drawMeleeArcs } from "./player.js";
import { gatePos } from "./rooms.js";
import { drawMinimap } from "./minimap.js";

let light = null, lctx = null;

export function initRender(view) {
  light = document.createElement("canvas");
  lctx = light.getContext("2d");
  resizeLight(view);
}
function resizeLight(view) {
  light.width = Math.max(2, Math.ceil(view.w / 2));
  light.height = Math.max(2, Math.ceil(view.h / 2));
}

export function updateCamera(dt) {
  const c = W.cam, p = W.player, r = W.room;
  if (!p || !r) return;
  // lead the camera toward the aim point a little
  const lead = 0.16;
  c.tx = p.x + (W.mouseWorldX != null ? (W.mouseWorldX - p.x) * lead : 0);
  c.ty = p.y + (W.mouseWorldY != null ? (W.mouseWorldY - p.y) * lead : 0);

  const vw = W.view.w / c.zoom, vh = W.view.h / c.zoom;
  // keep camera inside the room unless the room is smaller than the view
  c.tx = r.w > vw ? clamp(c.tx, vw / 2, r.w - vw / 2) : r.w / 2;
  c.ty = r.h > vh ? clamp(c.ty, vh / 2, r.h - vh / 2) : r.h / 2;

  c.x = lerp(c.x, c.tx, Math.min(1, dt * 7));
  c.y = lerp(c.y, c.ty, Math.min(1, dt * 7));
  c.zoom = lerp(c.zoom, c.tzoom, Math.min(1, dt * 3));
}

export function render(ctx, view) {
  const r = W.room, p = W.player, c = W.cam;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0a0806";
  ctx.fillRect(0, 0, view.w, view.h);
  if (!r) return;

  if (light.width !== Math.ceil(view.w / 2)) resizeLight(view);

  ctx.save();
  ctx.translate(view.w / 2 + c.sx, view.h / 2 + c.sy);
  ctx.scale(c.zoom, c.zoom);
  ctx.translate(-c.x, -c.y);

  /* ---------- ground ---------- */
  ctx.drawImage(r.tex, 0, 0);
  const dec = FX.decalCanvas;
  if (dec) ctx.drawImage(dec, 0, 0);

  /* ---------- walls ---------- */
  ctx.strokeStyle = "#0b0907";
  ctx.lineWidth = 26;
  ctx.strokeRect(-13, -13, r.w + 26, r.h + 26);
  ctx.strokeStyle = "rgba(201,162,74,.12)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, r.w - 2, r.h - 2);

  /* ---------- gate ---------- */
  drawGate(ctx, r);

  /* ---------- braziers ---------- */
  for (const b of r.braziers) drawBrazier(ctx, b);

  /* ---------- rubble ---------- */
  ctx.fillStyle = "rgba(0,0,0,.34)";
  for (const s of r.rubble) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
    ctx.fillRect(-s.r, -s.r * 0.6, s.r * 2, s.r * 1.2);
    ctx.restore();
  }

  /* ---------- pickups ---------- */
  for (const k of W.pickups) drawPickup(ctx, k);

  /* ---------- enemies (sorted by y for depth) ---------- */
  const sorted = W.enemies.slice().sort((a, b) => a.y - b.y);
  for (const e of sorted) if (!e.dead) e.draw(ctx);

  /* ---------- player ---------- */
  if (p && !p.dead) drawPlayer(ctx, p);
  drawMeleeArcs(ctx);

  /* ---------- pillars on top so they occlude ---------- */
  for (const pl of r.pillars) drawPillar(ctx, pl);

  /* ---------- projectiles ---------- */
  for (const b of W.bullets) drawBullet(ctx, b, true);
  for (const b of W.ebullets) drawBullet(ctx, b, false);

  /* ---------- particles ---------- */
  FX.draw(ctx);

  ctx.restore();

  /* ---------- lighting ---------- */
  drawLighting(ctx, view);

  /* ---------- vignette ---------- */
  const vg = ctx.createRadialGradient(
    view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.26,
    view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.76);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,.72)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, view.w, view.h);

  drawThreats(ctx, view);
  if (W.state === "playing") drawMinimap(ctx, view);

  if (p && p.hurtFlash > 0.02) {
    ctx.fillStyle = `rgba(150,26,20,${p.hurtFlash * 0.24})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  // low blood: the edges breathe red so you feel it without watching the bar
  if (p && !p.dead) {
    const k = p.hp / p.maxHp;
    if (k < 0.34) {
      const sev = 1 - k / 0.34;
      const beat = 0.5 + Math.sin(W.t * (3.4 + sev * 3.6)) * 0.5;
      const a = (0.1 + sev * 0.3) * (0.45 + beat * 0.55);
      const rg = ctx.createRadialGradient(
        view.w / 2, view.h / 2, Math.min(view.w, view.h) * (0.3 - sev * 0.08),
        view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.62);
      rg.addColorStop(0, "rgba(120,10,8,0)");
      rg.addColorStop(1, `rgba(126,14,10,${a.toFixed(3)})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }
}

/* ------------------------------------------------------------------ */
function drawLighting(ctx, view) {
  const c = W.cam, p = W.player, r = W.room;
  const sx = light.width / view.w, sy = light.height / view.h;

  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = "source-over";
  lctx.fillStyle = "rgba(6,5,4,0.82)";
  lctx.fillRect(0, 0, light.width, light.height);

  lctx.globalCompositeOperation = "destination-out";
  const toS = (wx, wy) => [
    ((wx - c.x) * c.zoom + view.w / 2 + c.sx) * sx,
    ((wy - c.y) * c.zoom + view.h / 2 + c.sy) * sy,
  ];

  const hole = (wx, wy, rad, strength) => {
    const [x, y] = toS(wx, wy);
    const rr = rad * c.zoom * sx;
    const g = lctx.createRadialGradient(x, y, 0, x, y, Math.max(1, rr));
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    lctx.fillStyle = g;
    lctx.beginPath(); lctx.arc(x, y, Math.max(1, rr), 0, TAU); lctx.fill();
  };

  if (p && !p.dead) {
    const flick = 1 + Math.sin(W.t * 9.3) * 0.03 + Math.sin(W.t * 21.1) * 0.02;
    hole(p.x, p.y, 235 * flick * p.stats.flarePower, 1);
    hole(p.x, p.y, 470 * flick, 0.42);
  }
  if (r) for (const b of r.braziers) {
    const f = 1 + Math.sin(W.t * 6 + b.flick) * 0.08;
    hole(b.x, b.y, 170 * f, 0.85);
  }
  for (const b of W.bullets) if (b.burn || b.trail) hole(b.x, b.y, 54, 0.5);
  for (const b of W.ebullets) hole(b.x, b.y, 46, 0.45);
  for (const e of W.enemies) if (!e.dead && e.burn > 0) hole(e.x, e.y, 90, 0.5);
  if (W.gateOpen && r) { const g = gatePos(); hole(g.x, g.y, 150, 0.8); }

  lctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(light, 0, 0, view.w, view.h);
  ctx.restore();

  // warm additive bloom from the lantern + braziers
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(view.w / 2 + c.sx, view.h / 2 + c.sy);
  ctx.scale(c.zoom, c.zoom);
  ctx.translate(-c.x, -c.y);
  const warm = (x, y, rad, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(224,134,47,${a})`);
    g.addColorStop(1, "rgba(224,134,47,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
  };
  if (p && !p.dead) warm(p.x, p.y, 200, 0.07);
  if (r) for (const b of r.braziers) warm(b.x, b.y, 140, 0.1);
  ctx.restore();
}

/* Edge arrows for anything offscreen. The dark is atmosphere, not a cheap
   ambush — you should always know roughly where the pressure is coming from. */
function drawThreats(ctx, view) {
  const p = W.player, c = W.cam;
  if (!p || p.dead) return;
  const cx = view.w / 2, cy = view.h / 2;
  const pad = 42;

  ctx.save();
  for (const e of W.enemies) {
    if (e.dead) continue;
    const sx = (e.x - c.x) * c.zoom + cx;
    const sy = (e.y - c.y) * c.zoom + cy;
    if (sx > pad && sx < view.w - pad && sy > pad && sy < view.h - pad) continue;

    const a = Math.atan2(sy - cy, sx - cx);
    const rx = (view.w / 2 - pad) / Math.max(0.0001, Math.abs(Math.cos(a)));
    const ry = (view.h / 2 - pad) / Math.max(0.0001, Math.abs(Math.sin(a)));
    const rad = Math.min(rx, ry);
    const ax = cx + Math.cos(a) * rad;
    const ay = cy + Math.sin(a) * rad;

    const col = e.boss ? "#e0862f" : e.elite ? e.eliteDef.col : "#a8402c";
    const size = e.boss ? 14 : e.elite ? 11 : 8;
    const pulse = 0.5 + Math.sin(W.t * (e.boss ? 6 : 3.4) + e.phase) * 0.22;

    ctx.globalAlpha = pulse;
    ctx.fillStyle = col;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.62);
    ctx.lineTo(-size * 0.7, -size * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // the open gate gets its own marker so a cleared room never becomes a hunt
  if (W.gateOpen) {
    const g = gatePos();
    const sx = (g.x - c.x) * c.zoom + cx;
    const sy = (g.y - c.y) * c.zoom + cy;
    if (sx < pad || sx > view.w - pad || sy < pad || sy > view.h - pad) {
      const a = Math.atan2(sy - cy, sx - cx);
      const rx = (view.w / 2 - pad) / Math.max(0.0001, Math.abs(Math.cos(a)));
      const ry = (view.h / 2 - pad) / Math.max(0.0001, Math.abs(Math.sin(a)));
      const rad = Math.min(rx, ry);
      const ax = cx + Math.cos(a) * rad, ay = cy + Math.sin(a) * rad;
      const pulse = 0.55 + Math.sin(W.t * 3) * 0.3;

      ctx.globalAlpha = pulse;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = "#e8dcc0";
      ctx.shadowColor = "#e0862f";
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-9, 9);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-9, -9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.globalAlpha = pulse * 0.9;
      ctx.fillStyle = "#c9a24a";
      ctx.font = "600 11px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.fillText("WAY DOWN", ax - Math.cos(a) * 26, ay - Math.sin(a) * 26 + 4);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
function drawPillar(ctx, p) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.5, p.r * 1.25, p.r * 0.55, 0, 0, TAU); ctx.fill();

  const g = ctx.createLinearGradient(p.x - p.r, 0, p.x + p.r, 0);
  g.addColorStop(0, "#1a1611");
  g.addColorStop(0.42, "#3a3228");
  g.addColorStop(1, "#14110d");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 2; ctx.stroke();
  // carved bands
  ctx.strokeStyle = "rgba(201,162,74,.1)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.74, 0, TAU); ctx.stroke();
  ctx.restore();
}

function drawBrazier(ctx, b) {
  const f = 0.85 + Math.sin(W.t * 6 + b.flick) * 0.12 + Math.sin(W.t * 17 + b.flick) * 0.05;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 10, 16, 6, 0, 0, TAU); ctx.fill();
  // stand
  ctx.strokeStyle = "#2e2720"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + 11); ctx.stroke();
  // bowl
  ctx.fillStyle = "#3a332a";
  ctx.beginPath();
  ctx.moveTo(b.x - 13, b.y - 4);
  ctx.lineTo(b.x + 13, b.y - 4);
  ctx.lineTo(b.x + 8, b.y + 5);
  ctx.lineTo(b.x - 8, b.y + 5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#c9a24a"; ctx.lineWidth = 1; ctx.globalAlpha = 0.3; ctx.stroke();
  ctx.globalAlpha = 1;
  // flame
  ctx.fillStyle = "rgba(224,134,47,.9)";
  ctx.beginPath();
  ctx.moveTo(b.x - 7 * f, b.y - 5);
  ctx.quadraticCurveTo(b.x, b.y - 26 * f, b.x + 7 * f, b.y - 5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,214,140,.95)";
  ctx.beginPath();
  ctx.moveTo(b.x - 3.4 * f, b.y - 5);
  ctx.quadraticCurveTo(b.x, b.y - 16 * f, b.x + 3.4 * f, b.y - 5);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  if (Math.random() < 0.25) FX.ember(b.x, b.y - 8, 1);
}

function drawGate(ctx, r) {
  const g = gatePos();
  const open = W.gateOpen;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.fillStyle = open ? "#120e0a" : "#241c14";
  ctx.fillRect(-16, -52, 32, 104);
  ctx.strokeStyle = open ? "rgba(224,134,47,.8)" : "rgba(80,70,56,.8)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-16, -52, 32, 104);
  if (open) {
    const pulse = 0.5 + Math.sin(W.t * 4) * 0.25;
    ctx.globalAlpha = pulse;
    const lg = ctx.createLinearGradient(0, -52, 0, 52);
    lg.addColorStop(0, "rgba(224,134,47,0)");
    lg.addColorStop(0.5, "rgba(224,134,47,.8)");
    lg.addColorStop(1, "rgba(224,134,47,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(-12, -48, 24, 96);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e6dcc6";
    ctx.font = '600 11px "SF Mono",monospace';
    ctx.textAlign = "center";
    ctx.fillText("ONWARD", 0, -66);
  } else {
    // iron bars
    ctx.strokeStyle = "rgba(120,106,84,.75)"; ctx.lineWidth = 4;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(-14, i * 20); ctx.lineTo(14, i * 20); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPickup(ctx, k) {
  const bob = Math.sin(W.t * 4 + k.phase) * 3;
  ctx.save();
  ctx.translate(k.x, k.y + bob);
  const fading = k.age > k.life - 4 && Math.floor(k.age * 6) % 2 === 0;
  if (fading) ctx.globalAlpha = 0.35;
  if (k.kind === "core") {
    ctx.fillStyle = "#c9a24a";
    ctx.shadowColor = "#c9a24a"; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = "#a8402c";
    ctx.shadowColor = "#a8402c"; ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-10, -2, -5, -9, 0, -4);
    ctx.bezierCurveTo(5, -9, 10, -2, 0, 6);
    ctx.fill();
  }
  ctx.restore();
}

function drawBullet(ctx, b, mine) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot != null ? b.rot : b.ang);
  if (b.soft) {
    const k = 1 - b.age / b.life;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r * (1 + (1 - k) * 1.6));
    g.addColorStop(0, `rgba(255,206,130,${0.8 * k})`);
    g.addColorStop(0.5, `rgba(224,134,47,${0.5 * k})`);
    g.addColorStop(1, "rgba(224,134,47,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, b.r * (1 + (1 - k) * 1.6), 0, TAU); ctx.fill();
  } else if (b.len) {
    ctx.strokeStyle = b.col; ctx.lineWidth = b.r; ctx.lineCap = "round";
    ctx.shadowColor = b.col; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(-b.len, 0); ctx.lineTo(b.len * 0.35, 0); ctx.stroke();
  } else {
    ctx.fillStyle = b.col;
    ctx.shadowColor = b.col; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.ellipse(0, 0, b.r * 1.4, b.r, 0, 0, TAU); ctx.fill();
    if (!mine) {
      ctx.fillStyle = "rgba(20,14,10,.75)";
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.45, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}
