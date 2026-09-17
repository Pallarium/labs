// Living Coral Reef — pure WebGL2, no libraries, no assets, all procedural.
// A single raymarched fragment shader draws a seafloor, corals, kelp, fish,
// volumetric god rays, animated caustics, bubbles and marine snow.

const canvas = document.getElementById('gl');
const fpsEl  = document.getElementById('fps');
const hintEl = document.getElementById('hint');
const errEl  = document.getElementById('err');

function fail(msg){
  errEl.style.display = 'grid';
  errEl.textContent = 'Coral reef could not start:\n\n' + msg;
  console.error(msg);
}

const gl = canvas.getContext('webgl2', {
  antialias: false, depth: false, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false
});
if (!gl) fail('WebGL2 is not available in this browser.');

/* ------------------------------------------------------------------ */
/*  Shaders                                                            */
/* ------------------------------------------------------------------ */

const VERT = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(P[gl_VertexID], 0., 1.); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;      // render resolution
uniform float uTime;
uniform vec2  uMouse;    // -1..1

/* ---------- hash / noise ---------- */
float hash11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3  hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }

float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  float n=i.x+i.y*57.+113.*i.z;
  float a=hash11(n),           b=hash11(n+1.);
  float c=hash11(n+57.),       d=hash11(n+58.);
  float e=hash11(n+113.),      g=hash11(n+114.);
  float h=hash11(n+170.),      k=hash11(n+171.);
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),
             mix(mix(e,g,f.x),mix(h,k,f.x),f.y),f.z);
}
float fbm(vec3 p){
  float s=0., a=.5; mat3 m=mat3(0.,.8,.6,-.8,.36,-.48,-.6,-.48,.64);
  for(int i=0;i<5;i++){ s+=a*vnoise(p); p=m*p*2.02; a*=.5; }
  return s;
}

/* ---------- SDF primitives ---------- */
float sdSphere(vec3 p,float r){ return length(p)-r; }
float sdRoundCone(vec3 p,float r1,float r2,float h){
  vec2 q=vec2(length(p.xz),p.y);
  float b=(r1-r2)/h, a=sqrt(1.-b*b), k=dot(q,vec2(-b,a));
  if(k<0.) return length(q)-r1;
  if(k>a*h) return length(q-vec2(0.,h))-r2;
  return dot(q,vec2(a,b))-r1;
}
float smin(float a,float b,float k){ float h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }

/* ---------- coral field ---------- */
// domain-repeated coral clusters over the seafloor
float coralAt(vec3 p, vec2 cell, float seed){
  // branching coral built from stacked round cones + knobs
  float d = 1e5;
  float ht = .55 + .9*hash11(seed*3.1);
  vec3 q = p;
  // main trunk sway
  float sway = .10*sin(uTime*.7 + seed*6.0 + p.y*1.5);
  q.x += sway*(p.y+1.0);
  q.z += .06*cos(uTime*.6 + seed*4.0 + p.y*1.5)*(p.y+1.0);

  // trunk
  d = sdRoundCone(q+vec3(0.,1.0,0.), .16, .05, ht);

  // branches
  for(int i=0;i<4;i++){
    float fi=float(i);
    float a = seed*10.0 + fi*1.9;
    vec3 dir = normalize(vec3(cos(a), .8+.5*hash11(a), sin(a)));
    float bh = ht*(.35+.4*hash11(a+2.0));
    vec3 bp = q + vec3(0.,1.0-bh-.15,0.);
    // bend branch coordinate
    vec3 rp = bp - dir*max(0.,dot(bp,dir))*0.0;
    float bd = sdRoundCone(bp - dir*0.0 + vec3(0.,0.,0.), .07,.03,.0001);
    // approximate branch as capsule toward dir
    vec3 pa = bp;
    float t = clamp(dot(pa,dir),0.,bh);
    float cap = length(pa - dir*t) - mix(.075,.02,t/bh);
    d = smin(d, cap, .07);
    // tip knob
    d = smin(d, sdSphere(pa-dir*bh, .06), .05);
  }
  return d;
}

