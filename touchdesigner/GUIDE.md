# La forme dans TouchDesigner — guide pas à pas

Même forme et mêmes gestes que la version web (`../index.html`), mais rendue dans TouchDesigner pour filmer une vidéo de haute qualité.

**Fichiers de ce dossier**

| Fichier | Rôle | Où il va dans TouchDesigner |
|---|---|---|
| `shape_vertex.glsl` | la forme (galet → fleur → torsade + relief) | Text DAT `shape_vertex` |
| `shape_pixel.glsl` | les couleurs (cœur sombre, bords irisés, glitch, grain) | Text DAT `shape_pixel` |
| `controller.py` | transforme ta main en rotation / morphing | callbacks du Script CHOP `controller` |

**Le réseau final**

```
MediaPipe.tox ──► Null DAT "mp_hands" ──► (lu par) Script CHOP "controller"
                                                   │
                     ┌─────────────────────────────┴───────────────┐
                     ▼                                             ▼
            geo1 (Geometry COMP)                         GLSL MAT "shape"
            Rotate = controller rx / ry                  uniforms = controller
              └ Sphere SOP 256×256  ── matériau : shape
                     │
            Render TOP (cam1) ──► Composite TOP ◄── Text TOP « Touche / sans toucher »
                                       │
                                Movie File Out TOP (enregistrement)
```

---

## 0. Installer (une seule fois)

1. **TouchDesigner** : crée un compte sur derivative.ca, télécharge la version macOS et active la licence gratuite *Non-Commercial*.
   - ⚠️ La version gratuite limite la résolution à **1280 × 1280** px. Pour une vidéo de portfolio en 1280 × 720, ça suffit. Pour de la 1080p ou de la 4K, il faut une licence payante (il existe une licence *Educational* pour les étudiants).
