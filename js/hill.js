// Mäen geometria sivuprofiilina.
// Koordinaatisto: x oikealle, y ylös, hyppyrin nokka origossa.
// Vauhtimäki on alueella x < 0, alastulorinne alueella x > 0.

import { lerp, clamp } from './util.js';

const DS = 0.5; // profiilin näytteenottoväli (m)

function inrunAngleAt(def, d) {
  // d = etäisyys nokalta rataa pitkin taaksepäin
  const arcLen = def.inrunRadius * (def.inrunAngle - def.tableAngle);
  if (d <= def.tableLength) return def.tableAngle;
  if (d <= def.tableLength + arcLen) return def.tableAngle + (d - def.tableLength) / def.inrunRadius;
  return def.inrunAngle;
}

function landingAngleAt(def, s) {
  // s = etäisyys nokan juurelta rinnettä pitkin
  const outLen = def.outRadius * def.hsAngle;
  if (s <= def.pDist) {
    const t = s / def.pDist;
    return lerp(def.knollAngle, def.pAngle, Math.sin(t * Math.PI / 2));
  }
  if (s <= def.k) return lerp(def.pAngle, def.kAngle, (s - def.pDist) / (def.k - def.pDist));
  if (s <= def.hs) return lerp(def.kAngle, def.hsAngle, (s - def.k) / (def.hs - def.k));
  if (s <= def.hs + outLen) return def.hsAngle - (s - def.hs) / def.outRadius;
  return 0;
}

/** Hakee taulukosta arvon lineaarisesti interpoloiden tasavälisen parametrin u mukaan. */
function sample(arr, u) {
  const f = clamp(u / DS, 0, arr.length - 1);
  const i = Math.min(Math.floor(f), arr.length - 2);
  return lerp(arr[i], arr[i + 1], f - i);
}

export function createHill(def) {
  // --- Vauhtimäki: integroidaan nokalta taaksepäin ---
  const towerExtra = 7; // rata jatkuu puomin yläpuolelle (vain piirtoa varten)
  const inN = Math.ceil((def.inrunLength + towerExtra) / DS) + 1;
  const inX = new Float64Array(inN), inY = new Float64Array(inN);
  for (let i = 1; i < inN; i++) {
    const a = inrunAngleAt(def, (i - 0.5) * DS);
    inX[i] = inX[i - 1] - Math.cos(a) * DS;
    inY[i] = inY[i - 1] + Math.sin(a) * DS;
  }

  // --- Alastulorinne: integroidaan nokan juurelta eteenpäin ---
  const landLen = def.hs + def.outRadius * def.hsAngle + def.outrunLength;
  const laN = Math.ceil(landLen / DS) + 1;
  const laX = new Float64Array(laN), laY = new Float64Array(laN);
  laY[0] = -def.takeoffHeight;
  for (let i = 1; i < laN; i++) {
    const b = landingAngleAt(def, (i - 0.5) * DS);
    laX[i] = laX[i - 1] + Math.cos(b) * DS;
    laY[i] = laY[i - 1] - Math.sin(b) * DS;
  }

  /** x-koordinaatti -> etäisyys rinnettä pitkin (puolitushaku, laX on kasvava). */
  function distAtX(x) {
    if (x <= 0) return 0;
    if (x >= laX[laN - 1]) return (laN - 1) * DS;
    let lo = 0, hi = laN - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (laX[mid] <= x) lo = mid; else hi = mid;
    }
    return (lo + (x - laX[lo]) / (laX[hi] - laX[lo])) * DS;
  }

  const hill = {
    def,
    name: def.name,
    k: def.k,
    hs: def.hs,
    inrunLength: def.inrunLength,
    inrunTop: (inN - 1) * DS,
    landingLength: (laN - 1) * DS,
    brakeStart: def.hs + def.outRadius * def.hsAngle,

    /** Vauhtimäen piste etäisyydellä d nokalta. angle = radan lasku vaakatasosta. */
    inrunPos(d) {
      return { x: sample(inX, d), y: sample(inY, d), angle: inrunAngleAt(def, d) };
    },
    /** Vauhtimäen kaarevuus (1/m) etäisyydellä d nokalta: nollasta poikkeava vain siirtymäkaaressa. */
    inrunCurvature(d) {
      const arcLen = def.inrunRadius * (def.inrunAngle - def.tableAngle);
      return d > def.tableLength && d <= def.tableLength + arcLen ? 1 / def.inrunRadius : 0;
    },
    /** Alastulorinteen piste etäisyydellä s. angle = rinteen lasku vaakatasosta. */
    landingPos(s) {
      return { x: sample(laX, s), y: sample(laY, s), angle: landingAngleAt(def, clamp(s, 0, landLen)) };
    },
    distAtX,
    /** Maanpinnan korkeus alastulopuolella kohdassa x. */
    groundY(x) {
      return sample(laY, distAtX(x));
    },
    slopeAtX(x) {
      return landingAngleAt(def, distAtX(x));
    },
    /** Maasto vauhtimäen alla (piirtoa varten). */
    backGroundY(x) {
      const ax = Math.max(0, -x);
      return -def.takeoffHeight + 0.2 * ax + 0.0035 * ax * ax;
    },
    inrunPoints: { x: inX, y: inY, n: inN },
    landingPoints: { x: laX, y: laY, n: laN },
  };
  return hill;
}
