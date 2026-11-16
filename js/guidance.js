// Ohjaussignaali: kertoo yhdessä paikassa, missä kyykky- tai lentoasento on vihreään kaistaan nähden.
// Sekä HUDin mittarit että hyppääjän asento ja värit lukevat tämän, joten ne näyttävät aina samaa.
// Ei riipu DOMista eikä piirrosta.

import { Phase } from './jump.js';
import { INRUN, FLIGHT, BAND, CRASH, TAKEOFF } from './config.js';
import { clamp } from './util.js';

export const GUIDE_COLOR = { good: '#52d273', sweet: '#8dffab', warn: '#ffd23f', bad: '#ff5d5d' };
export const DANGER_COLOR = '#e0102e';

const IN_BAND_LEAN = 0.35;  // osuus asennon liikkeestä, joka käytetään jo kaistan sisällä
const BAD_FROM = 0.5;       // vakavuus, josta keltainen vaihtuu punaiseksi
const FLASH_TIME = 0.6;     // ponnistuksen laatuväri näkyy hyppääjässä näin kauan nokan jälkeen (s)

const IDLE = Object.freeze({ active: false, offset: 0, severity: 0, lean: 0, state: null, weight: 0 });

/**
 * @param offset   etumerkillinen poikkeama kaistan keskeltä, ±1 = kaistan reuna
 * @param severity 0 = kaistalla, 1 = kaatumisraja
 * @param weight   0..1: kuinka vahvasti signaali näytetään (lentoasentoon noustessa häivytys)
 */
function make(offset, severity, sweet, weight) {
  const sev = clamp(severity, 0, 1);
  const amount = IN_BAND_LEAN * Math.min(Math.abs(offset), 1) + (1 - IN_BAND_LEAN) * sev;
  return {
    active: true,
    offset,
    severity: sev,
    // -1..1: + = osoitin ylhäällä (asento noussut / kärjet liian ylhäällä) -> pitää nojata eteen
    lean: Math.sign(offset) * amount * weight,
    state: sev <= 0 ? (sweet ? 'sweet' : 'good') : sev < BAD_FROM ? 'warn' : 'bad',
    weight,
  };
}

export function guidance(jump) {
  if (jump.phase === Phase.INRUN && !jump.takeoff.pressed) {
    return make(jump.balance / INRUN.balanceHalf, jump.balanceError / CRASH.inrunError, false, 1);
  }
  if (jump.phase === Phase.FLIGHT && !jump.landPrep) {
    const e = jump.aoa - jump.aoaOpt - jump.bandCenter, half = jump.bandHalf;
    // Etureunan alla (sukellus) kaatumisraja on lähempänä kuin takareunan yllä
    const limit = e < 0 ? CRASH.flightFront : CRASH.flightBack;
    const sweet = e >= -half && e < -half + Math.min(BAND.sweet, half);
    return make(e / half, (Math.abs(e) - half) / limit, sweet, jump.posture);
  }
  return IDLE;
}

export function qualityColor(q) {
  return q >= 0.9 ? GUIDE_COLOR.good : q >= 0.6 ? GUIDE_COLOR.warn : GUIDE_COLOR.bad;
}

/** Ponnistuksen laatuväri hetken painalluksen jälkeen (tai punainen, jos ponnistus jäi väliin), muuten null. */
export function takeoffFlash(jump) {
  const t = jump.takeoff;
  if (jump.phase === Phase.INRUN) return t.pressed ? qualityColor(t.quality) : null;
  if (jump.phase !== Phase.FLIGHT || jump.t >= FLASH_TIME) return null;
  if (t.pressed) return qualityColor(t.quality);
  return jump.t > TAKEOFF.lateTime ? GUIDE_COLOR.bad : null;
}