// returns distance and writes material id + local color seed
float map(vec3 p, out float matID, out float cseed){
  matID = 0.; cseed = 0.;

  // --- seafloor: rolling sand dunes ---
  float floorH = -1.6
      + .35*fbm(p*0.35 + vec3(0.,0.,uTime*0.02))
      + .12*fbm(p*1.3);
  float dFloor = p.y - floorH;

  float d = dFloor;
  matID = 1.;

  // --- coral clusters on a grid ---
  float scale = 3.2;
  vec2 gp = p.xz/scale;
  vec2 cell = floor(gp);
  float best = 1e5; float bestSeed=0.;
  for(int j=-1;j<=1;j++)
  for(int i=-1;i<=1;i++){
    vec2 c = cell + vec2(float(i),float(j));
    vec2 rnd = hash22(c);
    if(rnd.x < .28) continue;                 // not every cell has coral
    vec2 center = (c + .25 + .5*hash22(c+7.1))*scale;
    float fh = -1.6 + .35*fbm(vec3(center.x,0.,center.y)*0.35);
    vec3 lp = p - vec3(center.x, fh, center.y);
    float seed = hash21(c+3.7);
    float cd = coralAt(lp, c, seed);
    if(cd < best){ best = cd; bestSeed = seed; }
  }
  if(best < d){ d = best; matID = 2.; cseed = bestSeed; }

  // --- kelp strands (tall swaying blades) ---
  vec2 kscale = vec2(5.5);
  vec2 kcell = floor(p.xz/kscale);
  vec2 krnd = hash22(kcell+21.3);
  if(krnd.x > .55){
    vec2 kc = (kcell + .5 + .4*(hash22(kcell+2.2)-.5))*kscale;
    float fh = -1.6 + .35*fbm(vec3(kc.x,0.,kc.y)*0.35);
    float kh = 3.5 + 2.0*krnd.y;
    vec3 lp = p - vec3(kc.x, fh, kc.y);
    float yy = clamp(lp.y,0.,kh);
    float ph = krnd.x*30.0;
    lp.x += 0.55*sin(uTime*0.9 + yy*0.6 + ph)*(yy/kh);
    lp.z += 0.35*cos(uTime*0.7 + yy*0.5 + ph)*(yy/kh);
    // flattened capsule = blade
    float blade = length(vec2(lp.x, lp.z*2.2)) - mix(.11,.02,yy/kh);
    float cap = max(blade, max(-lp.y, lp.y-kh));
    if(cap < d){ d = cap; matID = 3.; cseed = krnd.y; }
  }

  return d;
}
float mapD(vec3 p){ float m,s; return map(p,m,s); }

vec3 calcNormal(vec3 p){
  vec2 e=vec2(.0015,0.);
  return normalize(vec3(
    mapD(p+e.xyy)-mapD(p-e.xyy),
    mapD(p+e.yxy)-mapD(p-e.yxy),
    mapD(p+e.yyx)-mapD(p-e.yyx)));
}

