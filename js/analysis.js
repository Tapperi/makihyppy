// Hypyn jälkianalyysi: paljonko kukin virhe maksoi metreinä.
// Lento ajetaan uudelleen samassa tuulessa automaattiohjauksella, ja yksi asia kerrallaan
// vaihdetaan täydelliseksi. Erotus on arvio: se ei vaikuta tulokseen eikä fysiikkaan.

import { STEP, FLIGHT, DEG } from './config.js';
import { Jump, Phase } from './jump.js';
import { clamp, roundHalf } from './util.js';

const LAND_LEAD = 0.3;        // automaattiohjaus ottaa alastuloasennon näin paljon ennen maata (s)
const NO_NOISE = () => 0.25;  // randn(NO_NOISE) = 0: vertailulennossa ei ole pyörteitä

/**
 * Lentää hypyn nokalta alas tallennetussa tuulessa siistillä ohjauksella.
 * @returns pituus metreinä (pyöristämätön) tai null, jos lento ei päättynyt alastuloon
 */
export function flyClean(hill, speed, quality, windLog) {
  const wind = { value: windLog[0] ?? 0, history: [], update() {}, reset() {} };
  const jump = new Jump(hill, wind, NO_NOISE);
  jump.phase = Phase.INRUN;
  jump.d = 0;
  jump.speed = speed;
  jump.takeoff = { pressed: true, at: 0, quality, late: false };
  jump.launch();
  let prepped = false;
  for (let i = 0; i < 120 * 30 && jump.phase === Phase.FLIGHT; i++) {
    if (windLog.length) wind.value = windLog[Math.min(i, windLog.length - 1)];
    const input = { action: false, lean: clamp((jump.aoa - jump.aoaOpt - jump.bandCenter) / (4 * DEG), -1, 1) };
    if (!prepped && jump.t > FLIGHT.landArmTime) {
      const slope = hill.slopeAtX(jump.x);
      const closing = -(jump.vx * Math.sin(slope) + jump.vy * Math.cos(slope));
      if (closing > 0 && jump.height / closing < LAND_LEAD) { input.action = true; prepped = true; }
    }
    jump.step(STEP, input);
  }
  return jump.touchdown && !jump.crash ? jump.fallS : null;
}

/**
 * Paljonko hypystä jäi saamatta: {takeoff, speed, flight, kmh}. Metrit puolen metrin tarkkuudella,
 * + = menetys. flight voi olla negatiivinen: pelaaja liiti automaattiohjausta paremmin.
 * kmh = huonon kyykyn viemä nopeus nokalla. null, jos hyppy ei päässyt nokalta ilmaan.
 */
export function analyzeJump(hill, jump) {
  if (!jump.touchdown || jump.crash === 'inrun') return null;
  const speed = jump.takeoffSpeed, q = jump.takeoff.quality, log = jump.windLog;
  const base = flyClean(hill, speed, q, log);
  const perfect = flyClean(hill, speed, 1, log);
  const fast = flyClean(hill, jump.cleanTakeoffSpeed, q, log);
  if (base === null || perfect === null || fast === null) return null;
  return {
    takeoff: roundHalf(Math.max(0, perfect - base)),
    speed: roundHalf(Math.max(0, fast - base)),
    flight: roundHalf(base - jump.touchdown.distance),
    kmh: Math.max(0, jump.cleanTakeoffSpeed - speed) * 3.6,
  };
}
