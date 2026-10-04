# EMBERHOLLOW

A hand-inked dungeon crawler. One lantern, one blade, eight chambers a floor,
five floors down. Everything is drawn at runtime — no image assets, no build
step, no npm. Open `index.html` and hit **DESCEND**.

---

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | move |
| mouse | aim |
| hold `LMB` | strike / fire |
| `SPACE` | roll (brief invulnerability) |
| `RMB` or `Q` | lantern flare |
| `ESC` | rest (pause) |
| `M` | silence |

---

## What's in it

**Five floors, five bosses.** The Undercroft, the Flooded Cistern, the Ossuary,
the Forge of Ash, the Hollow. Each ends with something old: the Warden, the
Drowned Choir, the Grave Bride, the Hollow King. Bosses rotate a telegraphed
attack set — sweep, slam, dash, and a fourth that only unlocks past half health
— and call in adds on a timer.

**Eight enemy archetypes.** Husks shamble, crawlers weave, bone archers kite and
loose, brutes wind up a charge you can see coming, ash priests throw homing
bolts, bile spitters lob, wraiths blink to you, shieldbearers eat 85% of any
damage that hits their front.

**Elites.** From the third chamber onward one enemy can wear a curse: *Gilded*
(tanky, drips embers), *Scorched* (burns everything near it), *Vengeful* (fires
a volley on a timer), *Swift* (much faster). Gold crown, name tag, one extra
rule to respect.

**Twenty relics and five weapons** in the draft between chambers. Relics stack.
Take a Whetstone three times and every hit is meaningfully harder. Skip the
draft and mend 15 instead, or spend embers to dig for a better hand.

**Real lighting.** The room is dark. Your lantern punches a hole in it, braziers
punch smaller ones, and burning enemies light themselves. All of it composites
through a single multiply pass.

**WebGL post-processing** (`js/shader.js`) sits on top of the 2D canvas:
threshold bloom around firelight, heat shimmer, subtle barrel distortion,
chromatic aberration that spikes when you take a hit, filmic tonemapping, and
animated parchment grain. If WebGL is missing or the context is lost, the raw
canvas is shown and the game keeps running.

**Synthesized audio** — no files. A low stone-hall drone, a frame-drum
heartbeat, and a plucked modal figure that opens up as a room gets dangerous.
Swings are noise through a bandpass, kills are bone and gristle.

---

## Layout

```
index.html        shell + HUD + screens
css/style.css     the inked look: candle, rust, bone, parchment
js/main.js        loop, run flow, collisions, HUD
js/world.js       shared run state (the star at the centre of the module graph)
js/rng.js         seedable mulberry32
js/input.js       keyboard + mouse, held vs one-frame-pressed
js/rooms.js       chamber generation, baked floors, collision helpers
js/player.js      movement, roll, flare, stat block, relic effects
js/enemies.js     archetypes, elites, bosses, wave composition
js/weapons.js     weapons + every projectile
js/relics.js      the relic pool and the draft
js/fx.js          particles, decals, damage numbers, shake, hitstop
js/render.js      draw order, camera, lighting pass
js/shader.js      WebGL post-process
js/audio.js       synthesized music and sfx
```

State is a single mutable `W` object every system imports, so the module graph
is a star and not a knot.

---

## Notes

Progress is saved to `localStorage` under `emberhollow.meta.v1` — deepest floor,
total slain, embers, delves. **BURN THE LEDGER** on the title screen wipes it.
