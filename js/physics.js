// Puhtaat fysiikkafunktiot. Ei tilaa, ei DOMia – helppo testata ja käyttää myös
// tietokonevastustajien hyppyjen simulointiin.

import { G, INRUN, TAKEOFF, FLIGHT, LANDING } from './config.js';
import { clamp, lerp } from './util.js';

/** Vauhtimäen kiihtyvyys rataa pitkin. wind > 0 = vastatuuli. */
export function inrunAccel(v, angle, wind) {
  const air = v + wind * INRUN.windFactor * Math.cos(angle);
  return G * (Math.sin(angle) - INRUN.friction * Math.cos(angle)) - INRUN.drag * air * Math.abs(air);
}

/**
 * Ponnistuksen teho 0..1 sen mukaan, kuinka monta metriä ennen nokkaa painettiin.
 */
export function takeoffQuality(distBeforeEdge) {
  const err = Math.abs(distBeforeEdge - TAKEOFF.optimum);
  return clamp(1 - Math.max(0, err - TAKEOFF.perfect) / TAKEOFF.falloff, 0, 1);
}

/** Myöhästyneen (nokan jälkeen painetun) ponnistuksen teho. */
export function lateTakeoffQuality(timeAfterEdge) {
  return clamp(TAKEOFF.lateMax * (1 - timeAfterEdge / TAKEOFF.lateTime), 0, 1);
}

/** Nosteen muotokerroin 0..1 kohtauskulman mukaan. */
export function liftShape(aoa, aoaOpt = FLIGHT.aoaOpt) {
  const d = aoa - aoaOpt;
  const w = d < 0 ? FLIGHT.aoaLow : FLIGHT.aoaHigh;
  return Math.max(FLIGHT.liftMin, 1 - (d / w) * (d / w));
}

/**
 * Lennon aerodynamiikka.
 * @param vx,vy   nopeus maan suhteen
 * @param pitch   suksien kulma vaakatasosta (+ = kärjet ylös)
 * @param posture 0 = pystyssä, 1 = täysi lentoasento
 * @param wind    vastatuuli m/s
 * @param aoaOpt  paras kohtauskulma juuri nyt (tuuli siirtää sitä)
 * @returns {ax, ay, aoa}
 */
export function flightAccel(vx, vy, pitch, posture, wind, aoaOpt = FLIGHT.aoaOpt) {
  // Ilman suhteellinen nopeus. Tuuli myötäilee rinnettä.
  const rx = vx + wind * Math.cos(FLIGHT.windTilt);
  const ry = vy - wind * Math.sin(FLIGHT.windTilt);
  const speed = Math.hypot(rx, ry);
  const aoa = pitch - Math.atan2(ry, rx);

  // Tuuli siirtää koko aerodynamiikkaa (noste ja vastus) optimin mukana, joten
  // kaistaa seuraava hyppääjä lentää yhtä hyvin kuin ennenkin.
  const eff = aoa - (aoaOpt - FLIGHT.aoaOpt);
  const sinA = Math.sin(clamp(eff, 0, Math.PI / 2));
  const kL = lerp(FLIGHT.uprightLift, FLIGHT.liftK * liftShape(eff), posture);
  const kD = lerp(FLIGHT.uprightDrag, FLIGHT.dragBase + FLIGHT.dragAlpha * sinA * sinA, posture);

  return {
    ax: -kD * speed * rx - kL * speed * ry,
    ay: -G - kD * speed * ry + kL * speed * rx,
    aoa,
  };
}

/** Liu'un kiihtyvyys rinnettä pitkin alastulon jälkeen. */
export function slideAccel(v, slope, friction) {
  return G * (Math.sin(slope) - friction * Math.cos(slope)) - LANDING.slideDrag * v * v;
}
