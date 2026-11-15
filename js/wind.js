// Tuulimalli: hidas aaltoilu + nopeampi vaihtelu + satunnaiset puuskat.
// value > 0 = vastatuuli (puhaltaa hyppääjää vastaan, kantaa pidemmälle),
// value < 0 = myötätuuli.

import { WIND } from './config.js';
import { clamp, lerp, randn } from './util.js';

export class Wind {
  constructor(rng) {
    this.rng = rng;
    this.history = [];      // viimeisimmät arvot tuulikäyrää varten
    this.historyStep = 0.1; // s
    this.reset();
  }

  /** Arpoo uudet olosuhteet (kutsutaan jokaisen hypyn alussa). */
  reset() {
    const r = this.rng;
    this.t = 0;
    this.base = (r() * 2 - 1) * WIND.baseRange;
    this.phase1 = r() * Math.PI * 2;
    this.phase2 = r() * Math.PI * 2;
    this.gust = 0;
    this.burst = null;      // käynnissä oleva puuska {lead, dur, age, amp}
    this.burstValue = 0;    // puuskan osuus tuulesta (m/s)
    this.gustLevel = 0;     // 0..1: puuskan voimakkuus juuri nyt
    this.gustAlert = 0;     // 0..1: kuten gustLevel, mutta nousee jo ennakkovaroituksen aikana
    this.nextBurst = this.burstGap();
    this.sinceSample = 0;
    this.history.length = 0;
    this.value = this.compute();
  }

  compute() {
    const w = this.base
      + WIND.slowAmp * Math.sin((this.t / WIND.slowPeriod) * Math.PI * 2 + this.phase1)
      + WIND.fastAmp * Math.sin((this.t / WIND.fastPeriod) * Math.PI * 2 + this.phase2)
      + this.gust + this.burstValue;
    return clamp(w, -WIND.max, WIND.max);
  }

  burstGap() {
    return WIND.burstMinGap - Math.log(Math.max(this.rng(), 1e-9)) * (WIND.burstEvery - WIND.burstMinGap);
  }

  /** Erilliset puuskat: varoitus -> nousu -> tasanne -> lasku. */
  updateBurst(dt) {
    const r = this.rng;
    if (!this.burst) {
      this.nextBurst -= dt;
      if (this.nextBurst > 0) return;
      this.burst = {
        lead: WIND.burstLead,
        dur: lerp(WIND.burstMin, WIND.burstMax, r()),
        age: 0,
        amp: (r() < 0.5 ? -1 : 1) * lerp(WIND.burstAmpMin, WIND.burstAmpMax, r()),
      };
    }
    const b = this.burst;
    if (b.lead > 0) {
      b.lead -= dt;
      this.gustAlert = clamp(1 - b.lead / WIND.burstLead, 0, 1);
      return;
    }
    b.age += dt;
    if (b.age >= b.dur) {
      this.burst = null;
      this.burstValue = 0; this.gustLevel = 0; this.gustAlert = 0;
      this.nextBurst = this.burstGap();
      return;
    }
    const u = b.age / b.dur;
    const e = clamp(Math.min(u, 1 - u) / 0.3, 0, 1);
    this.gustLevel = e * e * (3 - 2 * e);
    this.gustAlert = u < 0.5 ? 1 : this.gustLevel;
    this.burstValue = b.amp * this.gustLevel;
  }

  update(dt) {
    this.t += dt;
    this.updateBurst(dt);
    // Ornstein–Uhlenbeck-puuska: palautuu nollaan, saa satunnaisia sysäyksiä
    this.gust += -this.gust * WIND.gustRate * dt + WIND.gustSigma * Math.sqrt(dt) * randn(this.rng);
    this.value = this.compute();

    this.sinceSample += dt;
    if (this.sinceSample >= this.historyStep) {
      this.sinceSample = 0;
      this.history.push(this.value);
      if (this.history.length > 80) this.history.shift();
    }
  }
}
