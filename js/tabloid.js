// Iltapulu: kaatumisen jälkeen näytettävän iltapäivälehden etusivun sisältö.
// Kaikki arvotaan – vammoilla ei ole vaikutusta peliin. Ei DOMia: ui.js näyttää tuloksen.

const QUOTES = [
  'Jokainen tsäänssi on mahdollisuus',
  'Elämä on laiffii',
  'Elämä on ihmisen parasta aikaa',
  'Se oli fifty-sixty',
  'V on tyylinä toimivin, sen tietää jokainen gimmakin',
];

const HEADLINES = {
  inrun: ['Kauhukaatuminen vauhtimäessä', 'Ei päässyt edes nokalle', 'Syöksyi ladulta {kmh} km/h', 'Kyykky petti – tuli rumaa jälkeä'],
  flight: ['Putosi taivaalta', 'Mäkikotka syöksyi hankeen', 'Lento päättyi rysähdykseen', 'Tuli alas kuin kivi'],
  landing: ['Alastulo meni pieleen', 'Pyöri lumipallona alas', 'Telemark jäi haaveeksi', 'Rinne voitti tämän erän'],
};

const KICKERS = ['Kauhun hetket Tuulivaarassa', 'Iltapulu paikalla', 'Katsojat kirkuivat', 'Karmea rysähdys', 'Tätä et halua nähdä'];

const STRAPS = [
  'Lääkäri: ”Hyppää taas ensi viikolla”',
  'Silminnäkijä: ”Kuului vain rusahdus”',
  'Valmentaja: ”Tyylipisteet taisivat mennä”',
  'Äiti: ”Minähän sanoin”',
  'Ensihoitaja: ”Kerättiin osat pussiin”',
  'Tuomari: ”Annoin silti yhdeksän”',
  'Hyppääjä itse: ”Tuuli oli väärä”',
];

const CAPTIONS = ['Kuva: Iltapulun lukija', 'Kuva: valvontakamera', 'Kuva: järkyttynyt katsoja', 'Kuva: makkarakojun myyjä'];

// [teksti, murtuneiden luiden määrä]; {n} korvataan arvotulla luvulla väliltä [min, max]
const BONES = [
  ['{n} kylkiluuta poikki', 3, 9],
  ['{n} sormea murtunut', 2, 7],
  ['{n} varvasta murtunut', 2, 6],
  ['Reisiluu poikki kahdesta kohdasta', 1],
  ['Sääriluu kolmessa osassa', 1],
  ['Solisluu murtunut', 1],
  ['Molemmat ranteet murtuneet', 2],
  ['Häntäluu murskana', 1],
  ['Nenä murtunut – taas', 1],
  ['Kyynärpää sirpaleina', 1],
  ['Lantio murtunut', 1],
  ['Poskiluu lommolla', 1],
];

const SOFT = [
  'Sisäinen verenvuoto',
  'Perna revennyt',
  'Keuhko puhjennut',
  'Aivotärähdys',
  'Munuainen ruhjeilla',
  'Olkapää sijoiltaan',
  'Leuka sijoiltaan',
  'Polven ristiside poikki',
  'Maksa mustelmilla',
  'Akillesjänne poikki',
];

const TEETH = ['{n} hammasta irti', '{n} hammasta irti ({m} löytyi hangesta)', '{n} hammasta kateissa', 'Etuhampaat ({n} kpl) jäivät rinteeseen'];

const GAGS = [
  'Ylpeys: menehtyi paikan päällä',
  'Itsetunto: kriittinen mutta vakaa',
  'Sukset: yhä kateissa',
  'Muisti: ei muista hypänneensä',
  'Kypärä: säilyi ehjänä',
  'Hyppypuku: korjauskelvoton',
  'Sponsorisopimus: purettu',
];

/**
 * @param info {kind: 'inrun' | 'flight' | 'landing', kmh, hits (iskujen määrä), name (tai null)}
 * @param rng  satunnaislukufunktio [0, 1)
 * @returns {date, kicker, who, headline, caption, burst, injuries: string[], strap, quote}
 */
export function makeTabloid(info, rng = Math.random) {
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(rng() * list.length)];
  /** Arpoo listasta n eri alkiota. */
  const sample = (list, n) => {
    const pool = [...list], out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  };

  // Mitä useampi isku, sitä pidempi lista
  const rough = Math.min(1, (info.hits || 0) / 12);
  let broken = 0;
  const bones = sample(BONES, 2 + Math.round(rough * 2) + int(0, 1)).map(([text, lo, hi]) => {
    const n = hi ? int(lo, hi) : lo;
    broken += n;
    return text.replace('{n}', n);
  });
  const teeth = int(1, 9);
  const injuries = [
    ...bones,
    pick(TEETH).replace('{n}', teeth).replace('{m}', int(0, teeth - 1)),
    ...sample(SOFT, 1 + Math.round(rough) + int(0, 1)),
    pick(GAGS),
  ];

  return {
    date: new Date().toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }),
    kicker: pick(KICKERS),
    who: info.name ? `Mäkihyppääjä ${info.name}` : 'Tuntematon mäkihyppääjä',
    headline: pick(HEADLINES[info.kind] ?? HEADLINES.landing).replace('{kmh}', Math.round(info.kmh || 0)),
    caption: pick(CAPTIONS),
    burst: `${broken} luuta poikki!`,
    injuries,
    strap: pick(STRAPS),
    quote: pick(QUOTES),
  };
}
