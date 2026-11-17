// hand-control.js — contrôle à la main avec la caméra, 100 % dans le navigateur.
// MediaPipe Hand Landmarker (Google) : 21 points par main, ~30 images/s, aucune vidéo envoyée.
//
// Module réutilisable : il ne touche pas au DOM de la page, il émet des événements.
//   const hand = new HandControl();
//   hand.addEventListener("move", e => e.detail.x / e.detail.y / e.detail.pinching);
//   await hand.start();  …  hand.stop();
//
// Événements : status · move · pinchstart · pinchend · tap · palm · lost · frame
//
// Script classique (pas de type="module") : marche aussi en double-cliquant le fichier.
// Expose window.HandControl, window.HAND_CONNECTIONS et window.HAND_SETTINGS.
(() => {

// ⚠️ Valeurs de départ NON calibrées sur une vraie main : ajuste-les après tes tests.
const SETTINGS = {
  MEDIAPIPE_VERSION: "1.1.1",
  MODEL_URL:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",

  PINCH_ON: 0.33,       // distance pouce↔index ÷ taille de la main (3D) : en dessous → pincé
  PINCH_OFF: 0.5,       // au-dessus → relâché (écart = hystérésis, évite le clignotement)
  PALM_EXTENDED: 1.2,   // doigt tendu si (poignet→bout) > (poignet→phalange) × cette valeur
  PALM_HOLD_MS: 450,    // main ouverte tenue ce temps → événement "palm"
  LOST_MS: 300,         // pas de main pendant ce temps → "lost"
  TAP_MAX_MS: 280,      // pincement court…
  TAP_MAX_MOVE: 0.03,   // …et presque immobile (fraction de la largeur d'écran) → "tap"

  MARGIN_X: 0.14,       // zone utile de l'image caméra : on ignore les bords
  MARGIN_Y: 0.12,       // pour pouvoir atteindre les coins de l'écran sans sortir du cadre

  FILTER_MIN_CUTOFF: 1.2, // One Euro filter : plus bas = plus lisse mais plus de latence
  FILTER_BETA: 0.006,     // plus haut = plus réactif quand la main va vite
};

// ---------- One Euro filter (Casiez et al., 2012) : lisse sans « traîner » ----------
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}
class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: new LowPass(), dx: new LowPass(), t: null });
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(value, tMs) {
    const dt = this.t === null ? 1 / 30 : Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const prev = this.x.y ?? value;
    const d = this.dx.filter((value - prev) / dt, OneEuro.alpha(this.dCutoff, dt));
    return this.x.filter(value, OneEuro.alpha(this.minCutoff + this.beta * Math.abs(d), dt));
  }
  reset() { this.x.y = null; this.dx.y = null; this.t = null; }
}

// ---------- géométrie ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const remap = (v, m) => clamp01((v - m) / (1 - 2 * m));
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [bout, phalange] index → auriculaire

class HandControl extends EventTarget {
  constructor(settings = {}) {
    super();
    this.s = { ...SETTINGS, ...settings };
    this.video = document.createElement("video");
    Object.assign(this.video, { muted: true, playsInline: true, autoplay: true });
    this.running = false;
    this._fx = new OneEuro(this.s.FILTER_MIN_CUTOFF, this.s.FILTER_BETA);
    this._fy = new OneEuro(this.s.FILTER_MIN_CUTOFF, this.s.FILTER_BETA);
    this._onVisibility = () => { if (document.hidden && this.running) this.stop("hidden"); };
  }

  _emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _status(state, message) { this._emit("status", { state, message }); }

