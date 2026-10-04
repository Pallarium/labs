/* WebGL post-process pass for EMBERHOLLOW.
   The 2D game canvas is uploaded as a texture every frame and pushed through a
   fragment shader that adds: threshold bloom around firelight, heat shimmer,
   lens distortion, chromatic aberration that spikes when you take a hit,
   film grain and a soft parchment vignette.

   Self-installing and fail-safe: if WebGL is unavailable or the context is
   lost, the raw 2D canvas is simply left visible and the game plays on. */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime;
uniform float uHurt;     // 0..1, spikes when damaged
uniform float uFlare;    // 0..1, lantern flare burst
uniform float uHeat;     // 0..1, room danger -> more shimmer

/* cheap hash noise */
float hash(vec2 p){
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

vec3 sampleScene(vec2 uv){ return texture(uTex, uv).rgb; }

/* luminance-thresholded blur -> firelight bleeds into the dark */
vec3 bloom(vec2 uv, float radius){
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 12; i++){
    float a = float(i) * 0.5236;            // 12 taps around a circle
    float r = radius * (0.35 + 0.65 * fract(sin(float(i) * 12.9898) * 43758.5453));
    vec2 off = vec2(cos(a), sin(a)) * r / uRes;
    vec3 c = sampleScene(uv + off);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float w = smoothstep(0.42, 0.95, l);
    sum += c * w;
    total += w;
  }
  return total > 0.001 ? sum / 12.0 : vec3(0.0);
}

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  /* gentle barrel distortion — the world bows like it's seen through glass */
  uv = 0.5 + c * (1.0 + 0.055 * r2);

  /* heat shimmer rising from the floor, stronger when the room is hot */
  float shimmer = (0.0014 + uHeat * 0.0022 + uFlare * 0.006);
  float wave = vnoise(vec2(uv.x * 22.0, uv.y * 9.0 - uTime * 0.9));
  uv.x += (wave - 0.5) * shimmer * (0.4 + uv.y);

  /* chromatic aberration grows toward the edges and spikes on damage */
  float ca = (0.0002 + r2 * 0.0011) * (1.0 + uHurt * 6.0);
  vec3 col;
  col.r = sampleScene(uv + vec2( ca, 0.0)).r;
  col.g = sampleScene(uv).g;
  col.b = sampleScene(uv - vec2( ca, 0.0)).b;

  /* firelight bloom */
  vec3 bl = bloom(uv, 7.0 + uFlare * 22.0);
  col += bl * (0.55 + uFlare * 0.9) * vec3(1.15, 0.82, 0.52);

  /* warm the lit areas, cool the shadows — candlelight vs stone */
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 warm = vec3(1.08, 0.97, 0.84);
  vec3 cool = vec3(0.82, 0.88, 1.02);
  col *= mix(cool, warm, smoothstep(0.05, 0.55, lum));

  /* filmic-ish contrast curve, lifts the blacks to charcoal not pure void */
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(col, vec3(0.94));
  col = max(col, vec3(0.012, 0.010, 0.009));

  /* damage flash pushes the whole frame toward dried blood */
  col = mix(col, col * vec3(1.6, 0.42, 0.34) + vec3(0.06, 0.0, 0.0), uHurt * 0.5);

  /* parchment grain, animated */
  float g = hash(vUv * uRes + fract(uTime) * 917.0);
  col += (g - 0.5) * (0.055 + uHurt * 0.06);

  /* static paper fibre, does not animate — sells the inked look */
  float fibre = vnoise(vUv * vec2(uRes.x * 0.35, uRes.y * 0.12));
  col *= 0.97 + fibre * 0.06;

  /* vignette */
  float vig = smoothstep(0.95, 0.18, r2 * 1.35);
  col *= mix(0.30, 1.0, vig);

  /* scanline-free horizontal banding, very subtle, like lamp flicker */
  col *= 1.0 + sin(uTime * 3.1) * 0.012;

  outColor = vec4(col, 1.0);
}`;

export const Shader = {
  ok: false,
  hurt: 0,
  flare: 0,
  heat: 0,

  install(srcCanvas) {
    const gl2 = document.createElement("canvas");
    gl2.id = "post";
    Object.assign(gl2.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      display: "block", pointerEvents: "none", zIndex: "5",
    });
    const gl = gl2.getContext("webgl2", {
      alpha: false, antialias: false, depth: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
    });
    if (!gl) return false;

    const prog = link(gl, VERT, FRAG);
    if (!prog) return false;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.gl = gl; this.prog = prog; this.tex = tex; this.canvas = gl2;
    this.src = srcCanvas;
    this.u = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      hurt: gl.getUniformLocation(prog, "uHurt"),
      flare: gl.getUniformLocation(prog, "uFlare"),
      heat: gl.getUniformLocation(prog, "uHeat"),
      tex: gl.getUniformLocation(prog, "uTex"),
    };

    srcCanvas.parentElement.insertBefore(gl2, srcCanvas.nextSibling);
    srcCanvas.style.opacity = "0";

    gl2.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.ok = false;
      srcCanvas.style.opacity = "1";
      gl2.style.display = "none";
    });

    this.ok = true;
    return true;
  },

  resize(w, h) {
    if (!this.ok) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  },

  /** call once per frame, after the 2D renderer has finished drawing */
  present(time, dt) {
    if (!this.ok) return;
    const gl = this.gl;
    this.hurt = Math.max(0, this.hurt - dt * 3.2);
    this.flare = Math.max(0, this.flare - dt * 2.6);

    this.resize(this.src.width, this.src.height);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src);

    gl.uniform1i(this.u.tex, 0);
    gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.time, time);
    gl.uniform1f(this.u.hurt, Math.min(1, this.hurt));
    gl.uniform1f(this.u.flare, Math.min(1, this.flare));
    gl.uniform1f(this.u.heat, Math.min(1, this.heat));

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },

  kick(kind) {
    if (kind === "hurt") this.hurt = 1;
    else if (kind === "flare") this.flare = 1;
  },
  setHeat(v) { this.heat = v; },
};

function link(gl, vsrc, fsrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn("post link failed:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("shader compile failed:", gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
