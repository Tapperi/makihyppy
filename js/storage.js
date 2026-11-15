// Pieni kääre localStoragelle. Vaiheessa 2 kauden tallennus tulee tänne.

const KEY = 'tuulimaki.v1';

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

/** Mäkikohtainen ennätys: {distance, total} tai null. */
export function getBest(hillId) {
  return read().best?.[hillId] ?? null;
}

/** Päivittää ennätykset. Palauttaa {distanceRecord, pointsRecord}. */
export function recordJump(hillId, result) {
  const data = read();
  data.best ??= {};
  const prev = data.best[hillId] ?? { distance: 0, total: 0 };
  const valid = result.outcome !== 'fall'; // kaatunut hyppy ei kelpaa pituusennätykseksi
  const distanceRecord = valid && result.distance > prev.distance;
  const pointsRecord = result.total > prev.total;
  data.best[hillId] = {
    distance: distanceRecord ? result.distance : prev.distance,
    total: pointsRecord ? result.total : prev.total,
  };
  write(data);
  return { distanceRecord, pointsRecord, best: data.best[hillId] };
}
