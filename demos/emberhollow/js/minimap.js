/* Corner minimap. The dark is the point of this game, so the map shows SHAPE
   and threat direction only — walls, pillars, pits, braziers you've lit past,
   the gate, and enemies as anonymous dots. It never tells you what they are. */

import { W, TAU, clamp } from "./world.js";
import { gatePos } from "./rooms.js";

const PAD = 14;
const MAXW = 168;
const MAXH = 128;

export function drawMinimap(ctx, view) {
  const r = W.room, p = W.player;
  if (!r || !p) return;

  const scale = Math.min(MAXW / r.w, MAXH / r.h);
  const mw = r.w * scale, mh = r.h * scale;
  const ox = view.w - mw - PAD, oy = PAD + 54;

  const X = (wx) => ox + wx * scale;
  const Y = (wy) => oy + wy * scale;

  ctx.save();
  ctx.globalAlpha = 0.82;

  // backing
  ctx.fillStyle = "rgba(8,6,5,.72)";
  ctx.fillRect(ox - 4, oy - 4, mw + 8, mh + 8);
  ctx.strokeStyle = "rgba(201,162,74,.26)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 4.5, oy - 4.5, mw + 9, mh + 9);

  // floor plate
  ctx.fillStyle = "rgba(58,47,36,.5)";
  ctx.fillRect(ox, oy, mw, mh);

  // pits read as voids
  ctx.fillStyle = "rgba(0,0,0,.75)";
  for (const pit of r.pits) {
    ctx.beginPath();
    ctx.ellipse(X(pit.x), Y(pit.y), pit.rx * scale, pit.ry * scale, 0, 0, TAU);
    ctx.fill();
  }

  // pillars
  ctx.fillStyle = "rgba(120,104,82,.55)";
  for (const pl of r.pillars) {
    ctx.beginPath();
    ctx.arc(X(pl.x), Y(pl.y), Math.max(1.5, pl.r * scale), 0, TAU);
    ctx.fill();
  }

  // braziers — the only fixed landmarks down here
  ctx.fillStyle = "rgba(224,134,47,.8)";
  for (const b of r.braziers) {
    ctx.beginPath();
    ctx.arc(X(b.x), Y(b.y), 1.6, 0, TAU);
    ctx.fill();
  }

  // enemies: anonymous dots, boss gets a bigger one
  for (const e of W.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    ctx.fillStyle = e.boss ? "rgba(216,84,74,.95)" : "rgba(168,64,44,.85)";
    ctx.beginPath();
    ctx.arc(X(e.x), Y(e.y), e.boss ? 3.2 : 1.8, 0, TAU);
    ctx.fill();
  }

  // gate, pulsing once it opens
  const g = gatePos();
  if (W.gateOpen) {
    const pulse = 0.5 + Math.sin(W.t * 3) * 0.5;
    ctx.fillStyle = `rgba(232,220,192,${(0.45 + pulse * 0.55).toFixed(3)})`;
    ctx.fillRect(X(g.x) - 2.5, Y(g.y) - 2.5, 5, 5);
  } else {
    ctx.fillStyle = "rgba(90,80,64,.7)";
    ctx.fillRect(X(g.x) - 2, Y(g.y) - 2, 4, 4);
  }

  // you
  ctx.fillStyle = "#ffcf86";
  ctx.beginPath();
  ctx.arc(X(p.x), Y(p.y), 2.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,207,134,.5)";
  ctx.beginPath();
  ctx.moveTo(X(p.x), Y(p.y));
  ctx.lineTo(X(p.x) + Math.cos(p.ang) * 7, Y(p.y) + Math.sin(p.ang) * 7);
  ctx.stroke();

  // remaining count, so a cleared room is obvious at a glance
  const left = W.enemies.filter((e) => !e.dead).length;
  ctx.globalAlpha = 0.85;
  ctx.font = "600 9px ui-monospace,monospace";
  ctx.textAlign = "right";
  ctx.fillStyle = left ? "#a8402c" : "#7fa05c";
  ctx.fillText(left ? left + " LEFT" : "CLEAR", ox + mw, oy + mh + 12);

  ctx.restore();
}
