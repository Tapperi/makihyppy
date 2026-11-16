// Pieni kääre localStoragelle. Vaiheessa 2 kauden tallennus tulee tänne.

import { SEASON } from './config.js';

const KEY = 'tuulimaki.v1';

/** Kauden ennätykset. Kausi 1 on juuritasolla (tallennettu ennen kausia), muut seasons-kentässä. */
function seasonData(data) {
  return SEASON === 1 ? data : ((data.seasons ??= {})[SEASON] ??= {});
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* yksityinen selaus tms. – peli toimii silti */ }
}

/** Mäkikohtainen ennätys tällä kaudella: {distance, total, splits, ghost} tai null. */
export function getBest(hillId) {
  return seasonData(read()).best?.[hillId] ?? null;
}

/** Laitekohtainen asetus (esim. mittarien koko) tai oletusarvo. */
export function getSetting(key, fallback) {
  return read().settings?.[key] ?? fallback;
}

export function saveSetting(key, value) {
  const data = read();
  (data.settings ??= {})[key] = value;
  write(data);
}

/** Tulostaulun pelaaja: {name, deviceId} tai null. */
export function getPlayer() {
  return read().player ?? null;
}

export function savePlayer(player) {
  const data = read();
  data.player = player;
  write(data);
}

/** Viimeisin palvelimen vahvistama paras tulos: {name, total} tai null. */
export function getOnlineBest(hillId) {
  return seasonData(read()).online?.[hillId] ?? null;
}

export function saveOnlineBest(hillId, best) {
  const data = read();
  (seasonData(data).online ??= {})[hillId] = best;
  write(data);
}

/**
 * Päivittää ennätykset. Palauttaa {distanceRecord, pointsRecord, best}.
 * @param splits  hypyn väliajat {speed, heights}: tallennetaan pituusennätyksen mukana vertailua varten
 * @param ghost   hypyn rata (ghost.js): tallennetaan pituusennätyksen mukana haamuhyppääjää varten
 */
export function recordJump(hillId, result, splits, ghost) {
  const data = read();
  const best = (seasonData(data).best ??= {});
  const prev = best[hillId] ?? { distance: 0, total: 0 };
  const valid = result.outcome !== 'fall'; // kaatunut hyppy ei kelpaa pituusennätykseksi
  const distanceRecord = valid && result.distance > prev.distance;
  const pointsRecord = result.total > prev.total;
  best[hillId] = {
    distance: distanceRecord ? result.distance : prev.distance,
    total: pointsRecord ? result.total : prev.total,
    splits: distanceRecord ? splits : prev.splits,
    ghost: distanceRecord ? ghost : prev.ghost,
  };
  write(data);
  return { distanceRecord, pointsRecord, best: best[hillId] };
}
