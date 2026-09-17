"use strict";

/* KALEIDO // SDF — beat-reactive raymarched kaleidoscopic tunnel.
   Single fragment shader, sphere-traced SDFs, in-shader noise, no textures. */

const canvas = document.getElementById("gl");
const errBox = document.getElementById("err");
const meterFill = document.getElementById("meterFill");
const micBtn = document.getElementById("micBtn");
const bpmSlider = document.getElementById("bpm");
const bpmVal = document.getElementById("bpmVal");

const gl = canvas.getContext("webgl2", { antialias: false, powerPreference: "high-performance" });
if (!gl) { fail("WebGL2 is not available in this browser."); }

function fail(msg) {
  errBox.style.display = "block";
  errBox.textContent = msg;
  throw new Error(msg);
}

/* ---------- fragment shader (single shader, < 300 lines) ---------- */
const FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;   // 0..1 pulse envelope
uniform float uLevel;  // 0..1 smoothed loudness (mic or synthetic)

out vec4 fragColor;

const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

/* ---- hash / value noise / fbm (all in-shader, no textures) ---- */
float hash31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0,0,0));
  float n100 = hash31(i + vec3(1,0,0));
  float n010 = hash31(i + vec3(0,1,0));
  float n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1));
  float n101 = hash31(i + vec3(1,0,1));
  float n011 = hash31(i + vec3(0,1,1));
  float n111 = hash31(i + vec3(1,1,1));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){
    s += a * vnoise(p);
    p = p * 2.02 + vec3(11.3, 7.1, 3.7);
    a *= 0.5;
  }
  return s;
}

/* ---- rotation ---- */
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

/* ---- kaleidoscope fold on the tube cross-section ---- */
vec2 kaleido(vec2 p, float seg){
  float a = atan(p.y, p.x);
  float r = length(p);
  float span = TAU / seg;
  a = mod(a, span);
  a = abs(a - span * 0.5);   // mirror each wedge
  return vec2(cos(a), sin(a)) * r;
}

/* ---- signed distance to the tunnel wall (negative outside/beyond wall,
        positive inside the tube) ---- */
float map(vec3 p){
  // gentle serpentine drift of the tube centre
  p.xy += vec2(sin(p.z * 0.28) * 0.9, cos(p.z * 0.22) * 0.9);

  // rotate cross-section along the length for a twisting corridor
  p.xy *= rot(p.z * 0.16 + uTime * 0.15);

  vec2 kp = kaleido(p.xy, 8.0);
  float r = length(kp);
  float a = atan(kp.y, kp.x);

  // base radius, breathing with the beat
  float rad = 2.35 + 0.45 * uBeat;

  // fluted wall ripples around the wedge + travelling ridges down z
  rad += 0.22 * sin(a * 12.0 + p.z * 1.4 - uTime * 2.0);
  rad += 0.14 * sin(p.z * 3.0 - uTime * 3.0);

  // in-shader noise crust on the walls, kicked outward on strong beats
  float crust = fbm(vec3(kp * 1.8, p.z * 0.9 - uTime * 0.6));
  rad += (0.30 + 0.55 * uLevel) * crust;

  // distance to the tube wall from inside (radial SDF for a warped cylinder)
  return rad - r;
}

