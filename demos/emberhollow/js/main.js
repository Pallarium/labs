/* Game loop, run flow, collisions, HUD and screens. */

import { W, resetRun, clamp, dist, TAU } from "./world.js";
import { makeRNG } from "./rng.js";
import { Input } from "./input.js";
import { Sound } from "./audio.js";
import { FX } from "./fx.js";
import { makeRoom, floorDef, gatePos, spawnPoint, FLOORS } from "./rooms.js";
import { makePlayer, updatePlayer, drawPlayer, hurtPlayer, healPlayer, recomputeStats } from "./player.js";
import { makeEnemy, makeElite, makeBoss, rollWave, TYPES } from "./enemies.js";
import { updateBullets, updateEnemyBullets, updateHazards, WEAPONS } from "./weapons.js";
import { rollDraft, takeCard, buildChips, cardHTML, statSheet } from "./relics.js";
import { initRender, render, updateCamera } from "./render.js";
import { Shader } from "./shader.js";

const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const $ = (id) => document.getElementById(id);

const META_KEY = "emberhollow.meta.v1";
let meta = loadMeta();
let draftCards = [];
let rerollCost = 5;

/* ------------------------------------------------------------------ *
 *  boot
 * ------------------------------------------------------------------ */
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.floor(innerWidth * dpr);
  cv.height = Math.floor(innerHeight * dpr);
  W.view.w = cv.width; W.view.h = cv.height;
  W.cam.tzoom = clamp(Math.min(cv.width / 1280, cv.height / 720), 0.75, 1.9) * dpr * 0.62 + 0.5;
  initRender(W.view);
}
addEventListener("resize", resize);
resize();
Input.init(cv);
Shader.install(cv);
Shader.resize(cv.width, cv.height);
paintMeta();

/* ------------------------------------------------------------------ *
 *  meta save
 * ------------------------------------------------------------------ */
function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fresh ledger */ }
  return { best: 0, kills: 0, cores: 0, runs: 0 };
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* private mode */ }
}
function paintMeta() {
  $("mBest").textContent = meta.best;
  $("mKills").textContent = meta.kills;
  $("mCores").textContent = meta.cores;
  $("mRuns").textContent = meta.runs;
}

/* ------------------------------------------------------------------ *
 *  screens
 * ------------------------------------------------------------------ */
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function only(id) {
  ["title", "draft", "pause", "over"].forEach((s) => (s === id ? show(s) : hide(s)));
  if (id) hide("hud"); else show("hud");
}

function banner(title, sub, ms) {
  const b = $("banner");
  b.querySelector("h1").textContent = title;
  b.querySelector("p").textContent = sub || "";
  b.classList.remove("hidden");
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
  clearTimeout(banner._t);
  banner._t = setTimeout(() => b.classList.add("hidden"), ms || 1900);
}

/* ------------------------------------------------------------------ *
 *  run flow
 * ------------------------------------------------------------------ */