  async start() {
    if (this.running) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      // la caméra n'est disponible qu'en https://, sur localhost / 127.0.0.1 (et file:// dans Chrome)
      this._status("error", "Caméra indisponible ici : ouvre la page en https:// (ou avec Live Server en local).");
      throw new Error("insecure-context");
    }
    try {
      this._status("loading", "Autorise la caméra…");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      const denied = err.name === "NotAllowedError" || err.name === "SecurityError";
      const none = err.name === "NotFoundError" || err.name === "OverconstrainedError";
      this._status("error", denied ? "Caméra refusée : la souris et le clavier marchent toujours."
        : none ? "Aucune caméra trouvée." : "Impossible d'ouvrir la caméra.");
      throw err;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});

    try {
      this._status("loading", "Chargement du modèle de la main…");
      this.landmarker ??= await this._loadModel();
    } catch (err) {
      this._stopStream();
      this._status("error", "Le modèle n'a pas pu se charger (connexion ?).");
      throw err;
    }

    this.running = true;
    this._lastVideoTime = -1;
    this._lastSeen = performance.now();
    this._handVisible = false;
    this._pinching = false;
    this._palmSince = null;
    this._palmFired = false;
    document.addEventListener("visibilitychange", this._onVisibility);
    this._status("ready", "Main prête.");
    this._loop();
  }

  // Chargé seulement au clic (≈ 10 Mo wasm + modèle) : n'impacte pas le chargement de la page.
  async _loadModel() {
    const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.s.MEDIAPIPE_VERSION}`;
    const { FilesetResolver, HandLandmarker } = await import(`${base}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.s.MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 1,
    });
    try { return await make("GPU"); } catch { return await make("CPU"); } // repli si pas de WebGL
  }

  stop(reason = "user") {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._stopStream();
    document.removeEventListener("visibilitychange", this._onVisibility);
    if (this._handVisible) this._lose();
    this._status("off", reason === "hidden" ? "Caméra coupée (onglet masqué)." : "Caméra coupée.");
  }

  _stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  _loop = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this._lastVideoTime) return; // pas de nouvelle image
    this._lastVideoTime = v.currentTime;
    const now = performance.now();
    const res = this.landmarker.detectForVideo(v, now);
    const lm = res.landmarks?.[0];
    const world = res.worldLandmarks?.[0];
    this._emit("frame", { landmarks: lm || null, video: v });

    if (!lm || !world) {
      if (this._handVisible && now - this._lastSeen > this.s.LOST_MS) this._lose();
      return;
    }
    this._lastSeen = now;
    this._handVisible = true;

    // Curseur = milieu pouce/index : il ne saute pas quand on pince.
    const W = innerWidth, H = innerHeight;
    const rawX = remap(1 - (lm[4].x + lm[8].x) / 2, this.s.MARGIN_X) * W; // 1 - x : effet miroir
    const rawY = remap((lm[4].y + lm[8].y) / 2, this.s.MARGIN_Y) * H;
    const x = this._fx.filter(rawX, now);
    const y = this._fy.filter(rawY, now);

    // Pincement en coordonnées 3D « monde » : indépendant de l'orientation et de la distance.
    const handSize = dist(world[0], world[9]);
    const pinch = dist(world[4], world[8]) / handSize;
    if (!this._pinching && pinch < this.s.PINCH_ON) {
      this._pinching = true;
      this._pinchStart = { t: now, x, y };
      this._emit("pinchstart", { x, y });
    } else if (this._pinching && pinch > this.s.PINCH_OFF) {
      this._endPinch(now, x, y);
    }

    // Main ouverte : 4 doigts tendus et pas de pincement, tenue PALM_HOLD_MS.
    const open = !this._pinching && FINGERS.every(([tip, pip]) =>
      dist(world[0], world[tip]) > dist(world[0], world[pip]) * this.s.PALM_EXTENDED);
    if (open) {
      this._palmSince ??= now;
      if (!this._palmFired && now - this._palmSince > this.s.PALM_HOLD_MS) {
        this._palmFired = true;
        this._emit("palm", { x, y });
      }
    } else { this._palmSince = null; this._palmFired = false; }

    this._emit("move", { x, y, pinching: this._pinching, pinch, open });
  };

  _endPinch(now, x, y) {
    this._pinching = false;
    const p = this._pinchStart;
    const moved = Math.hypot(x - p.x, y - p.y) / innerWidth;
    this._emit("pinchend", { x, y });
    if (now - p.t < this.s.TAP_MAX_MS && moved < this.s.TAP_MAX_MOVE) this._emit("tap", { x: p.x, y: p.y });
  }

  _lose() {
    this._handVisible = false;
    if (this._pinching) { this._pinching = false; this._emit("pinchend", {}); }
    this._palmSince = null;
    this._fx.reset(); this._fy.reset();
    this._emit("lost");
  }
}

// Squelette de la main (pour l'aperçu caméra)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

Object.assign(window, { HandControl, HAND_CONNECTIONS, HAND_SETTINGS: SETTINGS });
})();