vec3 palette(float t){
  // analogous warm→magenta scheme built from the site palette
  vec3 amber = vec3(0.831, 0.616, 0.427);  // #d49d6d
  vec3 rose  = vec3(0.816, 0.384, 0.612);  // #d0629c
  vec3 gold  = vec3(0.961, 0.745, 0.239);  // #f5be3d
  vec3 c = mix(amber, rose, 0.5 + 0.5 * sin(t));
  c = mix(c, gold, 0.5 + 0.5 * sin(t * 0.5 + 1.7));
  return c;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // camera flies forward; zoom out slightly with loudness (fast = wider view)
  float fov = 1.0 + 0.35 * uLevel;
  vec3 ro = vec3(0.0, 0.0, uTime * 3.2);
  vec3 rd = normalize(vec3(uv * fov, 1.0));
  // slow bank/roll of the whole camera
  rd.xy *= rot(sin(uTime * 0.2) * 0.35);

  float t = 0.0;
  float glow = 0.0;
  float hit = -1.0;
  vec3 pos = ro;

  // sphere trace toward the wall while banking glow off wall proximity
  for (int i = 0; i < 96; i++){
    pos = ro + rd * t;
    float d = map(pos);          // + inside the tube, 0 at wall
    glow += 0.0045 / (0.05 + abs(d)); // demoscene proximity glow
    if (d < 0.002){ hit = t; break; }
    t += max(abs(d) * 0.6, 0.01);
    if (t > 42.0) break;
  }

  // colour driven by depth, angle and noise
  float ang = atan(pos.y, pos.x);
  float depth = pos.z;
  float shade = fbm(vec3(pos.xy * 0.9, pos.z * 0.4 - uTime));

  vec3 col = palette(depth * 0.25 + ang * 1.5 + uTime * 0.4);
  col *= 0.10 + 0.95 * shade * shade;   // deepen shadows, keep bright ridges

  // fold-seam highlight lines
  float seam = smoothstep(0.86, 1.0, abs(sin(ang * 4.0)));
  col += palette(depth * 0.2 + 2.0) * seam * 0.35;

  // proximity glow tinted, punches on the beat — kept as an accent, not a wash
  vec3 glowCol = palette(uTime * 0.6 + 1.0);
  col += glowCol * glow * (0.35 + 0.9 * uBeat);

  // distance fog: near walls lit, throat recedes into darkness
  float fog = exp(-max(hit, 0.0) * 0.11);
  col *= mix(0.02, 1.0, fog);

  // beat bloom flash
  col += palette(uTime).zyx * uBeat * 0.10 * fog;

  // vignette + tone
  float vig = smoothstep(1.35, 0.15, length(uv));
  col *= 0.35 + 0.65 * vig;
  col = col / (1.0 + col);          // Reinhard tonemap
  col = pow(col, vec3(0.4545));     // gamma

  fragColor = vec4(col, 1.0);
}
`;

const VERT = `#version 300 es
precision highp float;
const vec2 verts[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main(){ gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0); }
`;

/* ---------- GL boilerplate ---------- */
function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    fail("Shader compile error:\n" + gl.getShaderInfoLog(sh));
  }
  return sh;
}

const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  fail("Program link error:\n" + gl.getProgramInfoLog(prog));
}
gl.useProgram(prog);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

const uRes   = gl.getUniformLocation(prog, "uRes");
const uTime  = gl.getUniformLocation(prog, "uTime");
const uBeat  = gl.getUniformLocation(prog, "uBeat");
const uLevel = gl.getUniformLocation(prog, "uLevel");

/* ---------- resize ---------- */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}
window.addEventListener("resize", resize);
resize();

/* ---------- beat source: synthetic BPM by default, mic when enabled ---------- */
let bpm = parseInt(bpmSlider.value, 10);
bpmSlider.addEventListener("input", () => {
  bpm = parseInt(bpmSlider.value, 10);
  bpmVal.textContent = bpm;
});

let analyser = null;
let audioData = null;
let smoothLevel = 0.0;

async function toggleMic() {
  if (analyser) {
    // turn off
    analyser = null;
    audioData = null;
    micBtn.classList.remove("on");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    audioData = new Uint8Array(analyser.frequencyBinCount);
    micBtn.classList.add("on");
  } catch (e) {
    micBtn.classList.remove("on");
    errBox.style.display = "block";
    errBox.textContent = "Mic denied — using synthetic beat. (" + e.message + ")";
    setTimeout(() => { errBox.style.display = "none"; }, 3500);
  }
}
micBtn.addEventListener("click", toggleMic);

/* ---------- render loop ---------- */
const start = performance.now();

function frame(now) {
  resize();
  const t = (now - start) / 1000;

  let beat, level;

  if (analyser) {
    // real audio: RMS of low band → level; sharp attack → beat
    analyser.getByteFrequencyData(audioData);
    let sum = 0;
    const bands = Math.min(48, audioData.length);
    for (let i = 0; i < bands; i++) sum += audioData[i] * audioData[i];
    level = Math.sqrt(sum / bands) / 255.0;
    level = Math.min(1.0, level * 1.8);
    smoothLevel += (level - smoothLevel) * 0.2;
    beat = Math.max(0, level - smoothLevel * 0.7) * 3.0;
    beat = Math.min(1.0, beat);
  } else {
    // synthetic: sharp percussive envelope at the chosen BPM
    const beatsPerSec = bpm / 60.0;
    const phase = (t * beatsPerSec) % 1.0;
    beat = Math.pow(1.0 - phase, 6.0);              // fast attack, decay
    const sub = Math.pow(1.0 - ((t * beatsPerSec * 2.0) % 1.0), 10.0) * 0.4;
    beat = Math.min(1.0, beat + sub);
    level = 0.35 + 0.35 * Math.abs(Math.sin(t * beatsPerSec * Math.PI));
    smoothLevel += (level - smoothLevel) * 0.08;
    level = smoothLevel;
  }

  meterFill.style.width = Math.round(beat * 100) + "%";

  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uTime, t);
  gl.uniform1f(uBeat, beat);
  gl.uniform1f(uLevel, level);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
