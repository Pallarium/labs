/* Relic pool + the between-chamber draft. Stat deltas live in player.js
   (RELIC_EFFECTS) so this file only owns presentation and choosing. */

import { W } from "./world.js";
import { recomputeStats, baseStats } from "./player.js";
import { WEAPONS } from "./weapons.js";

const C = {
  common: "#9c8e77",
  rare: "#6e8352",
  grim: "#a8402c",
  gilded: "#c9a24a",
};

/* Icons are inline SVG line-art so they sit in the same ink-and-parchment
   world as everything else. They inherit the card's accent via currentColor. */
const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
    stroke-linecap="round" stroke-linejoin="round" width="34" height="34">${body}</svg>`;

const ICO = {
  whetstone:  svg('<path d="M3 16l6-10 12 4-7 8z"/><path d="M9 6l3 10"/>'),
  quickhand:  svg('<path d="M7 13V5a1.5 1.5 0 013 0v6"/><path d="M10 11V4a1.5 1.5 0 013 0v7"/><path d="M13 11V6a1.5 1.5 0 013 0v7"/><path d="M16 11a1.5 1.5 0 013 0v5a5 5 0 01-5 5h-2a5 5 0 01-5-5v-3"/>'),
  longarm:    svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M8 8l2 2M11 5l2 2M5 11l2 2"/>'),
  boots:      svg('<path d="M7 3v9l-2 4v5h14v-3a5 5 0 00-4-4.9L13 12V3z"/><path d="M5 18h14"/>'),
  mossblood:  svg('<path d="M12 21c0-6 3-10 8-11-1 6-4 9-8 11z"/><path d="M12 21c0-5-2-8-6-9 .5 5 2.5 7.5 6 9z"/><path d="M12 21v-6"/>'),
  ironblood:  svg('<path d="M12 3s6 6.5 6 10.5a6 6 0 01-12 0C6 9.5 12 3 12 3z"/><path d="M9.5 14a2.5 2.5 0 002.5 2.5"/>'),
  secondwind: svg('<path d="M3 8h11a3 3 0 10-3-3"/><path d="M3 13h14a3 3 0 11-3 3"/><path d="M3 18h8"/>'),
  ghoststep:  svg('<path d="M8 5c2 0 3 1.6 3 3.5S9.5 13 8 13s-3-1.6-3-3.5S6 5 8 5z"/><path d="M16 11c1.7 0 2.6 1.4 2.6 3s-1.2 4-2.6 4-2.6-1.4-2.6-3 .9-4 2.6-4z"/>'),
  leech:      svg('<path d="M6 18c0-3 2-4 4-4s4-1 4-4 2-4 4-4"/><path d="M6 18a2 2 0 11-3 1"/><circle cx="18" cy="6" r="2"/>'),
  keeneye:    svg('<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  butcher:    svg('<path d="M4 6h11l5 5-5 3H4z"/><path d="M4 14v6"/><path d="M9 6V3"/>'),
  brambles:   svg('<path d="M4 20C8 16 10 12 10 6"/><path d="M10 12l5-3M10 16l6-2M10 8l4-4"/><path d="M20 20c-3-2-5-5-6-9"/>'),
  emberheart: svg('<path d="M12 21c4 0 7-2.7 7-6.5 0-4.5-4-6-4-10-2.5 1.5-3 4-3 5.5C11 8 9.5 7 9 5.5 7 8 5 10.5 5 14.5 5 18.3 8 21 12 21z"/>'),
  fatspoon:   svg('<ellipse cx="12" cy="7" rx="4.5" ry="5"/><path d="M12 12v9"/>'),
  ward:       svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  splitshot:  svg('<path d="M4 12h6"/><path d="M10 12l9-6M10 12l9 6"/><path d="M19 6l-3 .5M19 6l.5 3M19 18l-3-.5M19 18l.5-3"/>'),
  boreworm:   svg('<path d="M3 12h18"/><circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/>'),
  greedring:  svg('<circle cx="12" cy="14" r="6"/><path d="M12 8l-3-4h6z"/>'),
  oilcloth:   svg('<path d="M7 4h10l-1 5H8z"/><path d="M8 9h8l1 9a3 3 0 01-3 3h-4a3 3 0 01-3-3z"/><path d="M11 14h2"/>'),
  duelist:    svg('<path d="M4 4l11 11M20 4L9 15"/><path d="M4 4v4M20 4v4"/><path d="M6 20l3-3M18 20l-3-3"/>'),
  cleaver:    svg('<path d="M3 7h12l6 5-6 4H3z"/><path d="M3 16v5"/>'),
  bow:        svg('<path d="M6 3a13 13 0 010 18"/><path d="M6 3l14 9-14 9"/><path d="M13 12h8"/>'),
  censer:     svg('<path d="M12 2v5"/><path d="M7 7h10l-1.5 4h-7z"/><path d="M8 11h8l-1 8a3 3 0 01-6 0z"/>'),
  knives:     svg('<path d="M3 17L14 6l3 3L6 20z"/><path d="M17 4l3 3"/><path d="M6 20l-3 1 1-3"/>'),
  maul:       svg('<path d="M3 21L14 10"/><path d="M13 5h8v7h-8z"/><path d="M13 8.5H9"/>'),
};

export const RELICS = [
  { id: "whetstone",  name: "Whetstone",      ico: ICO.whetstone,  rar: "COMMON", c: C.common, text: "The edge bites deeper. All damage up sixteen in the hundred." },
  { id: "quickhand",  name: "Quick Hand",     ico: ICO.quickhand,  rar: "COMMON", c: C.common, text: "You strike before the thought finishes. Attacks come faster." },
  { id: "longarm",    name: "Long Arm",       ico: ICO.longarm,    rar: "COMMON", c: C.common, text: "Reach grows by a hand's width and then some." },
  { id: "boots",      name: "Tanner's Boots", ico: ICO.boots,      rar: "COMMON", c: C.common, text: "Worn soft by a dead man. You move quicker." },
  { id: "mossblood",  name: "Mossblood",      ico: ICO.mossblood,  rar: "COMMON", c: C.common, text: "Green creeps through the wound. Health returns slowly." },
  { id: "ironblood",  name: "Ironblood",      ico: ICO.ironblood,  rar: "RARE",   c: C.rare,   text: "Twenty-two more life, and the weight to carry it." },
  { id: "secondwind", name: "Second Wind",    ico: ICO.secondwind, rar: "RARE",   c: C.rare,   text: "One more roll before the lungs give out." },
  { id: "ghoststep",  name: "Ghost Step",     ico: ICO.ghoststep,  rar: "RARE",   c: C.rare,   text: "The roll carries further and keeps you unreal longer." },
  { id: "leech",      name: "Leechbite",      ico: ICO.leech,      rar: "RARE",   c: C.rare,   text: "Every wound you open feeds you a little." },
  { id: "keeneye",    name: "Keen Eye",       ico: ICO.keeneye,    rar: "RARE",   c: C.rare,   text: "You find the seam. Ten more in the hundred to strike true." },
  { id: "butcher",    name: "Butcher's Lot",  ico: ICO.butcher,    rar: "GRIM",   c: C.grim,   text: "When it lands true, it lands far worse." },
  { id: "brambles",   name: "Brambles",       ico: ICO.brambles,   rar: "GRIM",   c: C.grim,   text: "They cut themselves on you. Touch you and bleed." },
  { id: "emberheart", name: "Emberheart",     ico: ICO.emberheart, rar: "GRIM",   c: C.grim,   text: "What you strike smoulders long after." },
  { id: "fatspoon",   name: "Fat Spoon",      ico: ICO.fatspoon,   rar: "GRIM",   c: C.grim,   text: "Every kill is two mouthfuls of life." },
  { id: "ward",       name: "Chalk Ward",     ico: ICO.ward,       rar: "GRIM",   c: C.grim,   text: "A drawn circle takes the first five-and-twenty blows' worth." },
  { id: "splitshot",  name: "Forked Tongue",  ico: ICO.splitshot,  rar: "GILDED", c: C.gilded, text: "One more shot from every loosing. Each bites a touch softer." },
  { id: "boreworm",   name: "Boreworm",       ico: ICO.boreworm,   rar: "GILDED", c: C.gilded, text: "Your shots pass clean through one more body." },
  { id: "greedring",  name: "Greed Ring",     ico: ICO.greedring,  rar: "GILDED", c: C.gilded, text: "Embers drift to you, and fortune leans your way." },
  { id: "oilcloth",   name: "Oilcloth",       ico: ICO.oilcloth,   rar: "GILDED", c: C.gilded, text: "The lantern flare burns half again as wide." },
  { id: "duelist",    name: "Duelist's Vow",  ico: ICO.duelist,    rar: "GILDED", c: C.gilded, text: "You no longer root when you swing. And you hit harder." },
];

/* weapons can also show up in a draft */
const WEAPON_CARDS = [
  { id: "w_cleaver", weapon: "cleaver", ico: ICO.cleaver, rar: "ARMS", c: "#d8ccae", text: "Slow, wide, and it takes the whole arm off." },
  { id: "w_bow",     weapon: "bow",     ico: ICO.bow,     rar: "ARMS", c: "#d8ccae", text: "Quiet work at distance. Steady rhythm." },
  { id: "w_censer",  weapon: "censer",  ico: ICO.censer,  rar: "ARMS", c: "#d8ccae", text: "A stream of burning ash. Close, constant, cruel." },
  { id: "w_knives",  weapon: "knives",  ico: ICO.knives,  rar: "ARMS", c: "#d8ccae", text: "Thrown fast and often. They land light but they land." },
  { id: "w_maul",    weapon: "maul",    ico: ICO.maul,    rar: "ARMS", c: "#d8ccae", text: "One swing. Everything in front of it leaves the ground." },
];

export function rollDraft(rng, p, count) {
  const pool = [];
  for (const r of RELICS) {
    const stacks = p.relics[r.id] || 0;
    const w = r.rar === "COMMON" ? 10 : r.rar === "RARE" ? 6 : r.rar === "GRIM" ? 4 : 2.5;
    pool.push({ ...r, w: w * Math.pow(0.55, stacks) * (1 + p.stats.luck) });
  }
  for (const wc of WEAPON_CARDS) {
    if (wc.weapon === p.weapon) continue;
    pool.push({ ...wc, name: WEAPONS[wc.weapon].name, w: 3.4 });
  }
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const pick = rng.weighted(pool);
    if (used.has(pick.id)) continue;
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}

export function takeCard(p, card) {
  if (card.weapon) {
    p.weapon = card.weapon;
  } else {
    p.relics[card.id] = (p.relics[card.id] || 0) + 1;
    recomputeStats(p);
  }
}

export function buildChips(p) {
  const out = [];
  out.push(`<span class="chip">ARMS <b>${WEAPONS[p.weapon].name}</b></span>`);
  for (const id in p.relics) {
    const r = RELICS.find((x) => x.id === id);
    if (!r) continue;
    out.push(`<span class="chip">${r.name.toUpperCase()} <b>x${p.relics[id]}</b></span>`);
  }
  if (out.length === 1) out.push('<span class="chip">NOTHING BUT THE LANTERN</span>');
  return out.join("");
}

/** The derived numbers a player actually wants to see while resting. */
export function statSheet(p) {
  const s = p.stats, b = baseStats();
  const rows = [
    ["DAMAGE", Math.round(s.dmg * 100) + "%", s.dmg / b.dmg],
    ["ATK SPEED", Math.round((1 / s.rate) * 100) + "%", b.rate / s.rate],
    ["REACH", Math.round(s.reach * 100) + "%", s.reach / b.reach],
    ["MOVE", Math.round(s.speed), s.speed / b.speed],
    ["MULTISHOT", s.multishot, null],
    ["PIERCE", s.pierce, null],
    ["CRIT", Math.round(s.crit * 100) + "%", null],
    ["CRIT MULT", s.critMult.toFixed(1) + "x", null],
    ["LIFESTEAL", Math.round(s.lifesteal * 100) + "%", null],
    ["DASHES", p.dashMax, null],
  ];
  return rows.map(([label, val, ratio]) => {
    let tag = "";
    if (ratio != null && Math.abs(ratio - 1) > 0.015) {
      const pct = Math.round((ratio - 1) * 100);
      tag = `<i class="${pct > 0 ? "up" : "down"}">${pct > 0 ? "+" : ""}${pct}%</i>`;
    }
    return `<div class="statRow"><span>${label}</span><b>${val}</b>${tag}</div>`;
  }).join("");
}

export function cardHTML(card) {
  const stacks = W.player && !card.weapon ? (W.player.relics[card.id] || 0) : 0;
  return `
    <div class="card" data-id="${card.id}" style="--c:${card.c};--glow:${hexA(card.c, 0.18)}">
      ${stacks ? `<div class="stack">HELD x${stacks}</div>` : ""}
      <div class="key"></div>
      <div class="ico">${card.ico}</div>
      <div class="rar">${card.rar}</div>
      <h4>${card.name}</h4>
      <p>${card.text}</p>
    </div>`;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
