// Tavoitteet: oma ennätys ja tulostaulun kilpailijat rinteen viivoina ja tulospaneelin eroina.
// Puhtaita funktioita – ei DOMia eikä verkkoa.

const fmt = (v) => v.toFixed(1).replace('.', ',');

/**
 * Tulostaulu järjestetään pisteillä, mutta viiva piirretään pituuteen. Viiva olettaa siistin
 * telemark-hypyn näillä tuomaripisteillä: huonommalla tyylillä pitää hypätä viivaa pidemmälle.
 */
export const TARGET_JUDGE = 19;

const MIN_LINE = 40;       // tätä lyhyempiä tavoitteita ei piirretä (m)
const LINE_PAST_HS = 16;   // eikä näin paljon mäen koon yli meneviä (etäisyysmerkit loppuvat siihen)

/** Lyhin puolen metrin tarkkuudella mitattu pituus, jolla pisteet ylittävät annetun summan. */
export function distanceFor(hill, total) {
  const exact = hill.k + (total - TARGET_JUDGE * 3 - 60) / hill.def.pointsPerMeter;
  return Math.floor(exact * 2 + 1e-6) / 2 + 0.5;
}

/**
 * Pelaajan edellä olevat: {leader, next}, kumpikin {name, total, rank} tai null.
 * next = lähin edellä oleva, leader = taulun kärki (sama olio, jos edellä on vain yksi).
 * @param top      tulostaulun rivit parhaasta alkaen [{name, total}] tai null
 * @param myTotal  pelaajan paras pistemäärä (0 = ei tulosta)
 */
export function findRivals(top, myName, myTotal) {
  const ahead = (top ?? [])
    .filter((e) => e.name !== myName)
    .map((e, i) => ({ name: e.name, total: e.total, rank: i + 1 }))
    .filter((e) => e.total > myTotal);
  return { leader: ahead[0] ?? null, next: ahead[ahead.length - 1] ?? null };
}

/**
 * Rinteeseen piirrettävät tavoiteviivat: [{d, kind: 'own' | 'next' | 'leader', label}].
 * @param best  oma ennätys {distance, total} tai null
 */
export function hillTargets(hill, best, top, myName) {
  const lines = [];
  if (best?.distance > 0) lines.push({ d: best.distance, kind: 'own', label: `ENNÄTYS ${fmt(best.distance)}` });
  const { leader, next } = findRivals(top, myName, best?.total ?? 0);
  const add = (rival, kind, label) => {
    const d = distanceFor(hill, rival.total);
    if (d >= MIN_LINE && d <= hill.hs + LINE_PAST_HS) lines.push({ d, kind, label: `${label} · ${rival.name}` });
  };
  if (next && next !== leader) add(next, 'next', `SIJA ${next.rank}`);
  if (leader) add(leader, 'leader', 'KÄRKI');
  return lines;
}

/** Tulospaneelin rivi: kuinka paljon lähimpään edellä olevaan on matkaa. Tyhjä, jos ei tiedetä. */
export function rivalGap(top, myName, myTotal) {
  if (!top?.length) return '';
  const { next } = findRivals(top, myName, myTotal);
  if (!next) return top.some((e) => e.name === myName) ? 'Johdat tulostaulua.' : '';
  const gap = fmt(Math.max(0.1, next.total - myTotal));
  return next.rank === 1
    ? `Kärkeen (${next.name}) on matkaa ${gap} p.`
    : `Sijaan ${next.rank} (${next.name}) on matkaa ${gap} p.`;
}
