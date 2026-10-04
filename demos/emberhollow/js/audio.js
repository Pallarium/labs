/* EMBERHOLLOW audio — all synthesized, no files.
   The bed is a low drone + hand drum + a plucked modal string figure, so it
   reads as a dank stone hall rather than a synth track. Intensity opens up the
   drum and adds a dissonant upper voice when the room gets dangerous. */

let ctx = null, master = null, musicGain = null, sfxGain = null, comp = null, verb = null;

// mix: BASE is the design-time level, vol is the player's 0..1 slider on top of it
const BASE = { master: 0.85, music: 0.3, sfx: 0.62 };
const vol = { master: 1, music: 1, sfx: 1 };
try {
  const saved = JSON.parse(localStorage.getItem("emberhollow.mix") || "null");
  if (saved) Object.assign(vol, saved);
} catch (e) { /* first run, defaults stand */ }
let started = false, muted = false;
let intensity = 0, targetIntensity = 0;
let step = 0, nextStepAt = 0;
let stress = 0, nextBeatAt = 0;
const BPM = 84;

/* Dorian-ish minor for a medieval colour */
const SCALE = [0, 2, 3, 5, 7, 9, 10];
const ROOT = 73.4;                       // D2

function now() { return ctx ? ctx.currentTime : 0; }
function note(deg, oct = 0) {
  const s = SCALE[((deg % SCALE.length) + SCALE.length) % SCALE.length];
  return ROOT * Math.pow(2, (s + oct * 12) / 12);
}

export const Sound = {
  get ready() { return started; },
  get muted() { return muted; },

  init() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 26; comp.ratio.value = 6;
    comp.attack.value = 0.004; comp.release.value = 0.25;

    master = ctx.createGain(); master.gain.value = BASE.master * vol.master;
    musicGain = ctx.createGain(); musicGain.gain.value = BASE.music * vol.music;
    sfxGain = ctx.createGain(); sfxGain.gain.value = BASE.sfx * vol.sfx;

    // cheap convolution-free "stone hall": feedback delay tuned dark
    verb = ctx.createGain(); verb.gain.value = 0.26;
    const d1 = ctx.createDelay(1.0); d1.delayTime.value = 0.11;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const damp = ctx.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 2200;
    verb.connect(d1); d1.connect(damp); damp.connect(fb); fb.connect(d1); damp.connect(comp);

    musicGain.connect(comp); sfxGain.connect(comp);
    sfxGain.connect(verb); musicGain.connect(verb);
    comp.connect(master); master.connect(ctx.destination);

    started = true;
    nextStepAt = now() + 0.12;
    drone();
  },

  resume() { if (ctx && ctx.state === "suspended") ctx.resume(); },

  toggleMute() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : BASE.master * vol.master, now(), 0.05);
    return muted;
  },

  setIntensity(v) { targetIntensity = Math.max(0, Math.min(1, v)); },

  /** 0..1 — how close to death. Drives a double-thump heartbeat under the bed. */
  setStress(v) { stress = Math.max(0, Math.min(1, v)); },

  /** Set a mix channel 0..1. bus is "master" | "music" | "sfx". */
  setVolume(bus, v) {
    v = Math.max(0, Math.min(1, v));
    vol[bus] = v;
    const node = bus === "music" ? musicGain : bus === "sfx" ? sfxGain : master;
    if (node) node.gain.setTargetAtTime(bus === "master" && muted ? 0 : v * BASE[bus], now(), 0.04);
  },

  getVolume(bus) { return vol[bus]; },

  /* ------------------------------------------------------------------ *
   *  SFX — all physical/earthy, nothing laser-ish
   * ------------------------------------------------------------------ */
  play(name, opt) {
    if (!started || muted) return;
    const o = opt || {};
    switch (name) {
      case "swing":   return noiseHit(0.13, 0.22, 3400, 0.7, "bandpass");   // blade through air
      case "cleave":  return noiseHit(0.22, 0.3, 1800, 0.9, "bandpass");
      case "bow":     return sweep(700, 220, 0.12, "triangle", 0.16);
      case "throw":   return noiseHit(0.1, 0.16, 2600, 0.8, "bandpass");
      case "flame":   return flameBurst(0.34, 0.26);
      case "hammer":  return thud(0.28, 0.4, 90);
      case "hit":     return thud(0.09, 0.22, 190 + Math.random() * 60);
      case "flesh":   return noiseHit(0.16, 0.26, 700, 1.1, "lowpass");
      case "kill":    return crunch(0.3, 0.34);
      case "explode": return crunch(0.7, 0.46);
      case "hurt":    return sweep(300, 70, 0.32, "sawtooth", 0.32);
      case "roll":    return noiseHit(0.24, 0.17, 900, 0.5, "lowpass");
      case "pickup":  return pluck(note(4, 3), 0.3, 0.14);
      case "core":    return pluck(note(6, 3), 0.26, 0.12);
      case "ui":      return pluck(note(0, 2), 0.16, 0.09);
      case "select":  return arp([note(0, 2), note(2, 2), note(4, 3)], 0.07, 0.13);
      case "gate":    return stoneDoor();
      case "bossIn":  return bossHorn();
      case "bossDie": return sweep(420, 36, 2.0, "sawtooth", 0.32);
      case "levelup": return arp([note(0, 2), note(3, 2), note(4, 3), note(6, 3)], 0.1, 0.13);
      case "deny":    return thud(0.14, 0.2, 70);
      case "death":   return deathToll();
      case "block":   return blip(1600, 0.07, "square", 0.14, -900);
    }
  },

  tick() {
    if (!started || muted) return;
    intensity += (targetIntensity - intensity) * 0.02;
    const t = now();
    const spb = 60 / (BPM + intensity * 18) / 2;
    while (nextStepAt < t + 0.13) {
      seq(nextStepAt, step, intensity);
      step = (step + 1) % 32;
      nextStepAt += spb;
    }

    // heartbeat under everything when you're nearly gone — lub-dub, faster as it worsens
    if (stress > 0.02) {
      const period = 1.05 - stress * 0.45;
      if (nextBeatAt < t) nextBeatAt = t + 0.05;
      while (nextBeatAt < t + 0.13) {
        heartbeat(nextBeatAt, 0.18 + stress * 0.3);
        nextBeatAt += period;
      }
    } else {
      nextBeatAt = 0;
    }
  },
};

