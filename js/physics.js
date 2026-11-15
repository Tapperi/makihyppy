// Puhtaat fysiikkafunktiot. Ei tilaa, ei DOMia – helppo testata ja käyttää myös
// tietokonevastustajien hyppyjen simulointiin.

import { G, INRUN, TAKEOFF, FLIGHT, LANDING, BAND } from './config.js';
import { clamp, lerp } from './util.js';

/**
 * Vauhtimäen kiihtyvyys rataa pitkin. wind > 0 = vastatuuli.
 * @param postureError 0..1: kyykkyasennon virhe, kasvattaa ilmanvastusta
 */
export function inrunAccel(v, angle, wind, postureError = 0) {
  const air = v + wind * INRUN.windFactor * Math.cos(angle);
  const drag = INRUN.drag * (1 + INRUN.dragPenalty * postureError);
  return G * (Math.sin(angle) - INRUN.friction * Math.cos(angle)) - drag * air * Math.abs(air);
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

/**
 * Lentoasennon suorituskyky: nosteen kerroin osoittimen paikan mukaan.
 * @param e    kohtauskulma suhteessa kaistan keskikohtaan (+ = kärjet ylempänä)
 * @param half kaistan puolileveys
 */
export function posturePerf(e, half) {
  const front = -half, peak = 1 + BAND.edgeBonus;
  const sweet = Math.min(BAND.sweet, half);
  if (e < front) return Math.max(BAND.diveMin, peak - ((front - e) / BAND.diveWidth) * (peak - BAND.diveMin));
  if (e < front + sweet) return 1 + BAND.edgeBonus * (1 - (e - front) / sweet);
  if (e <= half) return 1;
  return Math.max(BAND.backMin, 1 - ((e - half) / BAND.backWidth) * (1 - BAND.backMin));
}

/**
 * Lennon aerodynamiikka.
 * @param vx,vy   nopeus maan suhteen
 * @param pitch   suksien kulma vaakatasosta (+ = kärjet ylös)
 * @param posture 0 = pystyssä, 1 = täysi lentoasento
 * @param wind    vastatuuli m/s
 * @param bandCenter kaistan keskikohta suhteessa FLIGHT.aoaOpt:iin (tuuli siirtää sitä)
 * @param bandHalf   kaistan puolileveys
 * @returns {ax, ay, aoa}
 */
export function flightAccel(vx, vy, pitch, posture, wind, bandCenter = 0, bandHalf = BAND.widthCalm * BAND.range) {
  // Ilman suhteellinen nopeus. Tuuli myötäilee rinnettä.
  const rx = vx + wind * Math.cos(FLIGHT.windTilt);
  const ry = vy - wind * Math.sin(FLIGHT.windTilt);
  const speed = Math.hypot(rx, ry);
  const aoa = pitch - Math.atan2(ry, rx);

  const perf = posturePerf(aoa - FLIGHT.aoaOpt - bandCenter, bandHalf);
  const kL = lerp(FLIGHT.uprightLift, FLIGHT.liftK * perf, posture);
  const kD = lerp(FLIGHT.uprightDrag, FLIGHT.drag, posture);

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
