// Haamuhyppääjä: ennätyshypyn rata nauhoitetaan ja toistetaan seuraavissa hypyissä.
// Hyppyä ei voi toistaa ohjauksesta, koska tuuli ja pyörteet arvotaan joka kerta uudelleen:
// siksi talteen otetaan itse rata. Ei riipu DOMista.

export const GHOST = {
  rate: 30,     // näytteitä sekunnissa
  tail: 1.2,    // alastulon jälkeen nauhoitetaan vielä näin kauan (s)
  fade: 0.5,    // haamu häipyy nauhan lopussa tässä ajassa (s)
  alpha: 0.42,  // haamun peittävyys
};

// Asennot tallennetaan numeroina. Kaatunut hyppy ei kelpaa ennätykseksi, joten sen asentoja ei tarvita.
const POSES = ['crouch', 'extend', 'flight', 'prep', 'telemark', 'twofoot', 'outrun'];

const round = (v, digits) => Math.round(v * digits) / digits;

/** Tyhjä nauha: {dt, x, y (m), a = suksien kulma (rad), p = asennon numero}. Tallentuu sellaisenaan JSONiksi. */
export function newTrack() {
  return { dt: 1 / GHOST.rate, x: [], y: [], a: [], p: [] };
}

/** Lisää näytteen, kun edellisestä on kulunut nauhan aika-askel. t = aika puomilta lähdöstä. */
export function recordTrack(track, t, jump) {
  if (t < track.x.length * track.dt - 1e-9) return;
  track.x.push(round(jump.x, 100));
  track.y.push(round(jump.y, 100));
  track.a.push(round(jump.pitch, 1000));
  track.p.push(Math.max(0, POSES.indexOf(jump.pose)));
}

/** Onko tallennettu nauha käyttökelpoinen (esim. vanha tai katkennut tallennus ei ole). */
export function validTrack(track) {
  const n = track?.x?.length;
  return n >= 2 && track.dt > 0 && track.y?.length === n && track.a?.length === n && track.p?.length === n;
}

/**
 * Haamun tila hetkellä t (s puomilta lähdöstä): {x, y, pitch, pose, alpha} tai null, kun nauha on loppu.
 * Paikka ja kulma interpoloidaan näytteiden väliltä.
 */
export function sampleTrack(track, t) {
  const n = track.x.length, end = (n - 1) * track.dt;
  if (t < 0 || t >= end) return null;
  const f = t / track.dt, i = Math.floor(f), k = f - i;
  const mix = (arr) => arr[i] + (arr[i + 1] - arr[i]) * k;
  return {
    x: mix(track.x),
    y: mix(track.y),
    pitch: mix(track.a),
    pose: POSES[track.p[i]] ?? POSES[0],
    alpha: Math.min(1, (end - t) / GHOST.fade),
  };
}
