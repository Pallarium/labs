/* Deterministic, seedable PRNG (mulberry32). Runs are reproducible from a seed,
   which makes bug repro and daily-seed modes possible later. */

export function makeRNG(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    angle: () => next() * Math.PI * 2,
    /** weighted pick: items are {w:number,...} */
    weighted(arr) {
      let total = 0;
      for (const it of arr) total += it.w || 0;
      let r = next() * total;
      for (const it of arr) { r -= it.w || 0; if (r <= 0) return it; }
      return arr[arr.length - 1];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
  };
}
