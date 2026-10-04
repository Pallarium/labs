/* Weapons and every projectile in the game.
   A weapon is data + a fire() that spawns bullets or melee arcs. Relics mutate
   the player's stat block, which every weapon reads at fire time, so a relic
   never has to know which weapon you're holding. */

import { W, TAU, dist } from "./world.js";
import { FX } from "./fx.js";
import { Sound } from "./audio.js";
import { pointInPillar } from "./rooms.js";

export const WEAPONS = {
  sword: {
    name: "OLD SWORD", kind: "melee",
    dmg: 26, rate: 0.36, range: 92, arc: 1.5, knock: 320,
    fire(p, ang) {
      const reach = this.range * p.stats.reach;
      W.hazards.push({
        type: "arc", owner: "player", x: p.x, y: p.y, ang,
        r: reach, half: this.arc * 0.5, age: 0, life: 0.17,
        dmg: this.dmg * p.stats.dmg, knock: this.knock, hitSet: new Set(),
      });
      FX.spark(p.x + Math.cos(ang) * reach * 0.6, p.y + Math.sin(ang) * reach * 0.6, 4,
        { dir: ang, spread: 1.4, col: "#cdbb90", speed: 150, life: 0.22 });
      Sound.play("swing");
    },
  },

  cleaver: {
    name: "RUST CLEAVER", kind: "melee",
    dmg: 46, rate: 0.62, range: 104, arc: 2.1, knock: 520,
    fire(p, ang) {
      const reach = this.range * p.stats.reach;
      W.hazards.push({
        type: "arc", owner: "player", x: p.x, y: p.y, ang,
        r: reach, half: this.arc * 0.5, age: 0, life: 0.22,
        dmg: this.dmg * p.stats.dmg, knock: this.knock, hitSet: new Set(), heavy: true,
      });
      FX.shake(3);
      Sound.play("cleave");
    },
  },

  bow: {
    name: "YEW BOW", kind: "ranged",
    dmg: 22, rate: 0.42, speed: 760,
    fire(p, ang) {
      const n = p.stats.multishot;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.13;
        shoot(p, ang + spread + (Math.random() - 0.5) * 0.04, this.speed, this.dmg * p.stats.dmg, {
          pierce: p.stats.pierce, trail: "#d8c79a", r: 3.6, len: 16,
        });
      }
      Sound.play("bow");
    },
  },

  censer: {
    name: "BURNING CENSER", kind: "ranged",
    dmg: 9, rate: 0.085, speed: 420,
    fire(p, ang) {
      const a = ang + (Math.random() - 0.5) * 0.42;
      shoot(p, a, this.speed * (0.7 + Math.random() * 0.6), this.dmg * p.stats.dmg, {
        pierce: 99, r: 6, fade: 0.44, burn: 1, col: "#e0862f", soft: true,
      });
      if (Math.random() < 0.3) Sound.play("flame");
    },
  },

  knives: {
    name: "THROWING KNIVES", kind: "ranged",
    dmg: 15, rate: 0.13, speed: 900,
    fire(p, ang) {
      const n = p.stats.multishot;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.1 + (Math.random() - 0.5) * 0.11;
        shoot(p, ang + spread, this.speed, this.dmg * p.stats.dmg, {
          pierce: p.stats.pierce, trail: "#b9c0c8", r: 2.6, len: 13,
        });
      }
      Sound.play("throw");
    },
  },

  maul: {
    name: "IRON MAUL", kind: "melee",
    dmg: 64, rate: 0.9, range: 118, arc: 2.6, knock: 760,
    fire(p, ang) {
      const reach = this.range * p.stats.reach;
      W.hazards.push({
        type: "arc", owner: "player", x: p.x, y: p.y, ang,
        r: reach, half: this.arc * 0.5, age: 0, life: 0.26,
        dmg: this.dmg * p.stats.dmg, knock: this.knock, hitSet: new Set(), heavy: true, quake: true,
      });
      FX.ring(p.x, p.y, 10, reach, "rgba(201,162,74,.6)", 0.3, 4);
      FX.shake(7); FX.hitstop(0.035);
      Sound.play("hammer");
    },
  },
};

/* ------------------------------------------------------------------ *
 *  projectile spawning
 * ------------------------------------------------------------------ */
export function shoot(p, ang, speed, dmg, opt) {
  const o = opt || {};
  W.bullets.push({
    x: p.x + Math.cos(ang) * 18, y: p.y + Math.sin(ang) * 18,
    vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
    ang, dmg, r: o.r || 4, life: o.fade || 1.5, age: 0,
    pierce: o.pierce || 0, hit: new Set(),
    col: o.col || "#e8dcc0", trail: o.trail, len: o.len || 0,
    burn: o.burn || 0, soft: !!o.soft, homing: o.homing || 0,
    bounce: o.bounce || 0, split: o.split || 0, crit: !!o.crit,
  });
}

