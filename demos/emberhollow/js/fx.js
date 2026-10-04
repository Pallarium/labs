/* Particles, decals, floating numbers, screen shake, hitstop.
   Decals live on their own buffer so blood and scorch persist for the whole
   chamber without costing a draw call each frame. */

import { W, clamp, TAU } from "./world.js";

const parts = [];
const texts = [];
const rings = [];
let decal = null, dctx = null;

export const FX = {
  initDecals(w, h) {
    decal = document.createElement("canvas");
    decal.width = Math.ceil(w); decal.height = Math.ceil(h);
    dctx = decal.getContext("2d");
  },
  get decalCanvas() { return decal; },

  clear() { parts.length = 0; texts.length = 0; rings.length = 0; },

  shake(amount) { W.cam.shake = Math.min(34, W.cam.shake + amount); },
  hitstop(s) { W.hitstop = Math.max(W.hitstop, s); },

  /* ---------------- emitters ---------------- */
  spark(x, y, n, opt) {
    const o = opt || {};
    for (let i = 0; i < n; i++) {
      const a = o.dir != null ? o.dir + (Math.random() - 0.5) * (o.spread || 1.2) : Math.random() * TAU;
      const sp = (o.speed || 180) * (0.4 + Math.random() * 0.9);
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: (o.life || 0.5) * (0.6 + Math.random() * 0.7), age: 0,
        r: o.r || 2.2, col: o.col || "#e0862f", drag: o.drag ?? 2.6,
        grav: o.grav ?? 0, glow: o.glow ?? true, kind: "spark",
      });
    }
  },

  ember(x, y, n) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: x + (Math.random() - 0.5) * 10, y,
        vx: (Math.random() - 0.5) * 22, vy: -18 - Math.random() * 34,
        life: 1.1 + Math.random() * 1.2, age: 0, r: 1.3 + Math.random(),
        col: Math.random() < 0.3 ? "#ffd9a0" : "#e0862f",
        drag: 0.4, grav: -6, glow: true, kind: "ember",
      });
    }
  },

  smoke(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 30, vy: -14 - Math.random() * 26,
        life: 0.8 + Math.random() * 0.9, age: 0, r: 5 + Math.random() * 8,
        col: col || "rgba(60,52,44,1)", drag: 1.1, grav: -4, glow: false, kind: "smoke",
      });
    }
  },

  blood(x, y, dir, n, col) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * 1.5;
      const sp = 90 + Math.random() * 300;
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.5, age: 0, r: 1.6 + Math.random() * 2.4,
        col: col || "#8e2a22", drag: 3.2, grav: 0, glow: false, kind: "blood",
      });
    }
  },

  gib(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 120 + Math.random() * 260;
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.6 + Math.random() * 0.6, age: 0, r: 2.5 + Math.random() * 3.5,
        col: col || "#6b2018", drag: 2.4, grav: 0, glow: false, kind: "gib",
        rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 16,
      });
    }
  },

  ring(x, y, r0, r1, col, life, width) {
    rings.push({ x, y, r0, r1, col: col || "#e0862f", life: life || 0.34, age: 0, w: width || 3 });
  },

  text(x, y, str, col, big) {
    texts.push({ x, y, str, col: col || "#e6dcc6", age: 0, life: big ? 1.1 : 0.7, big: !!big, vy: -34 });
  },

  /** permanent stain on the decal buffer (room-local coords) */
  stain(x, y, r, col, alpha) {
    if (!dctx) return;
    dctx.save();
    dctx.globalAlpha = alpha ?? 0.5;
    const g = dctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    dctx.fillStyle = g;
    dctx.beginPath(); dctx.arc(x, y, r, 0, TAU); dctx.fill();
    dctx.restore();
  },

  scorch(x, y, r) { this.stain(x, y, r, "rgba(14,10,8,1)", 0.55); },

  /* ---------------- update ---------------- */
  update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        if (p.kind === "blood" && Math.random() < 0.6) FX.stain(p.x, p.y, p.r * 2.4, "rgba(92,24,18,1)", 0.34);
        parts.splice(i, 1); continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.vy += (p.grav || 0) * dt * 60 * 0.016;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spin) p.rot += p.spin * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]; t.age += dt; t.y += t.vy * dt; t.vy *= Math.exp(-2.2 * dt);
      if (t.age >= t.life) texts.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.age += dt;
      if (r.age >= r.life) rings.splice(i, 1);
    }

    const c = W.cam;
    if (c.shake > 0) {
      c.shake = Math.max(0, c.shake - dt * 58);
      const a = Math.random() * TAU, m = c.shake;
      c.sx = Math.cos(a) * m; c.sy = Math.sin(a) * m;
    } else { c.sx = 0; c.sy = 0; }
  },

  /* ---------------- draw ---------------- */
  draw(ctx) {
    ctx.save();
    for (const p of parts) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = p.kind === "smoke" ? k * 0.32 : clamp(k * 1.35, 0, 1);
      if (p.glow) { ctx.shadowColor = p.col; ctx.shadowBlur = 12 * k; }
      else ctx.shadowBlur = 0;
      ctx.fillStyle = p.col;
      if (p.kind === "gib") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4);
        ctx.restore();
      } else if (p.kind === "smoke") {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + (1 - k) * 1.4), 0, TAU); ctx.fill();
      } else {
        const r = p.r * (p.kind === "spark" ? k * 1.1 + 0.3 : 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.4, r), 0, TAU); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    for (const r of rings) {
      const k = r.age / r.life;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = r.col; ctx.lineWidth = r.w * (1 - k * 0.6);
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * k, 0, TAU); ctx.stroke();
    }

    ctx.textAlign = "center";
    for (const t of texts) {
      const k = 1 - t.age / t.life;
      ctx.globalAlpha = clamp(k * 1.5, 0, 1);
      ctx.font = (t.big ? "600 26px " : "600 15px ") + '"Iowan Old Style",Georgia,serif';
      ctx.fillStyle = "rgba(0,0,0,.75)";
      ctx.fillText(t.str, t.x + 1.5, t.y + 1.5);
      ctx.fillStyle = t.col;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  },
};