/* ------------------------------------------------------------------ *
 *  voices
 * ------------------------------------------------------------------ */
let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s;
}

function blip(freq, dur, type, gain, glide) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, now());
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + glide), now() + dur);
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  o.connect(g); g.connect(sfxGain); o.start(); o.stop(now() + dur + 0.02);
}
function sweep(f0, f1, dur, type, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, now());
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now() + dur);
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  o.connect(g); g.connect(sfxGain); o.start(); o.stop(now() + dur + 0.02);
}
function noiseHit(dur, gain, cutoff, q, type) {
  const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = type || "lowpass";
  f.frequency.setValueAtTime(cutoff, now());
  f.frequency.exponentialRampToValueAtTime(Math.max(90, cutoff * 0.2), now() + dur);
  f.Q.value = q;
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(); s.stop(now() + dur + 0.02);
}
/** dull low impact — stone, boot, club */
function thud(dur, gain, f0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, now());
  o.frequency.exponentialRampToValueAtTime(Math.max(28, f0 * 0.35), now() + dur);
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  o.connect(g); g.connect(sfxGain); o.start(); o.stop(now() + dur + 0.02);
  noiseHit(dur * 0.5, gain * 0.5, 800, 0.6, "lowpass");
}
/** bone-and-gristle break for a kill */
function crunch(dur, gain) {
  noiseHit(dur, gain, 1400, 1.4, "lowpass");
  thud(dur * 0.8, gain * 0.7, 120);
}
function flameBurst(dur, gain) {
  const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = "bandpass"; f.Q.value = 0.9;
  f.frequency.setValueAtTime(420, now());
  f.frequency.exponentialRampToValueAtTime(2400, now() + dur * 0.4);
  f.frequency.exponentialRampToValueAtTime(300, now() + dur);
  g.gain.setValueAtTime(0, now());
  g.gain.linearRampToValueAtTime(gain, now() + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(); s.stop(now() + dur + 0.03);
}
/** plucked string: fast attack, filtered decay */
function pluck(f, dur, gain) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator();
  const flt = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = "triangle"; o.frequency.value = f;
  o2.type = "sawtooth"; o2.frequency.value = f * 2.01; o2.detune.value = 6;
  flt.type = "lowpass";
  flt.frequency.setValueAtTime(f * 9, now());
  flt.frequency.exponentialRampToValueAtTime(f * 1.6, now() + dur);
  g.gain.setValueAtTime(0, now());
  g.gain.linearRampToValueAtTime(gain, now() + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  o.connect(flt); o2.connect(flt); flt.connect(g); g.connect(sfxGain);
  o.start(); o2.start(); o.stop(now() + dur + 0.03); o2.stop(now() + dur + 0.03);
}
function arp(freqs, gapS, gain) {
  freqs.forEach((f, i) => setTimeout(() => { if (started && !muted) pluck(f, 0.4, gain); }, i * gapS * 1000));
}
function stoneDoor() {
  noiseHit(0.9, 0.3, 380, 0.7, "lowpass");
  thud(0.6, 0.34, 64);
}
function bossHorn() {
  [note(0, 0), note(0, 1), note(4, 0)].forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = i === 2 ? "sawtooth" : "square";
    o.frequency.setValueAtTime(f * 0.97, now());
    o.frequency.linearRampToValueAtTime(f, now() + 0.4);
    g.gain.setValueAtTime(0, now());
    g.gain.linearRampToValueAtTime(0.14 / (i + 1), now() + 0.25);
    g.gain.linearRampToValueAtTime(0.0001, now() + 1.9);
    o.connect(g); g.connect(sfxGain); o.start(); o.stop(now() + 2);
  });
}
function deathToll() {
  [0, 0.75, 1.7].forEach((d, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = now() + d;
    o.type = "sine"; o.frequency.value = 110 * (i === 2 ? 0.5 : 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 2.3);
  });
}

