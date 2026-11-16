// Haamuhyppääjän radan tarkistus. Rata on pelin js/ghost.js:n nauha:
//   {dt, x, y (m), a = suksien kulma (rad), p = asennon numero}
// Palvelin ei voi todentaa, että rata vastaa tulosta – se varmistaa vain, että muoto ja
// arvot ovat järkeviä, jotta rata on turvallista tallentaa ja jakaa muille pelaajille.

const MIN_SAMPLES = 30;     // 1 s
const MAX_SAMPLES = 900;    // 30 s pelin näytetaajuudella
const POSES = 7;            // pidä samana kuin pelin js/ghost.js:n POSES-listan pituus
const MAX_COORD = 500;      // m, reilusti mäkeä isompi

const round = (v, digits) => Math.round(v * digits) / digits;

/** Palauttaa radan tallennettavana JSON-tekstinä tai null, jos rata puuttuu tai ei kelpaa. */
export function cleanGhost(g) {
  if (!g || typeof g !== 'object') return null;
  const { dt, x, y, a, p } = g;
  if (typeof dt !== 'number' || !(dt >= 1 / 60 && dt <= 0.1)) return null;
  if (![x, y, a, p].every(Array.isArray)) return null;
  const n = x.length;
  if (n < MIN_SAMPLES || n > MAX_SAMPLES || y.length !== n || a.length !== n || p.length !== n) return null;
  const within = (arr, max) => arr.every((v) => typeof v === 'number' && Math.abs(v) <= max); // NaN ei läpäise
  if (!within(x, MAX_COORD) || !within(y, MAX_COORD) || !within(a, Math.PI)) return null;
  if (!p.every((v) => Number.isInteger(v) && v >= 0 && v < POSES)) return null;
  // Hyppääjä kulkee koko ajan eteenpäin ja päätyy nokan (x = 0) ohi
  for (let i = 1; i < n; i++) if (x[i] < x[i - 1] - 0.01) return null;
  if (x[0] >= 0 || x[n - 1] <= 0) return null;
  return JSON.stringify({
    dt,
    x: x.map((v) => round(v, 100)),
    y: y.map((v) => round(v, 100)),
    a: a.map((v) => round(v, 1000)),
    p,
  });
}
