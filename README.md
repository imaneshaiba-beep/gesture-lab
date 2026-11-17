# Gesture Lab — Shaiba Imane

Une forme 3D qu'on sculpte avec la main, via la caméra : *touche sans toucher*.
Projet personnel de Shaiba Imane, présenté lors des portes ouvertes.

👉 **Voir le site : https://shaiba-imane-gesture-lab.vercel.app**

- **Web** : `index.html` — three.js + shaders GLSL, détection de la main avec MediaPipe Hand Landmarker, 100 % dans le navigateur (aucune image envoyée).
- **TouchDesigner** : `touchdesigner/` — même forme et mêmes gestes, pour une version vidéo (voir `touchdesigner/GUIDE.md`).

## Gestes

| Geste | Effet |
|---|---|
| Bouger | la forme te suit |
| Pincer | attraper et faire tourner |
| Pincer vite | changer de forme |
| Main ouverte | la faire respirer |

Fonctionne aussi à la souris, au toucher et au clavier (flèches, Espace / Entrée).

## Lancer en local

Site statique, sans build : ouvrir `index.html` avec Live Server (la caméra demande `https://` ou `localhost`).

## Déploiement

Hébergé sur Vercel (site statique, aucune configuration) : https://shaiba-imane-gesture-lab.vercel.app

---

© 2026 Shaiba Imane. Tous droits réservés — voir [les mentions légales](legal.html) pour les crédits des librairies utilisées.