/* ------------------------------------------------------------------ *
 *  music bed
 * ------------------------------------------------------------------ */
let droneNodes = null;
function drone() {
  if (droneNodes) return;
  droneNodes = [];
  [[ROOT / 2, 0.1, "sine"], [ROOT / 2 * 1.5, 0.045, "triangle"], [ROOT, 0.035, "sawtooth"]]
    .forEach(([f, g, type], i) => {
      const o = ctx.createOscillator(), gn = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = type; o.frequency.value = f; o.detune.value = i * 5;
      gn.gain.value = 0;
      gn.gain.setTargetAtTime(g, now(), 3);
      lfo.frequency.value = 0.07 + i * 0.03; lg.gain.value = g * 0.4;
      lfo.connect(lg); lg.connect(gn.gain);
      o.connect(gn); gn.connect(musicGain);
      o.start(); lfo.start();
      droneNodes.push(o, lfo);
    });
}

function seq(t, s, inten) {
  const bar = s % 16;
  // low frame drum — heartbeat pulse
  if (bar === 0 || bar === 6 || bar === 10) frameDrum(t, 0.38 + inten * 0.2);
  // answering slap
  if (inten > 0.2 && (bar === 4 || bar === 12)) slap(t, 0.16 + inten * 0.16);
  // shaker only once things heat up
  if (inten > 0.45 && bar % 2 === 1) shaker(t, 0.05 + inten * 0.07);
  // plucked modal figure
  if (bar % 4 === 2) {
    const deg = [0, 3, 4, 2, 5, 1][Math.floor(s / 4) % 6];
    seqPluck(t, note(deg, 2), 0.09 + inten * 0.04);
  }
  // dissonant upper drone when the room is hot
  if (inten > 0.6 && bar === 8) bowed(t, note(1, 3), 1.6, 0.05);
}
function frameDrum(t, g) {
  const o = ctx.createOscillator(), gn = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(96, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.18);
  gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  o.connect(gn); gn.connect(musicGain); o.start(t); o.stop(t + 0.36);

  const s = noise(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
  f.type = "lowpass"; f.frequency.value = 900;
  ng.gain.setValueAtTime(g * 0.4, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  s.connect(f); f.connect(ng); ng.connect(musicGain); s.start(t); s.stop(t + 0.12);
}
/** two soft chest thumps, lub then dub */
function heartbeat(t, g) {
  [[0, g], [0.17, g * 0.72]].forEach(([off, gain]) => {
    const o = ctx.createOscillator(), gn = ctx.createGain();
    const at = t + off;
    o.type = "sine";
    o.frequency.setValueAtTime(64, at);
    o.frequency.exponentialRampToValueAtTime(34, at + 0.14);
    gn.gain.setValueAtTime(0, at);
    gn.gain.linearRampToValueAtTime(gain, at + 0.012);
    gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    o.connect(gn); gn.connect(musicGain);
    o.start(at); o.stop(at + 0.24);
  });
}

function slap(t, g) {
  const s = noise(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
  f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 1.1;
  gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  s.connect(f); f.connect(gn); gn.connect(musicGain); s.start(t); s.stop(t + 0.14);
}
function shaker(t, g) {
  const s = noise(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
  f.type = "highpass"; f.frequency.value = 5200;
  gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  s.connect(f); f.connect(gn); gn.connect(musicGain); s.start(t); s.stop(t + 0.08);
}
function seqPluck(t, f, g) {
  const o = ctx.createOscillator(), flt = ctx.createBiquadFilter(), gn = ctx.createGain();
  o.type = "triangle"; o.frequency.value = f;
  flt.type = "lowpass";
  flt.frequency.setValueAtTime(f * 8, t);
  flt.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.6);
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(g, t + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  o.connect(flt); flt.connect(gn); gn.connect(musicGain); o.start(t); o.stop(t + 0.72);
}
function bowed(t, f, dur, g) {
  const o = ctx.createOscillator(), gn = ctx.createGain();
  o.type = "sawtooth"; o.frequency.value = f; o.detune.value = 8;
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(g, t + 0.5);
  gn.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(gn); gn.connect(musicGain); o.start(t); o.stop(t + dur + 0.05);
}
