// scene.js — une forme 3D (three.js + shaders) pilotée par la main (hand-control.js) ou la souris.
// Script classique : three.js est chargé par import() dynamique, donc ça marche aussi en file://.
(async () => {
const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js");
const { HandControl, HAND_CONNECTIONS } = window;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s) => document.querySelector(s);

// ---------- les formes : mêmes sommets, seuls les paramètres du shader changent → morphing fluide ----------
const FORMS = [
  { name: "Galet",   star: 0.0,  twist: 0.0, noise: 0.17 },
  { name: "Fleur",   star: 1.0,  twist: 0.0, noise: 0.06 },
  { name: "Torsade", star: 0.7,  twist: 2.4, noise: 0.10 },
];

// ---------- shaders ----------
const NOISE = /* glsl */ `
// Simplex noise 3D — Ashima Arts / Stefan Gustavson (MIT)
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const vertexShader = /* glsl */ `
uniform float uTime, uStar, uTwist, uNoise;
varying vec3 vN; varying vec3 vPos; varying float vNoise;
${NOISE}
float gN;
// sphère → fleur à 5 pétales (uStar) → torsion → relief animé
vec3 displace(vec3 p){
  float petals = cos(5. * atan(p.z, p.x)) * (1. - p.y * p.y); // nul aux pôles : pas de singularité
  vec3 s = p * (1. + uStar * .42 * petals);
  s.y *= 1. - uStar * .28;
  float a = s.y * uTwist; float c = cos(a), si = sin(a);
  s.xz = mat2(c, -si, si, c) * s.xz;
  gN = snoise(p * 1.35 + vec3(0., uTime * .22, uTime * .08));
  return s + p * gN * uNoise;
}
void main(){
  vec3 p = normalize(position);
  vec3 t = normalize(cross(p, abs(p.y) < .99 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
  vec3 b = cross(p, t);
  const float e = .003;
  vec3 d0 = displace(p); float n0 = gN;
  vec3 d1 = displace(normalize(p + t * e));
  vec3 d2 = displace(normalize(p + b * e));
  vec3 n = normalize(cross(d1 - d0, d2 - d0)); // normale recalculée après déformation
  vNoise = n0;
  vN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * vec4(d0, 1.);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime, uGlitch;
uniform vec2 uLight;
varying vec3 vN; varying vec3 vPos; varying float vNoise;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 pal(float t){ return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); } // palette irisée (I. Quilez)
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(-vPos);
  float fres = pow(1. - clamp(dot(N, V), 0., 1.), 1.5);
  vec3 L = normalize(vec3(uLight * 1.6, 1.3));
  float t = fres * .85 + vNoise * .35 + uTime * .035 + dot(N, L) * .22;

  // glitch : blocs d'écran qui décalent la couleur
  vec2 blk = floor(gl_FragCoord.xy / 22.);
  if (hash(blk + floor(uTime * 12.)) < uGlitch * .32) t += .5 * hash(blk * 1.7 + 3.);

  vec3 irid = pal(t);
  vec3 core = vec3(.018, .018, .03) + pal(t + .5) * .07;            // cœur presque noir
  vec3 col = mix(core, irid, smoothstep(.04, .82, fres + vNoise * .16)); // bords irisés
  col += pow(max(dot(reflect(-L, N), V), 0.), 46.) * .85;              // reflet qui suit la main
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * .15;      // grain
  gl_FragColor = vec4(col, 1.);
}`;

// ---------- scène ----------
const canvas = $("canvas.stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.z = 6;

const uniforms = {
  uTime: { value: 0 }, uStar: { value: 0 }, uTwist: { value: 0 }, uNoise: { value: FORMS[0].noise },
  uGlitch: { value: 0 }, uLight: { value: new THREE.Vector2(0.4, 0.5) },
};
const mesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 320, 320),
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
);
scene.add(mesh);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  mesh.scale.setScalar(Math.min(1, (w / h) * 0.8) * 0.88);
}
addEventListener("resize", resize);
resize();

// ---------- état de l'interaction ----------
const S = {
  form: 0,
  rotX: 0.3, rotY: 0, velX: 0, velY: reduceMotion ? 0 : 0.004,
  tiltX: 0, tiltY: 0, targetTiltX: 0, targetTiltY: 0,
  grabbing: false, breath: 0, glitch: 0,
  pointer: { x: 0, y: 0 }, lastInput: 0,
};
const lerp = (a, b, k) => a + (b - a) * k;

function setForm(i) {
  S.form = (i + FORMS.length) % FORMS.length;
  $(".count").textContent = `0${S.form + 1} / 0${FORMS.length}`;
  $(".name").textContent = FORMS[S.form].name;
  if (!reduceMotion) { S.glitch = 1; S.velY += 0.06; } // petit coup de fouet au changement
}
$(".next").addEventListener("click", () => setForm(S.form + 1));
$(".prev").addEventListener("click", () => setForm(S.form - 1));

// la forme regarde le pointeur (souris ou main), en coordonnées -1…1
function aim(x, y) {
  S.pointer.x = (x / innerWidth) * 2 - 1;
  S.pointer.y = (y / innerHeight) * 2 - 1;
  S.targetTiltY = S.pointer.x * 0.45;
  S.targetTiltX = S.pointer.y * 0.35;
}
// attraper / tourner : mêmes fonctions pour la souris et la main
let grabLast = null;
function grabStart(x, y) { S.grabbing = true; grabLast = { x, y, t: performance.now() }; S.velX = S.velY = 0; canvas.classList.add("is-grabbing"); }
function grabMove(x, y) {
  if (!S.grabbing || !grabLast) return;
  const now = performance.now(), dt = Math.max(now - grabLast.t, 1);
  const dx = (x - grabLast.x) * 0.006, dy = (y - grabLast.y) * 0.006;
  S.rotY += dx; S.rotX += dy;
  S.velY = lerp(S.velY, dx * (16 / dt), 0.5); // vitesse gardée pour l'inertie
  S.velX = lerp(S.velX, dy * (16 / dt), 0.5);
  grabLast = { x, y, t: now };
}
function grabEnd() { S.grabbing = false; grabLast = null; canvas.classList.remove("is-grabbing"); if (reduceMotion) S.velX = S.velY = 0; }

// ---------- souris / tactile ----------
let down = null;
canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); down = { x: e.clientX, y: e.clientY }; grabStart(e.clientX, e.clientY); });
canvas.addEventListener("pointermove", (e) => { aim(e.clientX, e.clientY); grabMove(e.clientX, e.clientY); S.lastInput = performance.now(); });
canvas.addEventListener("pointerup", (e) => {
  const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
  grabEnd(); down = null;
  if (click) setForm(S.form + 1); // clic simple = forme suivante
});
canvas.addEventListener("pointercancel", grabEnd);
addEventListener("keydown", (e) => {
  if (e.target.closest("button")) return;
  if (e.key === "ArrowRight") S.velY += 0.03;
  if (e.key === "ArrowLeft") S.velY -= 0.03;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); setForm(S.form + 1); }
});

// ---------- main ----------
const hand = new HandControl();
const toggle = $(".cam-toggle"), label = $(".cam-label"), status = $(".status");
const cursor = $(".hand-cursor");
const pv = $(".preview canvas"), pctx = pv.getContext("2d");
$(".preview .frame").prepend(hand.video);
let hovered = null, handOpen = false;

const say = (t) => { if (document.body.classList.contains("hand-on")) status.textContent = t; };

toggle.addEventListener("click", async () => {
  if (hand.running) return hand.stop();
  if (document.body.classList.contains("hand-loading")) return;
  document.body.classList.add("hand-loading");
  try { await hand.start(); } catch (err) { console.warn("[gesture]", err); }
  document.body.classList.remove("hand-loading");
});

hand.addEventListener("status", ({ detail: { state, message } }) => {
  const on = state === "ready";
  document.body.classList.toggle("hand-on", on);
  toggle.setAttribute("aria-pressed", String(on));
  label.textContent = on ? "Couper la caméra" : state === "error" ? "Réessayer" : state === "loading" ? "Chargement…" : "Activer la main";
  status.textContent = on ? "Montre ta main à la caméra." : message;
  if (!on) resetHand();
});

hand.addEventListener("move", ({ detail: { x, y, pinching, open } }) => {
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cursor.classList.add("is-visible");
  cursor.classList.toggle("is-pinching", pinching);
  cursor.classList.toggle("is-open", open);
  aim(x, y);
  grabMove(x, y);
  S.lastInput = performance.now();
  if (open !== handOpen) { handOpen = open; say(open ? "Elle respire…" : "Pince pour l'attraper."); }

  const target = pinching ? null : document.elementFromPoint(x, y)?.closest("button");
  if (target !== hovered) { hovered?.classList.remove("is-hover"); hovered = target; hovered?.classList.add("is-hover"); }
  cursor.classList.toggle("is-hover", !!hovered);
});
hand.addEventListener("pinchstart", ({ detail: { x, y } }) => { grabStart(x, y); say("Tourne-la."); });
hand.addEventListener("pinchend", () => { grabEnd(); say("Pince vite pour changer de forme."); });
hand.addEventListener("tap", ({ detail: { x, y } }) => {
  const btn = document.elementFromPoint(x, y)?.closest("button");
  if (btn) btn.click(); else setForm(S.form + 1); // pincement court dans le vide = forme suivante
});
hand.addEventListener("lost", () => { resetHand(); say("Montre ta main à la caméra."); });

function resetHand() {
  cursor.classList.remove("is-visible", "is-pinching", "is-open", "is-hover");
  hovered?.classList.remove("is-hover"); hovered = null;
  handOpen = false;
  if (S.grabbing) grabEnd();
}

// aperçu caméra : squelette irisé
let frames = 0, fpsT = performance.now();
hand.addEventListener("frame", ({ detail: { landmarks, video } }) => {
  const w = (pv.width = video.videoWidth), h = (pv.height = video.videoHeight);
  if (++frames && performance.now() - fpsT > 1000) { $(".fps").textContent = `${frames} img/s`; frames = 0; fpsT = performance.now(); }
  if (!landmarks) return;
  const g = pctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#5ef2d6"); g.addColorStop(0.5, "#7a7cff"); g.addColorStop(1, "#ff6a4d");
  pctx.strokeStyle = g; pctx.lineWidth = w / 110; pctx.lineCap = "round";
  pctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    pctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
    pctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
  }
  pctx.stroke();
});

// ---------- favicon vivante : la vraie forme 3D, copiée dans l'onglet 4 fois par seconde ----------
const favLink = document.querySelector("link[rel='icon']");
const favCanvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
const favCtx = favCanvas.getContext("2d");
let favFrame = 0;
function updateFavicon() {
  const c = renderer.domElement, s = Math.min(c.width, c.height) * 0.6;
  favCtx.clearRect(0, 0, 64, 64);
  favCtx.filter = "saturate(1.7) contrast(1.25) brightness(1.15)"; // lisible même en 16 px
  favCtx.drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, 64, 64); // juste après le rendu, sinon l'image est vide
  favLink.href = favCanvas.toDataURL("image/png");
}

// ---------- boucle de rendu ----------
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), k = 1 - Math.pow(0.001, dt); // lissage indépendant du fps
  if (!reduceMotion) uniforms.uTime.value += dt;

  // rotation : drag direct, sinon inertie qui ralentit vers une rotation lente
  if (!S.grabbing) {
    S.rotY += S.velY; S.rotX += S.velX;
    S.velX *= 0.95;
    S.velY = lerp(S.velY, reduceMotion ? 0 : 0.003, 0.03);
  }
  S.rotX = lerp(S.rotX, 0.3, 0.01); // revient doucement vers une inclinaison agréable
  S.tiltX = lerp(S.tiltX, S.targetTiltX, k * 0.5);
  S.tiltY = lerp(S.tiltY, S.targetTiltY, k * 0.5);
  mesh.rotation.set(S.rotX + S.tiltX, S.rotY + S.tiltY, 0);

  // morphing vers la forme courante + respiration main ouverte
  const f = FORMS[S.form];
  S.breath = lerp(S.breath, handOpen ? 1 : 0, k * 0.4);
  uniforms.uStar.value = lerp(uniforms.uStar.value, f.star, k * 0.35);
  uniforms.uTwist.value = lerp(uniforms.uTwist.value, f.twist, k * 0.35);
  uniforms.uNoise.value = lerp(uniforms.uNoise.value, f.noise + S.breath * 0.38, k * 0.5);

  // glitch : au changement de forme, quand on tourne vite, quand elle respire
  const speed = Math.abs(S.velX) + Math.abs(S.velY);
  S.glitch = Math.max(S.glitch * 0.94, Math.min(speed * 6, 0.8), S.breath * 0.6);
  uniforms.uGlitch.value = reduceMotion ? 0 : S.glitch;
  uniforms.uLight.value.set(lerp(uniforms.uLight.value.x, S.pointer.x, k), lerp(uniforms.uLight.value.y, -S.pointer.y, k));

  renderer.render(scene, camera);
  if (favLink && !reduceMotion && ++favFrame % 15 === 0) updateFavicon();
  requestAnimationFrame(tick);
}
canvas.classList.add("is-ready");
tick();
})().catch((err) => {
  console.error("[gesture-lab]", err);
  const s = document.querySelector(".status");
  if (s) s.textContent = "La 3D n'a pas pu se charger (connexion ou WebGL).";
});
