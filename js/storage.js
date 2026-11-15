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

/** Mäkikohtainen ennätys tällä kaudella: {distance, total} tai null. */
export function getBest(hillId) {
  return seasonData(read()).best?.[hillId] ?? null;
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

/** Päivittää ennätykset. Palauttaa {distanceRecord, pointsRecord}. */
export function recordJump(hillId, result) {
  const data = read();
  const best = (seasonData(data).best ??= {});
  const prev = best[hillId] ?? { distance: 0, total: 0 };
  const valid = result.outcome !== 'fall'; // kaatunut hyppy ei kelpaa pituusennätykseksi
  const distanceRecord = valid && result.distance > prev.distance;
  const pointsRecord = result.total > prev.total;
  best[hillId] = {
    distance: distanceRecord ? result.distance : prev.distance,
    total: pointsRecord ? result.total : prev.total,
  };
  write(data);
  return { distanceRecord, pointsRecord, best: best[hillId] };
}