2. **Plugin MediaPipe** : télécharge `release.zip` depuis github.com/torinmb/mediapipe-touchdesigner (section *Releases*, version 0.6.1 au moment d'écrire), puis décompresse-le dans ce dossier (`touchdesigner/mediapipe/`).
3. **Police** : installe *Instrument Serif* (Google Fonts → Download family → double-clic sur les .ttf).

## 1. Partir du projet exemple

1. Ouvre `MediaPipe TouchDesigner.toe` (dans le dossier du plugin).
2. Fais tout de suite **File → Save As…** `forme.toe`, **dans le même dossier**. Le composant MediaPipe pèse plus de 500 Mo et doit rester à côté, dans `toxes/`.
3. Si tu glisses un jour `MediaPipe.tox` dans un autre projet, coche bien **« Enable External .tox »**, sinon ton fichier devient énorme.

## 2. Activer la caméra et la main

1. Clique sur le composant **MediaPipe** et choisis ta webcam dans la liste déroulante.
2. Active le suivi des mains (*hands* ou *gestures*) et **désactive les autres modèles** (visage, pose…), car ils sont très gourmands.
3. Au premier lancement, macOS demande l'accès à la caméra : accepte. Si tu as refusé, va dans Réglages Système → Confidentialité et sécurité → Caméra → active TouchDesigner, puis relance-le.
4. ✅ Test : la sortie vidéo de MediaPipe montre ta main avec le squelette par-dessus.

## 3. Récupérer les données de la main

1. Dans le projet exemple, repère le fil qui va de **MediaPipe** vers **hand_tracking**. C'est une sortie DAT (fil violet).
2. Ajoute sur cette sortie un **Null DAT** (touche Tab → DAT → Null) et renomme-le **`mp_hands`**.
3. ✅ Test : clique sur `mp_hands`. Tu dois voir du texte JSON qui contient `gestureResults` et qui change quand tu bouges la main.

## 4. Le contrôleur (Script CHOP)

1. Tab → CHOP → **Script**, renomme-le **`controller`**. Un DAT `controller_callbacks` est créé à côté.
2. Remplace tout le texte de `controller_callbacks` par le contenu de **`controller.py`**.
3. ✅ Test : ouvre le viewer du CHOP. Les canaux `hand`, `pinch`, `x`, `y`… doivent bouger avec ta main. `hand` passe à 1 quand ta main est vue.
   - Si rien ne bouge alors que `mp_hands` change, vérifie le nom `SOURCE = 'mp_hands'` en haut du script.
   - Si les valeurs restent figées (le CHOP ne se recalcule pas à chaque image), écris-moi et on ajoutera un déclencheur.

## 5. La forme

1. Tab → COMP → **Geometry**, renomme-le **`geo1`**. Entre dedans (double-clic), supprime le Torus et ajoute un **Sphere SOP** (rayon 1).
   - Mets le type de primitive sur *Mesh* et monte **Rows / Columns à 256**. C'est ce qui rend la forme lisse.
   - Active le drapeau Render/Display du Sphere SOP (les petits boutons en bas à droite du nœud).
2. Ressors (touche `u`). Dans les paramètres de `geo1`, page *Xform*, tape ces expressions (clique dans le champ, mode expression en bleu) :
   - **Rotate X** : `op('controller')['rx']`
   - **Rotate Y** : `op('controller')['ry']`

## 6. Le matériau (GLSL MAT)

1. Crée deux **Text DAT** nommés **`shape_vertex`** et **`shape_pixel`**, puis colle-y le contenu de `shape_vertex.glsl` et `shape_pixel.glsl`.
   - Plus pratique : dans le paramètre **File** de chaque Text DAT, pointe vers le fichier .glsl. Si l'option *Sync to File* existe dans ta version, active-la : tes modifications dans VS Code seront rechargées.
2. Tab → MAT → **GLSL**, renomme-le **`shape`**. Page *Load* : **Vertex Shader** = `shape_vertex`, **Pixel Shader** = `shape_pixel`.
3. Page **Vectors**, déclare ces uniforms (nom + valeur, les valeurs en mode expression) :

   | Nom | Valeur x | Valeur y |
   |---|---|---|
   | `uTime` | `absTime.seconds` | |
   | `uStar` | `op('controller')['star']` | |
   | `uTwist` | `op('controller')['twist']` | |
   | `uNoise` | `op('controller')['noise']` | |
   | `uGlitch` | `op('controller')['glitch']` | |
   | `uLight` | `op('controller')['lightx']` | `op('controller')['lighty']` |
   | `uBlock` | `22` (≈ `44` en 4K) | |

4. Dans `geo1`, page *Render* : **Material** = `shape`.
5. ✅ Test : s'il y a une erreur de compilation, le GLSL MAT affiche un drapeau rouge. Clique dessus (ou ajoute un Info DAT pointé sur `shape`) et **envoie-moi le message exact**. Je n'ai pas pu compiler ces shaders dans TouchDesigner, donc une petite correction est possible.

## 7. Caméra et rendu

1. **Camera COMP** `cam1` : Translate Z = `6`, Field of View ≈ `32` (même cadrage que le site).
2. **Render TOP** : Geometry = `geo1`, Camera = `cam1`. Résolution `1280 × 720` (gratuit) ou plus avec licence. Anti-alias au maximum.
3. Le fond du Render TOP est transparent, ce qui permet de mettre la typo derrière.

## 8. La grande typo derrière

1. **Text TOP** : texte `Touche` / `sans toucher` (deux lignes), police *Instrument Serif* en italique, très grande taille, couleur gris très clair (≈ 0.91, 0.91, 0.93), fond blanc opaque, même résolution que le rendu.
2. **Composite TOP** en mode **Over**, avec le Render TOP et le Text TOP en entrées.
   - Si la typo passe **devant** la forme, inverse l'ordre des entrées (ou essaie *Under*).
3. Bonus portfolio : ajoute en petit, dans un coin, la sortie vidéo de MediaPipe (avec le squelette). Ça prouve que c'est ta main qui pilote.

## 9. Filmer

1. **Movie File Out TOP** branché après le Composite. Type *Movie*, codec *Apple ProRes* (meilleure qualité sur Mac), choisis le fichier de sortie.
2. Active **Record**, joue avec ta main 20 à 40 s (bouger, pincer et tourner, pincer vite pour changer de forme, main ouverte pour faire respirer), puis désactive Record.
3. Pour le web : convertis en H.264 (MP4) de moins de 10 Mo avec HandBrake.

## 10. Sur le portfolio

```html
<video src="forme-touchdesigner.mp4" autoplay muted loop playsinline></video>
<p>Prototypé dans TouchDesigner, porté sur le web.</p>
```

À côté, mets un lien vers la version web interactive (`index.html`), que le recruteur peut tester lui-même.

---

### Réglages à ajuster après tes premiers tests (`controller.py`, en haut)

- `PINCH_ON` / `PINCH_OFF` : facilité à déclencher le pincement.
- `SMOOTH` : curseur plus doux (plus bas) ou plus nerveux (plus haut).
- `DRAG` : vitesse de rotation quand tu tournes la forme.
- `MIRROR` : mets `False` si les mouvements sont inversés (si *Horizontal flip* est déjà actif dans MediaPipe).
