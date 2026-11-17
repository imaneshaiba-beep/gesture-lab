# controller.py — callbacks d'un Script CHOP (TouchDesigner).
# Lit le JSON du plugin MediaPipe (Null DAT nommé SOURCE) et sort les valeurs qui pilotent la forme :
#   rx, ry        rotation en degrés  → Geometry COMP (Rotate x / y)
#   star, twist, noise, glitch, lightx, lighty → uniforms du GLSL MAT
#   hand, pinch, form, x, y            → utiles pour déboguer / afficher
#
# Mêmes gestes que le site : bouger = la forme suit, pincer = attraper/tourner,
# pincer vite = forme suivante, main ouverte = respiration.
# ⚠️ Seuils non calibrés sur une vraie main : ajuste-les après test.

import json
import math

SOURCE = 'mp_hands'        # Null DAT branché sur la sortie "hand/gesture" de MediaPipe.tox
PINCH_ON, PINCH_OFF = 0.33, 0.50   # distance pouce↔index ÷ taille de la main
PALM_EXTENDED = 1.2
TAP_MAX_S, TAP_MAX_MOVE = 0.28, 0.03
MARGIN = 0.14              # bords de l'image caméra ignorés
MIRROR = True              # effet miroir (mets False si "Horizontal flip" est déjà actif dans MediaPipe)
SMOOTH = 0.35              # lissage du curseur (0 = figé, 1 = brut)
DRAG = 340.0               # degrés de rotation pour un déplacement de toute la largeur

#            star  twist  noise    nom
FORMS = [(0.0, 0.0, 0.17),  # Galet
         (1.0, 0.0, 0.06),  # Fleur
         (0.7, 2.4, 0.10)]  # Torsade


def onSetupParameters(scriptOp):
	return

def onPulse(par):
	return


def _dist(a, b):
	return math.sqrt((a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2 + (a.get('z', 0) - b.get('z', 0)) ** 2)

def _read_hand():
	"""Renvoie (landmarks écran, landmarks 3D) de la 1re main, ou None."""
	dat = op(SOURCE)
	if dat is None or not dat.text:
		return None
	try:
		res = json.loads(dat.text).get('gestureResults') or {}
	except Exception:
		return None
	lms = res.get('landmarks') or []
	if not lms or not lms[0]:
		return None
	world = (res.get('worldLandmarks') or [None])[0] or lms[0]  # 3D si dispo, sinon écran
	return lms[0], world

def _lerp(a, b, k):
	return a + (b - a) * k


def onCook(scriptOp):
	frame = absTime.frame          # lire absTime rend le CHOP dépendant du temps → il recuit à chaque image
	now = absTime.seconds
	st = scriptOp.fetch('state', None)
	if st is None:
		st = dict(x=0.5, y=0.5, rx=15.0, ry=0.0, vx=0.0, vy=0.0, pinch=False, p0=None,
		          form=0, star=0.0, twist=0.0, noise=0.17, glitch=0.0, breath=0.0, last=None)

	hand = _read_hand()
	is_open = False
	if hand:
		lm, world = hand
		# curseur = milieu pouce/index, recadré et lissé
		rx_ = (lm[4]['x'] + lm[8]['x']) / 2
		ry_ = (lm[4]['y'] + lm[8]['y']) / 2
		if MIRROR:
			rx_ = 1 - rx_
		tx = min(1, max(0, (rx_ - MARGIN) / (1 - 2 * MARGIN)))
		ty = min(1, max(0, (ry_ - MARGIN) / (1 - 2 * MARGIN)))
		st['x'] = _lerp(st['x'], tx, SMOOTH)
		st['y'] = _lerp(st['y'], ty, SMOOTH)

		size = max(_dist(world[0], world[9]), 1e-6)
		pinch = _dist(world[4], world[8]) / size
		if not st['pinch'] and pinch < PINCH_ON:
			st['pinch'] = True
			st['p0'] = (now, st['x'], st['y'])
			st['vx'] = st['vy'] = 0.0
		elif st['pinch'] and pinch > PINCH_OFF:
			st['pinch'] = False
			t0, x0, y0 = st['p0']
			if now - t0 < TAP_MAX_S and math.hypot(st['x'] - x0, st['y'] - y0) < TAP_MAX_MOVE:
				st['form'] = (st['form'] + 1) % len(FORMS)   # pincement court = forme suivante
				st['glitch'] = 1.0
				st['vy'] += 4.0

		is_open = (not st['pinch']) and all(
			_dist(world[0], world[tip]) > _dist(world[0], world[pip]) * PALM_EXTENDED
			for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)))

		# attraper / tourner (avec vitesse gardée pour l'inertie)
		if st['pinch'] and st['last']:
			dy = (st['x'] - st['last'][0]) * DRAG
			dx = (st['y'] - st['last'][1]) * DRAG
			st['ry'] += dy
			st['rx'] += dx
			st['vy'] = _lerp(st['vy'], dy, 0.5)
			st['vx'] = _lerp(st['vx'], dx, 0.5)
		st['last'] = (st['x'], st['y'])
	else:
		st['pinch'] = False
		st['last'] = None
		st['x'] = _lerp(st['x'], 0.5, 0.02)
		st['y'] = _lerp(st['y'], 0.5, 0.02)

	# inertie puis rotation lente au repos
	if not st['pinch']:
		st['ry'] += st['vy']
		st['rx'] += st['vx']
		st['vx'] *= 0.95
		st['vy'] = _lerp(st['vy'], 0.18, 0.03)
	st['rx'] = _lerp(st['rx'], 15.0, 0.01)

	# morphing + respiration + glitch
	star, twist, noise = FORMS[st['form']]
	st['breath'] = _lerp(st['breath'], 1.0 if is_open else 0.0, 0.08)
	st['star'] = _lerp(st['star'], star, 0.06)
	st['twist'] = _lerp(st['twist'], twist, 0.06)
	st['noise'] = _lerp(st['noise'], noise + st['breath'] * 0.38, 0.08)
	speed = abs(st['vx']) + abs(st['vy'])
	st['glitch'] = max(st['glitch'] * 0.94, min(speed * 0.1, 0.8), st['breath'] * 0.6)

	scriptOp.store('state', st)

	# la forme penche vers la main (tilt) en plus de la rotation
	tilt_y = (st['x'] * 2 - 1) * 26
	tilt_x = (st['y'] * 2 - 1) * 20
	out = {
		'rx': st['rx'] + tilt_x, 'ry': st['ry'] + tilt_y,
		'star': st['star'], 'twist': st['twist'], 'noise': st['noise'], 'glitch': st['glitch'],
		'lightx': st['x'] * 2 - 1, 'lighty': 1 - st['y'] * 2,
		'hand': 1.0 if hand else 0.0, 'pinch': 1.0 if st['pinch'] else 0.0,
		'open': 1.0 if is_open else 0.0, 'form': float(st['form']), 'x': st['x'], 'y': st['y'],
	}
	scriptOp.clear()
	scriptOp.numSamples = 1
	for name, value in out.items():
		scriptOp.appendChan(name)[0] = value
	return
