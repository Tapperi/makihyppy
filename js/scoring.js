// Pituus- ja tyylipisteet.
// Vaiheessa 1 tyyli on yksi arvosana (0–20) kolminkertaisena. Vaiheessa 3 tämä
// korvataan viidellä tuomarilla – rajapinta (scoreJump) pysyy samana.

import { LANDING, CRASH, DEG } from './config.js';
import { clamp, roundHalf } from './util.js';

export const Outcome = { TELEMARK: 'telemark', TWOFOOT: 'twofoot', FALL: 'fall' };

export function distancePoints(hill, distance) {
  return Math.max(0, 60 + (distance - hill.k) * hill.def.pointsPerMeter);
}

/**
 * @param hill
 * @param j {distance, outcome, avgAoaError (rad), prepTime (s), impact (m/s), crash (hallinta meni ilmassa)}
 */
export function scoreJump(hill, j) {
  const deductions = [];
  const add = (label, amount) => { if (amount > 0.01) deductions.push({ label, amount }); };

  // Lento: keskimääräinen poikkeama parhaasta asennosta
  add('Lentoasento', clamp((j.avgAoaError / DEG - 3) * 0.25, 0, 3));

  // Alastulo
  const hard = clamp((j.impact - 5.5) * 0.5, 0, 1.5);
  if (j.outcome === Outcome.FALL) {
    add('Kaatuminen', 8);
    if (j.crash) add('Hallinnan menetys ilmassa', CRASH.flightPenalty);
  } else if (j.outcome === Outcome.TWOFOOT) {
    add('Tasajalka-alastulo', 2.5);
    add('Kova alastulo', hard);
  } else {
    add('Aikainen alastuloasento', clamp((j.prepTime - LANDING.prepIdealMax) * 2, 0, 2));
    add('Kova alastulo', hard);
  }

  const total = deductions.reduce((s, d) => s + d.amount, 0);
  const judge = roundHalf(clamp(20 - total, 0, 20));
  const style = judge * 3;
  const dist = distancePoints(hill, j.distance);
  return {
    distance: j.distance,
    outcome: j.outcome,
    judge,
    style,
    distancePoints: Math.round(dist * 10) / 10,
    total: Math.round(Math.max(0, dist + style) * 10) / 10,
    deductions,
    crash: j.crash ? 'flight' : null,
  };
}

/** Vauhtimäessä kaatunut ei pääse nokalle asti: ei pituutta eikä pisteitä. */
export function scoreInrunCrash() {
  return {
    distance: 0,
    outcome: Outcome.FALL,
    judge: 0,
    style: 0,
    distancePoints: 0,
    total: 0,
    deductions: [{ label: 'Kaatuminen vauhtimäessä', amount: 20 }],
    crash: 'inrun',
  };
}
