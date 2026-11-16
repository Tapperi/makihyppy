// Tuulimalli: kauden tuulikuvio + pieni hyppykohtainen vaihtelu.
// value > 0 = vastatuuli (puhaltaa hyppääjää vastaan, kantaa pidemmälle),
// value < 0 = myötätuuli.
//
// Kuvio on WIND.loop sekunnin saumaton silmukka: kauden keskituuli, jonka voimakkuutta
// hidas ja nopea aalto sekä muutama puuska heiluttavat. Tuuli voi tyyntyä, mutta suunta
// ei käänny. Kuvio lasketaan siemenestä (kausi + mäki), joten se on kaikille sama.
// Hyppy alkaa satunnaisesta kohdasta silmukkaa; hyppykohtaista arpaa ovat vain kohina
// ja puuskien pieni heilunta.

import { WIND } from './config.js';
import { clamp, lerp, randn, makeRng } from './util.js';

const TAU = Math.PI * 2;
const wrap = (t) => ((t % WIND.loop) + WIND.loop) % WIND.loop;

/** Kuvion siemen kaudesta ja mäestä (FNV-1a). */
export function seasonSeed(season, hillId) {
  let h = 0x811c9dc5;
  for (const ch of `${season}:${hillId}`) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193);
  return h >>> 0;
}

/** Kauden tuulikuvio mäelle: siemen kaudesta ja mäestä, suunta ja voimakkuus WIND.seasons-taulusta jos annettu. */
export function seasonPattern(season, hillId) {
  return makePattern(seasonSeed(season, hillId), WIND.seasons[season]);
}

/**
 * Tuulikuvio: {dir, strength, phase1, phase2, bursts: [{at, dur, amp}]}.
 * dir = 1 vastatuuli / -1 myötätuuli (ei vaihdu kuvion aikana), strength = keskituuli (m/s),
 * burst.at = ennakkovaroituksen alku, burst.amp > 0 voimistaa tuulta ja < 0 tyynnyttää.
 * @param preset  {dir, strength} ohittaa arvotut
 */
export function makePattern(seed, preset = {}) {
  const r = makeRng(seed);
  const dir = r() < WIND.headChance ? 1 : -1;
  const strength = lerp(WIND.strengthMin, WIND.strengthMax, r());
  const pattern = {
    dir: preset.dir ?? dir,
    strength: preset.strength ?? strength,
    phase1: r() * TAU,
    phase2: r() * TAU,
    bursts: [],
  };
  // Yksi puuska per lohko: puuskat eivät mene päällekkäin eivätkä silmukan sauman yli
  const slot = WIND.loop / WIND.burstCount;
  const room = slot - WIND.burstLead - WIND.burstMax - WIND.burstMinGap;
  for (let i = 0; i < WIND.burstCount; i++) {
    pattern.bursts.push({
      at: i * slot + WIND.burstMinGap / 2 + r() * room,
      dur: lerp(WIND.burstMin, WIND.burstMax, r()),
      amp: (r() < 0.5 ? -1 : 1) * lerp(WIND.burstAmpMin, WIND.burstAmpMax, r()),
    });
  }
  // Jokaisessa kuviossa on sekä voimistuva että tyyntyvä puuska
  const bs = pattern.bursts;
  if (bs.length > 1 && bs.every((b) => b.amp > 0 === bs[0].amp > 0)) bs[bs.length - 1].amp *= -1;
  return pattern;
}

/**
 * Kuvion tila kohdassa pos: {wind, level, alert, burst}. Puuska: varoitus -> nousu -> tasanne -> lasku.
 * Tuulen voimakkuus ei mene nollan alle: tuuli voi tyyntyä, mutta suunta ei käänny.
 * @param jitter  hyppykohtainen heilunta puuskittain [{amp, time}] (puuttuu = puhdas kuvio)
 * @param noise   hyppykohtainen kohina voimakkuuteen (m/s)
 */
export function patternAt(pattern, pos, jitter, noise = 0) {
  const u = wrap(pos) / WIND.loop;
  const calm = pattern.strength * (1
    + WIND.slowAmp * Math.sin(u * WIND.slowCycles * TAU + pattern.phase1)
    + WIND.fastAmp * Math.sin(u * WIND.fastCycles * TAU + pattern.phase2));
  let level = 0, alert = 0, burst = 0;
  for (let i = 0; i < pattern.bursts.length; i++) {
    const b = pattern.bursts[i], j = jitter?.[i];
    const local = wrap(pos - b.at - (j?.time ?? 0));
    if (local < WIND.burstLead) {
      alert = Math.max(alert, local / WIND.burstLead);
    } else if (local < WIND.burstLead + b.dur) {
      const v = (local - WIND.burstLead) / b.dur;
      const e = clamp(Math.min(v, 1 - v) / 0.3, 0, 1);
      const lvl = e * e * (3 - 2 * e);
      level = Math.max(level, lvl);
      alert = Math.max(alert, v < 0.5 ? 1 : lvl);
      burst += b.amp * (1 + (j?.amp ?? 0)) * lvl;
    }
  }
  const mag = clamp(calm + burst + noise, 0, WIND.max);
  return { wind: pattern.dir * mag, level, alert, burst: pattern.dir * (mag - clamp(calm + noise, 0, WIND.max)) };
}

export class Wind {
  /**
   * @param rng   hyppykohtainen satunnaisuus (aloituskohta, kohina, puuskien heilunta)
   * @param pattern  tuulikuvio, ks. seasonPattern() / makePattern()
   */
  constructor(rng, pattern = makePattern(0)) {
    this.rng = rng;
    this.pattern = pattern;
    this.history = [];      // viimeisimmät arvot tuulikäyrää varten
    this.historyStep = 0.1; // s
    this.reset();
  }

  /**
   * Uusi hyppy: sama kuvio, uusi aloituskohta ja pieni vaihtelu.
   * @param pos  aloituskohta silmukassa (s); oletuksena arvotaan
   */
  reset(pos) {
    const r = this.rng;
    this.t = 0;
    this.pos = wrap(pos ?? r() * WIND.loop);
    this.jitter = this.pattern.bursts.map(() => ({
      amp: (r() * 2 - 1) * WIND.burstAmpJitter,
      time: (r() * 2 - 1) * WIND.burstTimeJitter,
    }));
    this.gust = 0;
    this.sinceSample = 0;
    this.history.length = 0;
    this.compute();
  }

  compute() {
    const p = patternAt(this.pattern, this.pos, this.jitter, this.gust);
    this.burstValue = p.burst;  // puuskan osuus tuulesta (m/s)
    this.gustLevel = p.level;   // 0..1: puuskan voimakkuus juuri nyt
    this.gustAlert = p.alert;   // 0..1: kuten gustLevel, mutta nousee jo ennakkovaroituksen aikana
    this.value = p.wind;
  }

  update(dt) {
    this.t += dt;
    this.pos = wrap(this.pos + dt);
    // Ornstein–Uhlenbeck-kohina: palautuu nollaan, saa satunnaisia sysäyksiä
    this.gust += -this.gust * WIND.gustRate * dt + WIND.gustSigma * Math.sqrt(dt) * randn(this.rng);
    this.compute();

    this.sinceSample += dt;
    if (this.sinceSample >= this.historyStep) {
      this.sinceSample = 0;
      this.history.push(this.value);
      if (this.history.length > 80) this.history.shift();
    }
  }
}