/* ---------- caustics ---------- */
float caustic(vec2 uv, float t){
  vec2 p = uv;
  vec2 i = p; float c=1.; float inten=.006;
  for(int n=0;n<4;n++){
    float tt = t*(1.0 - (3.5/float(n+1)));
    i = p + vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c += 1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c/=4.0; c=1.17-pow(c,1.4);
  float v=pow(abs(c),8.0);
  return clamp(v,0.,1.);
}

/* ---------- lighting / water ---------- */
const vec3 SUNDIR = normalize(vec3(0.25,0.92,0.28));

vec3 waterColor(float depth){
  // deeper = darker, bluer
  vec3 shallow = vec3(0.10,0.42,0.55);
  vec3 deep    = vec3(0.01,0.09,0.17);
  return mix(deep, shallow, clamp(depth,0.,1.));
}

float ambientOcc(vec3 p, vec3 n){
  float occ=0., sca=1.;
  for(int i=0;i<5;i++){
    float h=.02+.14*float(i);
    float d=mapD(p+n*h);
    occ+=(h-d)*sca; sca*=.72;
  }
  return clamp(1.-1.6*occ,0.,1.);
}

float softShadow(vec3 ro, vec3 rd){
  float res=1., t=.06;
  for(int i=0;i<18;i++){
    float h=mapD(ro+rd*t);
    if(h<.003) return 0.45;
    res=min(res, 7.0*h/t);
    t+=clamp(h,.08,.5);
    if(t>7.0) break;
  }
  return clamp(res,0.45,1.);
}

vec3 coralColor(float seed){
  // varied reef palette
  vec3 a = vec3(1.0,0.35,0.45);   // pink
  vec3 b = vec3(1.0,0.62,0.20);   // orange
  vec3 c = vec3(0.55,0.85,0.65);  // green
  vec3 d = vec3(0.72,0.45,0.95);  // purple
  vec3 e = vec3(1.0,0.80,0.30);   // yellow
  float s = fract(seed*7.0);
  vec3 col;
  if(s<.25) col=a; else if(s<.5) col=b; else if(s<.7) col=c;
  else if(s<.87) col=d; else col=e;
  return col;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;

  // slow forward drift + gentle mouse look
  float t = uTime;
  vec3 ro = vec3(0.6*sin(t*0.05), 0.6 + 0.2*sin(t*0.15), t*0.55);
  vec2 m  = uMouse*vec2(0.55,0.32);
  vec3 ta = ro + vec3(m.x*2.0, -0.35 + m.y*1.4, 2.0);
  vec3 fw = normalize(ta-ro);
  vec3 rt = normalize(cross(fw, vec3(0.,1.,0.)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(uv.x*rt + uv.y*up + 1.35*fw);

  // gentle water wobble on the ray
  rd.xy += 0.012*vec2(sin(t*1.3+uv.y*8.0), cos(t*1.1+uv.x*8.0));
  rd = normalize(rd);

  // ---- raymarch ----
  float t0=0.0, dist=0.0; float matID=0.; float cseed=0.; bool hit=false;
  float tmax=42.0;
  for(int i=0;i<78;i++){
    vec3 p=ro+rd*t0;
    float m,s; float d=map(p,m,s);
    if(d<0.0035*t0+0.0010){ hit=true; matID=m; cseed=s; dist=t0; break; }
    t0+=d*0.95;
    if(t0>tmax) break;
  }

  vec3 col;
  float depthFog;

  if(hit){
    vec3 p=ro+rd*dist;
    vec3 n=calcNormal(p);
    float ao=ambientOcc(p,n);
    float sh=softShadow(p+n*0.01, SUNDIR);
    float diff=clamp(dot(n,SUNDIR),0.,1.);
    float bounce=clamp(dot(n,vec3(0.,-1.,0.)),0.,1.)*0.25;

    // caustic light projected from above — strongest on the flat sand
    float caus = caustic(p.xz*0.55 + 0.15*n.xz, t*0.4);
    caus += 0.6*caustic(p.xz*0.28 - 0.1*n.xz, t*0.28); // large slow cells
    float floorFacing = clamp(n.y,0.,1.);              // up-facing = catches light
    caus *= 0.35 + 0.9*floorFacing;
    float caus2 = caustic(p.xz*1.3, t*0.5)*0.5;

    vec3 base;
    if(matID<1.5){                       // sand floor
      float grain = fbm(p*6.0)*0.25+0.75;
      base = vec3(0.62,0.55,0.42)*grain;
      base = mix(base, vec3(0.5,0.55,0.45), fbm(p*0.7)*0.4);
    } else if(matID<2.5){                 // coral
      base = coralColor(cseed);
      base *= 0.7+0.5*fbm(p*10.0);        // texture
    } else {                              // kelp
      base = mix(vec3(0.12,0.35,0.12), vec3(0.35,0.6,0.2), cseed);
      base *= 0.6+0.5*fbm(p*4.0);
    }

    vec3 lit = base*(0.25 + 0.9*diff*sh) + base*bounce;
    lit += base*(caus+caus2)*1.6*sh;     // caustic sparkle
    lit *= ao;
    // subsurface warmth on thin coral tips
    if(matID>1.5 && matID<2.5)
      lit += base*pow(clamp(dot(n,-rd),0.,1.),2.0)*0.25;

    depthFog = clamp(dist/tmax,0.,1.);
    float depthLev = clamp((p.y+2.0)/4.0,0.,1.);
    col = mix(lit, waterColor(depthLev), pow(depthFog,0.9));
  } else {
    // open water toward the surface
    float up = clamp(rd.y*0.5+0.5,0.,1.);
    col = mix(waterColor(0.15), waterColor(0.95), up);
    // shimmering surface far above
    float surf = smoothstep(0.55,0.95,rd.y);
    float ripple = caustic(rd.xz*4.0/max(rd.y,0.15) + t*0.1, t*0.6);
    col += surf*ripple*vec3(0.5,0.8,0.9)*0.5;
    depthFog = 1.0;
  }

  // ---- volumetric god rays (marched toward the sun) ----
  {
    float rays=0.;
    float steps=14.0;
    float far = hit ? dist : 26.0;
    vec2 seed2 = gl_FragCoord.xy;
    float jitter = hash21(seed2)*1.0;
    for(float i=0.;i<14.;i++){
      float tt = (i+jitter)/steps*far;
      vec3 sp = ro+rd*tt;
      // beams: caustic pattern high up, modulated by depth
      float beam = caustic(sp.xz*0.5 + sp.y*0.2, t*0.3);
      beam *= smoothstep(-2.0, 4.0, sp.y);   // stronger higher up
      // shafts angle with the sun
      beam *= 0.5+0.5*sin(sp.x*0.5 + sp.z*0.4 - t*0.3);
      rays += beam;
    }
    rays/=steps;
    col += vec3(0.35,0.65,0.75)*rays*1.1;
  }

  // ---- marine snow (drifting particles) ----
  {
    vec2 sp = uv*vec2(uRes.x/uRes.y,1.0);
    for(float k=0.;k<3.;k++){
      float sc = 8.0 + k*10.0;
      vec2 gp = sp*sc + vec2(0.0, -t*(0.15+0.1*k));
      gp.x += sin(gp.y*0.5 + k)*0.3;
      vec2 id = floor(gp);
      vec2 f = fract(gp)-0.5;
      float r = hash21(id+k*13.7);
      if(r>0.86){
        float d = length(f);
        float glow = smoothstep(0.16,0.0,d)*(0.4+0.6*sin(t*2.0+r*30.0));
        col += vec3(0.6,0.85,1.0)*glow*0.18*(1.0-0.2*k);
      }
    }
  }

  // ---- rising bubbles ----
  {
    vec2 sp = uv*vec2(uRes.x/uRes.y,1.0);
    for(float k=0.;k<2.;k++){
      float sc=5.0+k*6.0;
      vec2 gp=sp*sc+vec2(0.0,-t*(0.5+0.3*k));
      gp.x+=sin(gp.y*1.5+k*3.0)*0.25;
      vec2 id=floor(gp); vec2 f=fract(gp)-0.5;
      float r=hash21(id+k*7.3+50.0);
      if(r>0.93){
        float rad=0.12+0.15*hash11(r*11.0);
        float d=length(f);
        float ring=smoothstep(rad,rad-0.04,d)-smoothstep(rad-0.05,rad-0.09,d);
        float body=smoothstep(rad,0.0,d)*0.12;
        col += vec3(0.7,0.9,1.0)*(ring*0.5+body);
      }
    }
  }

  // ---- fish silhouettes crossing the view (screen-space schooling) ----
  {
    for(float k=0.;k<7.;k++){
      float sp = hash11(k*3.1)*2.0-1.0;
      float speed = 0.12+0.08*hash11(k*5.2);
      float dir = (mod(k,2.0)<1.0)?1.0:-1.0;
      float px = mod( (t*speed*dir) + hash11(k)*3.0, 3.0)-1.5;
      px *= (uRes.x/uRes.y);
      float py = -0.35 + 0.55*sin(t*0.3+k*2.0) + sp*0.3;
      py += 0.03*sin(t*3.0+k);
      float depth = 0.4+0.5*hash11(k*8.0);
      vec2 fpos = vec2(px, py);
      vec2 q = (uv - fpos)/(0.09*depth);
      q.x *= dir;
      // fish body: ellipse + tail
      float body = length(vec2(q.x*0.6, q.y)) - 1.0;
      float tail = length(vec2((q.x+1.2)*0.7, q.y*(1.8+sin(t*8.0+k)*0.6)*(1.0)))-0.5;
      tail = max(tail, q.x+0.4);
      float fish = min(body, tail);
      float mask = smoothstep(0.06,-0.02,fish);
      vec3 fishCol = mix(vec3(0.05,0.18,0.28), coralColor(hash11(k*2.7))*0.7, 0.5);
      // little bright eye
      float eye = smoothstep(0.12,0.0,length(q-vec2(0.55,0.15)));
      fishCol = mix(fishCol, vec3(0.9,0.95,1.0), eye*0.8);
      col = mix(col, fishCol, mask*depth*0.9);
    }
  }

  // ---- tone / vignette / grade ----
  col *= 1.05;
  col = col/(col+vec3(0.9))*1.6;                    // filmic-ish
  col = pow(max(col,0.0), vec3(0.85));              // lift shadows a touch
  float vig = smoothstep(1.35,0.2,length(uv));
  col *= mix(0.55,1.0,vig);
  col = mix(col, vec3(0.02,0.10,0.18), 0.0);        // keep blues honest

  outColor = vec4(clamp(col,0.,1.), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/*  GL setup                                                          */
/* ------------------------------------------------------------------ */

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    const log = gl.getShaderInfoLog(s);
    fail('Shader compile error:\n' + log);
    throw new Error(log);
  }
  return s;
}

let prog, uRes, uTime, uMouse, vao;
if (gl){
  try{
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      fail('Program link error:\n' + gl.getProgramInfoLog(prog));
    }
    uRes   = gl.getUniformLocation(prog, 'uRes');
    uTime  = gl.getUniformLocation(prog, 'uTime');
    uMouse = gl.getUniformLocation(prog, 'uMouse');
    vao = gl.createVertexArray();       // empty VAO, geometry from gl_VertexID
  }catch(e){ /* already reported */ }
}

/* ------------------------------------------------------------------ */
/*  Resolution scaling for a steady 60fps                             */
/* ------------------------------------------------------------------ */

let scale = 0.8;                 // render-scale multiplier (starts modest, adapts up)
const MIN_SCALE = 0.4, MAX_SCALE = 1.0;
let rw = 1, rh = 1, baseW = 1, baseH = 1;

function resize(){
  const dpr = Math.min(window.devicePixelRatio || 1, 1.0); // cap at 1 — heavy shader
  baseW = Math.max(2, Math.floor(window.innerWidth  * dpr));
  baseH = Math.max(2, Math.floor(window.innerHeight * dpr));
  applyScale();
}
// The canvas backing store is set to the scaled resolution and CSS
// stretches it to fill the screen — cheap, artifact-free upscaling.
function applyScale(){
  rw = Math.max(2, Math.floor(baseW * scale));
  rh = Math.max(2, Math.floor(baseH * scale));
  canvas.width  = rw;
  canvas.height = rh;
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/*  Input                                                             */
/* ------------------------------------------------------------------ */

let mx = 0, my = 0, tmx = 0, tmy = 0, moved = false;
window.addEventListener('pointermove', e=>{
  tmx = (e.clientX / window.innerWidth)  * 2 - 1;
  tmy = -((e.clientY / window.innerHeight) * 2 - 1);
  if (!moved){ moved = true; hintEl.classList.add('gone'); }
});

/* ------------------------------------------------------------------ */
/*  Render loop with adaptive resolution                             */
/* ------------------------------------------------------------------ */

let last = performance.now();
let acc = 0, frames = 0, fpsAvg = 60;
const t0 = performance.now();

function frame(now){
  const dt = Math.min((now - last)/1000, 0.05);
  last = now;

  // ease mouse
  mx += (tmx - mx)*0.06;
  my += (tmy - my)*0.06;

  // fps + adaptive scaling
  acc += dt; frames++;
  if (acc >= 0.5){
    fpsAvg = frames/acc;
    fpsEl.textContent = fpsAvg.toFixed(0) + ' fps · ' + Math.round(scale*100) + '%';
    if (fpsAvg < 52 && scale > MIN_SCALE){ scale = Math.max(MIN_SCALE, scale-0.1); applyScale(); }
    else if (fpsAvg > 58 && scale < MAX_SCALE){ scale = Math.min(MAX_SCALE, scale+0.05); applyScale(); }
    acc = 0; frames = 0;
  }

  if (prog){
    gl.viewport(0, 0, rw, rh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(uRes, rw, rh);
    gl.uniform1f(uTime, (now - t0)/1000);
    gl.uniform2f(uMouse, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
}

if (gl && prog){
  resize();
  requestAnimationFrame(frame);
}