export function enemyShot(x, y, ang, speed, dmg, opt) {
  const o = opt || {};
  W.ebullets.push({
    x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
    ang, dmg, r: o.r || 6, life: o.life || 3.4, age: 0,
    col: o.col || "#a8402c", kind: o.kind || "bolt",
    accel: o.accel || 0, homing: o.homing || 0, wob: o.wob || 0,
    spin: o.spin || 0, passWalls: !!o.passWalls,
  });
}

/* ------------------------------------------------------------------ *
 *  updates
 * ------------------------------------------------------------------ */
export function updateBullets(dt) {
  const room = W.room;
  for (let i = W.bullets.length - 1; i >= 0; i--) {
    const b = W.bullets[i];
    b.age += dt;

    if (b.homing) {
      let best = null, bd = 1e9;
      for (const e of W.enemies) {
        if (e.dead || b.hit.has(e)) continue;
        const d = dist(b.x, b.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best && bd < 420) {
        const want = Math.atan2(best.y - b.y, best.x - b.x);
        let d = ((want - b.ang + Math.PI) % TAU) - Math.PI;
        if (d < -Math.PI) d += TAU;
        b.ang += d * Math.min(1, b.homing * dt);
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(b.ang) * sp; b.vy = Math.sin(b.ang) * sp;
      }
    }

    b.x += b.vx * dt; b.y += b.vy * dt;

    if (b.trail && Math.random() < 0.5) {
      FX.spark(b.x, b.y, 1, { col: b.trail, speed: 20, life: 0.2, r: 1.4, glow: false });
    }
    if (b.burn) FX.ember(b.x, b.y, 1);

    let gone = b.age > b.life ||
      b.x < -20 || b.y < -20 || (room && (b.x > room.w + 20 || b.y > room.h + 20));

    if (!gone && pointInPillar(b.x, b.y, b.r * 0.5)) {
      if (b.bounce > 0) {
        b.bounce--;
        b.vx = -b.vx; b.vy = -b.vy;
        b.ang = Math.atan2(b.vy, b.vx);
        b.x += b.vx * dt * 2; b.y += b.vy * dt * 2;
      } else {
        FX.spark(b.x, b.y, 5, { col: "#cdbb90", speed: 130, life: 0.24 });
        gone = true;
      }
    }
    if (gone) W.bullets.splice(i, 1);
  }
}

export function updateEnemyBullets(dt) {
  const room = W.room;
  for (let i = W.ebullets.length - 1; i >= 0; i--) {
    const b = W.ebullets[i];
    b.age += dt;

    if (b.homing && W.player && !W.player.dead) {
      const want = Math.atan2(W.player.y - b.y, W.player.x - b.x);
      let d = ((want - b.ang + Math.PI) % TAU) - Math.PI;
      if (d < -Math.PI) d += TAU;
      b.ang += d * Math.min(1, b.homing * dt);
      const sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(b.ang) * sp; b.vy = Math.sin(b.ang) * sp;
    }
    if (b.accel) {
      const sp = Math.hypot(b.vx, b.vy) + b.accel * dt;
      b.vx = Math.cos(b.ang) * sp; b.vy = Math.sin(b.ang) * sp;
    }
    if (b.wob) {
      const off = Math.sin(b.age * 14) * b.wob;
      b.x += Math.cos(b.ang + Math.PI / 2) * off * dt * 60;
      b.y += Math.sin(b.ang + Math.PI / 2) * off * dt * 60;
    }
    if (b.spin) b.rot = (b.rot || 0) + b.spin * dt;

    b.x += b.vx * dt; b.y += b.vy * dt;

    let gone = b.age > b.life ||
      b.x < -30 || b.y < -30 || (room && (b.x > room.w + 30 || b.y > room.h + 30));

    if (!gone && !b.passWalls && pointInPillar(b.x, b.y, b.r * 0.4)) {
      FX.spark(b.x, b.y, 4, { col: b.col, speed: 110, life: 0.22 });
      gone = true;
    }
    if (gone) W.ebullets.splice(i, 1);
  }
}

/** melee arcs and lingering ground hazards */
export function updateHazards(dt) {
  for (let i = W.hazards.length - 1; i >= 0; i--) {
    const h = W.hazards[i];
    h.age += dt;
    if (h.follow && h.follow.x != null) { h.x = h.follow.x; h.y = h.follow.y; }
    if (h.age >= h.life) { W.hazards.splice(i, 1); continue; }
  }
}

export function weaponList() { return Object.keys(WEAPONS); }