function startRun() {
  Sound.init(); Sound.resume();
  resetRun();
  FX.clear();
  W.rng = makeRNG((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  W.player = makePlayer();
  recomputeStats(W.player);
  meta.runs++; saveMeta(); paintMeta();
  W.state = "playing";
  only(null);
  enterRoom(true);
  banner(floorDef(1).name, "FLOOR ONE", 2300);
}

function enterRoom(first) {
  const isBoss = W.roomIdx === W.roomsPerFloor - 1;
  W.room = makeRoom(W.rng, isBoss ? "boss" : "fight");
  W.enemies.length = 0; W.bullets.length = 0; W.ebullets.length = 0;
  W.pickups.length = 0; W.hazards.length = 0;
  W.gateOpen = false; W.cleared = false;

  const p = W.player;
  p.x = 110; p.y = W.room.h * 0.5;
  p.vx = 0; p.vy = 0;
  p.iframes = Math.max(p.iframes, 1.2);   // grace on entering a chamber
  W.cam.x = p.x; W.cam.y = p.y;

  if (isBoss) {
    const b = makeBoss(floorDef(W.floor).boss, W.room.w * 0.72, W.room.h * 0.5);
    W.enemies.push(b);
    W.boss = b;
    banner(b.bossName, b.bossSub, 2600);
    Sound.play("bossIn");
    Sound.setIntensity(1);
  } else {
    W.boss = null;
    const wave = rollWave(W.rng, W.floor, W.roomIdx);
    // one elite starts showing up once you're a few chambers in, never two
    const eliteChance = W.roomIdx >= 2 ? 0.2 + (W.floor - 1) * 0.12 + W.roomIdx * 0.04 : 0;
    let eliteUsed = !W.rng.chance(Math.min(0.75, eliteChance));
    for (const t of wave) {
      const sp = spawnPoint(W.rng, p, 300);
      if (!eliteUsed && TYPES[t].tier >= 2) {
        eliteUsed = true;
        W.enemies.push(makeElite(t, sp.x, sp.y, W.rng));
      } else {
        W.enemies.push(makeEnemy(t, sp.x, sp.y));
      }
    }
    Sound.setIntensity(clamp(0.25 + wave.length * 0.06, 0, 0.9));
  }
  updateHUD();
}

function clearRoom() {
  W.cleared = true;
  W.gateOpen = true;
  Sound.play("gate");
  Sound.setIntensity(0.12);
  banner("CHAMBER CLEAR", "THE DOOR UNBARS", 1500);
  FX.ring(gatePos().x, gatePos().y, 10, 180, "rgba(224,134,47,.6)", 0.7, 5);
}

function advance() {
  W.roomIdx++;
  if (W.roomIdx >= W.roomsPerFloor) {
    W.roomIdx = 0;
    W.floor++;
    if (W.floor > FLOORS.length) { endRun(true); return; }
    openDraft(true);
  } else {
    openDraft(false);
  }
}

function openDraft(floorUp) {
  W.state = "draft";
  only("draft");
  rerollCost = 5;
  draftCards = rollDraft(W.rng, W.player, 3);
  $("cards").innerHTML = draftCards.map(cardHTML).join("");
  $("rerollCost").textContent = rerollCost;
  $("draft").querySelector("h2").textContent = floorUp ? "DEEPER STILL — TAKE A RELIC" : "TAKE A RELIC";
  Sound.play("levelup");
  [...$("cards").children].forEach((el, i) => {
    el.addEventListener("click", () => pickCard(i));
    el.addEventListener("mouseenter", () => Sound.play("ui"));
  });
}

function pickCard(i) {
  const c = draftCards[i];
  if (!c) return;
  takeCard(W.player, c);
  Sound.play("select");
  resumeAfterDraft();
}

function resumeAfterDraft() {
  W.state = "playing";
  only(null);
  enterRoom();
  if (W.roomIdx === 0) banner(floorDef(W.floor).name, "FLOOR " + numWord(W.floor), 2300);
}

function numWord(n) {
  return ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT"][n] || String(n);
}

function endRun(won) {
  W.state = "over";
  const p = W.player;
  meta.best = Math.max(meta.best, W.floor);
  meta.kills += W.kills;
  meta.cores += W.cores;
  saveMeta(); paintMeta();

  $("overTitle").textContent = won ? "YOU CARRY THE LANTERN OUT" : "THE LANTERN GOES OUT";
  $("oFloor").textContent = W.floor;
  $("oKills").textContent = W.kills;
  $("oTime").textContent = fmtTime(W.runTime);
  $("oCores").textContent = W.cores;
  $("overBuild").innerHTML = buildChips(p);
  only("over");
  Sound.setIntensity(0);
  Sound.play(won ? "levelup" : "death");
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

/* ------------------------------------------------------------------ *
 *  collisions
 * ------------------------------------------------------------------ */
function collide() {
  const p = W.player;

  // player bullets -> enemies
  for (let i = W.bullets.length - 1; i >= 0; i--) {
    const b = W.bullets[i];
    let consumed = false;
    for (const e of W.enemies) {
      if (e.dead || b.hit.has(e)) continue;
      if (dist(b.x, b.y, e.x, e.y) > e.r + b.r) continue;
      b.hit.add(e);
      e.hurt(b.dmg, b.ang, b.soft ? 40 : 190);
      if (b.burn) e.burn = Math.max(e.burn, 1.8);
      FX.spark(b.x, b.y, 5, { dir: b.ang, spread: 1.6, col: b.col, speed: 170, life: 0.25 });
      if (b.pierce > 0) b.pierce--;
      else { consumed = true; break; }
    }
    if (consumed) W.bullets.splice(i, 1);
  }

  // melee arcs -> enemies
  for (const h of W.hazards) {
    if (h.type !== "arc" || h.owner !== "player") continue;
    for (const e of W.enemies) {
      if (e.dead || h.hitSet.has(e)) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d > h.r + e.r) continue;
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      let da = ((a - h.ang + Math.PI) % TAU) - Math.PI;
      if (da < -Math.PI) da += TAU;
      if (Math.abs(da) > h.half) continue;
      h.hitSet.add(e);
      e.hurt(h.dmg, a, h.knock);
      if (h.heavy) { FX.hitstop(0.045); FX.shake(5); }
      FX.spark(e.x, e.y, 8, { dir: a, spread: 1.4, col: "#e8dcc0", speed: 240, life: 0.3 });
    }
  }

  // enemy bullets -> player
  if (p && !p.dead) {
    for (let i = W.ebullets.length - 1; i >= 0; i--) {
      const b = W.ebullets[i];
      if (dist(b.x, b.y, p.x, p.y) > p.r + b.r) continue;
      if (p.iframes > 0) continue;
      hurtPlayer(p, b.dmg, b.ang);
      FX.spark(b.x, b.y, 8, { col: b.col, speed: 180, life: 0.3 });
      W.ebullets.splice(i, 1);
    }
  }

  // pickups
  if (p && !p.dead) {
    for (let i = W.pickups.length - 1; i >= 0; i--) {
      const k = W.pickups[i];
      const d = dist(k.x, k.y, p.x, p.y);
      const magnet = 120 * p.stats.coreMagnet;
      if (d < magnet) {
        const a = Math.atan2(p.y - k.y, p.x - k.x);
        const pull = (1 - d / magnet) * 900;
        k.vx += Math.cos(a) * pull * W.dt;
        k.vy += Math.sin(a) * pull * W.dt;
      }
      if (d < p.r + k.r) {
        if (k.kind === "core") {
          W.cores++;
          FX.text(p.x, p.y - 32, "+1", "#c9a24a");
          Sound.play("core");
        } else {
          healPlayer(p, 18);
          Sound.play("pickup");
        }
        W.pickups.splice(i, 1);
      }
    }
  }

  // enemies push each other apart so they never stack into one blob
  for (let i = 0; i < W.enemies.length; i++) {
    const a = W.enemies[i];
    if (a.dead) continue;
    for (let j = i + 1; j < W.enemies.length; j++) {
      const b = W.enemies[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d < min && d > 0.001) {
        const push = (min - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        if (!a.boss) { a.x -= nx * push; a.y -= ny * push; }
        if (!b.boss) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  HUD
 * ------------------------------------------------------------------ */
function updateHUD() {
  const p = W.player;
  if (!p) return;
  $("hpFill").style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1)})`;
  $("hpText").textContent = Math.ceil(p.hp) + " / " + p.maxHp;
  $("hpFill").parentElement.classList.toggle("critical", p.hp / p.maxHp < 0.34);
  const sh = $("shFill").parentElement;
  if (p.maxShield > 0) {
    sh.style.display = "";
    $("shFill").style.transform = `scaleX(${clamp(p.shield / p.maxShield, 0, 1)})`;
  } else sh.style.display = "none";

  const pips = $("dashPips");
  if (pips.childElementCount !== p.dashMax) {
    pips.innerHTML = "";
    for (let i = 0; i < p.dashMax; i++) {
      const d = document.createElement("div");
      d.className = "pip";
      pips.appendChild(d);
    }
  }
  [...pips.children].forEach((el, i) => el.classList.toggle("on", i < p.dashes));

  $("floorTag").textContent = floorDef(W.floor).name;
  $("roomTag").textContent = W.boss
    ? "THE THING AT THE BOTTOM"
    : "CHAMBER " + roman(W.roomIdx + 1) + " OF " + roman(W.roomsPerFloor);
  $("weaponName").textContent = WEAPONS[p.weapon].name;
  $("coreCount").querySelector("span").textContent = W.cores;

  const bb = $("bossBar");
  if (W.boss && !W.boss.dead) {
    if (bb.classList.contains("hidden")) {
      bb.classList.remove("hidden");
      bb.querySelector(".bossName").textContent = W.boss.bossName;
    }
    const k = clamp(W.boss.hp / W.boss.maxHp, 0, 1);
    bb.querySelector(".bossFill").style.transform = `scaleX(${k})`;
    bb.querySelector(".bossChip").style.transform = `scaleX(${k})`;
  } else if (!bb.classList.contains("hidden")) {
    bb.classList.add("hidden");
  }

  const ct = $("comboTag");
  if (W.combo > 1) { ct.classList.remove("hidden"); ct.textContent = "x" + W.combo; }
  else ct.classList.add("hidden");
}

function roman(n) {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] || String(n);
}

/* ------------------------------------------------------------------ *
 *  loop
 * ------------------------------------------------------------------ */
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 1 / 20);
  W.frame++;

  Sound.tick();

  if (W.state === "playing") {
    if (W.hitstop > 0) { W.hitstop -= dt; dt *= 0.08; }
    W.t += dt; W.dt = dt; W.runTime += dt;

    if (W.comboT > 0) { W.comboT -= dt; if (W.comboT <= 0) W.combo = 1; }

    const p = W.player;

    // mouse -> world before anything reads it
    const c = W.cam;
    Input.wx = (Input.mx - W.view.w / 2 - c.sx) / c.zoom + c.x;
    Input.wy = (Input.my - W.view.h / 2 - c.sy) / c.zoom + c.y;
    W.mouseWorldX = Input.wx; W.mouseWorldY = Input.wy;

    updatePlayer(p, dt);
    for (const e of W.enemies) {
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }
      e.update(dt);
    }
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateHazards(dt);
    collide();

    for (let i = W.pickups.length - 1; i >= 0; i--) {
      const k = W.pickups[i];
      k.age += dt;
      k.x += k.vx * dt; k.y += k.vy * dt;
      k.vx *= Math.exp(-3 * dt); k.vy *= Math.exp(-3 * dt);
      if (k.age > k.life) W.pickups.splice(i, 1);
    }

    // cull dead
    for (let i = W.enemies.length - 1; i >= 0; i--) if (W.enemies[i].dead) W.enemies.splice(i, 1);

    if (!W.cleared && W.enemies.length === 0) clearRoom();

    // walk into the open gate
    if (W.gateOpen) {
      const g = gatePos();
      if (dist(p.x, p.y, g.x, g.y) < 46) advance();
    }

    Sound.setStress(clamp((0.34 - p.hp / p.maxHp) / 0.34, 0, 1));

    if (p.dead) { Sound.setStress(0); endRun(false); }

    FX.update(dt);
    updateCamera(dt);
    updateHUD();

    if (Input.pressed("Escape")) pauseGame();
    if (Input.pressed("KeyM")) Sound.toggleMute();
  } else {
    W.t += dt;
    FX.update(dt * 0.3);
    if (W.state === "pause" && Input.pressed("Escape")) resumeGame();
  }

  render(ctx, W.view);
  Shader.present(W.t, dt);
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ------------------------------------------------------------------ *
 *  pause
 * ------------------------------------------------------------------ */
function pauseGame() {
  if (W.state !== "playing") return;
  W.state = "pause";
  $("buildList").innerHTML = buildChips(W.player);
  $("statSheet").innerHTML = statSheet(W.player);
  only("pause");
  Sound.setIntensity(0.05);
}
function resumeGame() {
  if (W.state !== "pause") return;
  W.state = "playing";
  only(null);
  Sound.setIntensity(0.5);
}

/* ------------------------------------------------------------------ *
 *  buttons
 * ------------------------------------------------------------------ */
$("btnPlay").onclick = startRun;
$("btnHow").onclick = () => { $("howto").classList.toggle("hidden"); Sound.init(); Sound.play("ui"); };
$("btnWipe").onclick = () => {
  meta = { best: 0, kills: 0, cores: 0, runs: 0 };
  saveMeta(); paintMeta();
  Sound.play("deny");
};
$("btnResume").onclick = resumeGame;

/* mixer sliders — live, persisted to localStorage */
for (const [id, bus] of [["volMaster", "master"], ["volMusic", "music"], ["volSfx", "sfx"]]) {
  const el = $(id);
  el.value = Math.round(Sound.getVolume(bus) * 100);
  el.oninput = () => {
    Sound.setVolume(bus, el.value / 100);
    try {
      localStorage.setItem("emberhollow.mix", JSON.stringify({
        master: Sound.getVolume("master"),
        music: Sound.getVolume("music"),
        sfx: Sound.getVolume("sfx"),
      }));
    } catch (e) { /* storage blocked, mix is session-only */ }
  };
}
$("btnQuit").onclick = () => { W.state = "menu"; only("title"); Sound.setIntensity(0); };
$("btnAgain").onclick = startRun;
$("btnMenu").onclick = () => { W.state = "menu"; only("title"); };
$("btnSkip").onclick = () => { healPlayer(W.player, 15); Sound.play("pickup"); resumeAfterDraft(); };
$("btnReroll").onclick = () => {
  if (W.cores < rerollCost) { Sound.play("deny"); return; }
  W.cores -= rerollCost;
  rerollCost += 3;
  $("rerollCost").textContent = rerollCost;
  draftCards = rollDraft(W.rng, W.player, 3);
  $("cards").innerHTML = draftCards.map(cardHTML).join("");
  [...$("cards").children].forEach((el, i) => el.addEventListener("click", () => pickCard(i)));
  Sound.play("core");
};

/* keyboard shortcuts on the draft — 1/2/3 take, R rerolls, Space skips,
   so a run never forces your hand off the movement keys */
addEventListener("keydown", (e) => {
  if (W.state !== "draft") return;
  if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
    e.preventDefault();
    pickCard(+e.code.slice(5) - 1);
  } else if (e.code === "KeyR") {
    e.preventDefault();
    $("btnReroll").click();
  } else if (e.code === "Space") {
    e.preventDefault();
    $("btnSkip").click();
  }
});

addEventListener("pointerdown", () => { Sound.init(); Sound.resume(); }, { once: true });
