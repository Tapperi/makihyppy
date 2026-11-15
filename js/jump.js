// Yhden hypyn tilakone: lähtöpuomi -> vauhtimäki -> lento -> liuku -> valmis.
// Ei riipu DOMista eikä piirrosta: ohjaus annetaan step()-kutsulle, joten samaa
// luokkaa voi ajaa ihmispelaaja, testibotti tai (vaiheessa 2) tietokonevastustaja.

import { G, INRUN, TAKEOFF, FLIGHT, LANDING, GATE_TIME, WIND, BAND } from './config.js';
import { clamp, lerp, randn } from './util.js';
import { inrunAccel, takeoffQuality, lateTakeoffQuality, flightAccel, slideAccel } from './physics.js';
import { scoreJump, Outcome } from './scoring.js';

export const Phase = {
  READY: 'ready',     // puomilla, odottaa lähtöä
  INRUN: 'inrun',
  FLIGHT: 'flight',
  SLIDE: 'slide',     // alastulon jälkeinen liuku
  DONE: 'done',
};

export class Jump {
  /**
   * @param hill  createHill()-olio
   * @param wind  Wind-olio (päivitetään täältä, jotta tuuli ja hyppy pysyvät samassa ajassa)
   * @param rng   satunnaislukufunktio
   */
  constructor(hill, wind, rng) {
    this.hill = hill;
    this.wind = wind;
    this.rng = rng;
    this.reset();
  }

  reset() {
    const hill = this.hill;
    this.wind.reset();
    this.phase = Phase.READY;
    this.t = 0;                 // aika nykyisen vaiheen alusta
    this.gateLeft = GATE_TIME;
    this.d = hill.inrunLength;  // etäisyys nokalle rataa pitkin
    this.s = 0;                 // etäisyys rinnettä pitkin (liu'ussa)
    this.speed = 0;
    const p = hill.inrunPos(this.d);
    this.x = p.x; this.y = p.y;
    this.vx = 0; this.vy = 0;
    this.pitch = -p.angle;      // suksien kulma vaakatasosta
    this.omega = 0;
    this.posture = 0;           // 0 pysty, 1 lentoasento
    this.aoa = 0;
    this.bandCenter = 0;        // vihreän kaistan keskikohta suhteessa FLIGHT.aoaOpt:iin (rad)
    this.bandHalf = BAND.widthCalm * BAND.range; // kaistan puolileveys (rad)
    this.bandError = 0;         // 0..1: osoittimen etäisyys kaistasta
    this.balance = 0;           // kyykkyasennon osoitin -1..1 (+ = asento nousee)
    this.balanceVel = 0;
    this.balanceError = 0;      // 0..1: osoittimen etäisyys vihreästä kaistasta
    this.swayPhase = this.rng() * Math.PI * 2;
    this.height = 0;            // korkeus rinteestä
    this.maxSpeed = 0;
    this.takeoffSpeed = 0;
    this.takeoff = { pressed: false, at: null, quality: 0, late: false };
    this.landPrep = false;
    this.landPrepT = 0;
    this.aoaErrSum = 0;
    this.aoaErrTime = 0;
    this.outcome = null;
    this.touchdown = null;      // {x, y, distance, impact}
    this.result = null;
    this.pose = 'gate';
    this.fallS = 0;             // kaatumiskohta rinnettä pitkin
    this.snow = 0;              // 0..1: kaatuneen hyppääjän keräämä lumi
    this.ballRadius = 0;        // lumipallon säde (m)
    this.roll = 0;              // pyörimiskulma (rad)
  }

  /**
   * @param dt     aika-askel
   * @param input  {action: boolean (painallus tällä askeleella), lean: -1..1 (+ = eteen)}
   */
  step(dt, input) {
    this.wind.update(dt);
    this.t += dt;
    switch (this.phase) {
      case Phase.READY: this.stepReady(dt, input); break;
      case Phase.INRUN: this.stepInrun(dt, input); break;
      case Phase.FLIGHT: this.stepFlight(dt, input); break;
      case Phase.SLIDE: this.stepSlide(dt); break;
    }
  }

  setPhase(phase) {
    this.phase = phase;
    this.t = 0;
  }

  // --- Lähtöpuomi ---
  stepReady(dt, input) {
    this.gateLeft -= dt;
    if (input.action || this.gateLeft <= 0) {
      this.setPhase(Phase.INRUN);
      this.pose = 'crouch';
    }
  }

  // --- Vauhtimäki ---
  stepInrun(dt, input) {
    const hill = this.hill;
    const angle = hill.inrunPos(this.d).angle;
    this.updateBalance(dt, input);
    this.speed = Math.max(0, this.speed + inrunAccel(this.speed, angle, this.wind.value, this.balanceError) * dt);
    this.d -= this.speed * dt;

    if (input.action && !this.takeoff.pressed && this.d <= TAKEOFF.zone) {
      this.takeoff.pressed = true;
      this.takeoff.at = this.d;
      this.takeoff.quality = takeoffQuality(this.d);
      this.pose = 'extend';
    }

    if (this.d <= 0) {
      this.launch();
      return;
    }
    const p = hill.inrunPos(this.d);
    this.x = p.x; this.y = p.y;
    this.pitch = -p.angle;
    this.vx = Math.cos(p.angle) * this.speed;
    this.vy = -Math.sin(p.angle) * this.speed;
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
  }

  /**
   * Kyykkyasennon tasapaino. Suoralla osoitin huojuu hitaasti; siirtymäkaaressa
   * paine (v²/R) nostaa asentoa ja pelaajan pitää nojata eteen pysyäkseen kaistalla.
   */
  updateBalance(dt, input) {
    const gLoad = this.speed * this.speed * this.hill.inrunCurvature(this.d) / G;
    const sway = INRUN.swayAmp * Math.sin(this.swayPhase + (this.t / INRUN.swayPeriod) * Math.PI * 2);
    const turb = INRUN.balanceTurb * Math.sqrt(dt) * randn(this.rng);
    this.balanceVel += (-clamp(input.lean, -1, 1) * INRUN.balanceAccel + INRUN.curvePush * gLoad + sway
      - this.balanceVel * INRUN.balanceDamp) * dt + turb;
    this.balance += this.balanceVel * dt;
    if (Math.abs(this.balance) >= 1) {
      this.balance = Math.sign(this.balance);
      this.balanceVel = 0;
    }
    this.balanceError = clamp((Math.abs(this.balance) - INRUN.balanceHalf) / INRUN.balanceErrFull, 0, 1);
  }

  launch() {
    const a = this.hill.def.tableAngle;
    const over = -this.d; // nokan yli tällä askeleella kuljettu matka
    this.takeoffSpeed = this.speed;
    this.vx = Math.cos(a) * this.speed;
    this.vy = -Math.sin(a) * this.speed;
    this.x = Math.cos(a) * over;
    this.y = -Math.sin(a) * over;
    this.pitch = -a;
    this.omega = 0;
    this.d = 0;
    this.setPhase(Phase.FLIGHT);
    // Perusponnistus tulee aina; ajoituksen osuus lisätään painalluksesta
    this.applyImpulse(TAKEOFF.baseShare);
    if (this.takeoff.pressed) this.applyImpulse((1 - TAKEOFF.baseShare) * this.takeoff.quality);
    this.pose = 'flight';
    this.updateBand(0);
  }

  /** Tuuli siirtää ja kaventaa vihreää kaistaa. dt = 0 asettaa kaistan heti kohdalleen. */
  updateBand(dt) {
    const w = this.wind.value;
    const strength = clamp(Math.abs(w) / WIND.max, 0, 1);
    const center = -w * BAND.shiftPerMs;
    const half = lerp(BAND.widthCalm, BAND.widthWindy, strength) * BAND.range;
    const k = dt > 0 ? 1 - Math.exp(-dt * BAND.follow) : 1;
    this.bandCenter += (center - this.bandCenter) * k;
    this.bandHalf += (half - this.bandHalf) * k;
  }

  applyImpulse(q) {
    const a = this.hill.def.tableAngle;
    this.vx += Math.sin(a) * TAKEOFF.impulse * q;
    this.vy += Math.cos(a) * TAKEOFF.impulse * q;
  }

  // --- Lento ---
  stepFlight(dt, input) {
    const hill = this.hill;
    const wind = this.wind.value;

    if (input.action) {
      if (!this.takeoff.pressed && this.t <= TAKEOFF.lateTime) {
        // Myöhästynyt ponnistus: heikko, mutta parempi kuin ei mitään
        this.takeoff.pressed = true;
        this.takeoff.late = true;
        this.takeoff.at = -this.speed * this.t;
        this.takeoff.quality = lateTakeoffQuality(this.t);
        this.applyImpulse((1 - TAKEOFF.baseShare) * this.takeoff.quality);
      } else if (!this.landPrep && this.t >= FLIGHT.landArmTime) {
        this.landPrep = true;
        this.landPrepT = this.t;
        this.pose = 'prep';
      }
    }

    // Asento: lentoasentoon ponnistuksen jälkeen, pystyyn alastuloa varten
    if (this.landPrep) {
      this.posture = Math.max(0, this.posture - dt / FLIGHT.prepTime);
    } else {
      const rise = FLIGHT.postureTime + (1 - this.takeoff.quality) * FLIGHT.postureSlow;
      this.posture = Math.min(1, this.posture + dt / rise);
    }

    // Suksien kulma: pelaajan ohjaus + tuulen pyörteet. Trimmi ei seuraa kaistaa:
    // kun tuuli siirtää kaistaa, pelaajan pitää itse ohjata perässä.
    const turb = (FLIGHT.turbBase + FLIGHT.turbWind * Math.abs(wind)) * Math.sqrt(dt) * randn(this.rng);
    const trim = (FLIGHT.trimAoa - this.aoa) * FLIGHT.trimRate * this.posture;
    this.omega += (-clamp(input.lean, -1, 1) * FLIGHT.pitchAccel + trim - this.omega * FLIGHT.pitchDamp) * dt + turb;
    this.pitch += this.omega * dt;
    if (this.landPrep) {
      // Sukset kääntyvät itsestään rinteen suuntaisiksi
      const target = -hill.slopeAtX(this.x);
      this.pitch += (target - this.pitch) * (1 - Math.exp(-dt * 9));
      this.omega *= Math.exp(-dt * 10);
    } else if (this.t < FLIGHT.entryTime) {
      // Ponnistuksen jälkeinen kiertyminen lentoasentoon
      this.pitch += (FLIGHT.entryPitch - this.pitch) * (1 - Math.exp(-dt * 8));
    }
    this.pitch = clamp(this.pitch, -FLIGHT.pitchLimit, FLIGHT.pitchLimit);

    this.updateBand(dt);
    const aoaOpt = FLIGHT.aoaOpt + this.bandCenter;
    const acc = flightAccel(this.vx, this.vy, this.pitch, this.posture, wind, this.bandCenter, this.bandHalf);
    this.aoa = acc.aoa;
    const off = Math.abs(this.aoa - aoaOpt);
    this.bandError = this.landPrep ? 0 : clamp((off - this.bandHalf) / BAND.errFull, 0, 1);
    this.vx += acc.ax * dt;
    this.vy += acc.ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.speed = Math.hypot(this.vx, this.vy);

    // Tyylipisteitä varten: poikkeama parhaasta kohtauskulmasta varsinaisen liidon aikana
    if (!this.landPrep && this.t > FLIGHT.entryTime + 0.3) {
      this.aoaErrSum += off * dt;
      this.aoaErrTime += dt;
    }

    const ground = hill.groundY(this.x);
    this.height = this.y - ground;
    if (this.height <= 0) this.land(ground);
  }

  land(ground) {
    const hill = this.hill;
    const slope = hill.slopeAtX(this.x);
    const tx = Math.cos(slope), ty = -Math.sin(slope);
    const along = this.vx * tx + this.vy * ty;
    const impact = -(this.vx * -ty + this.vy * tx); // nopeus rinnettä vastaan kohtisuoraan

    const prepTime = this.landPrep ? this.t - this.landPrepT : 0;
    let outcome;
    if (!this.landPrep || impact > LANDING.fallImpact) outcome = Outcome.FALL;
    else if (prepTime < LANDING.prepMin || impact > LANDING.hardImpact) outcome = Outcome.TWOFOOT;
    else outcome = Outcome.TELEMARK;

    this.y = ground;
    this.height = 0;
    this.s = hill.distAtX(this.x);
    this.fallS = this.s;
    const distance = Math.round(this.s * 2) / 2;
    this.speed = Math.max(0, along);
    this.pitch = -slope;
    this.posture = 0;
    this.bandError = 0;
    this.outcome = outcome;
    this.touchdown = { x: this.x, y: this.y, distance, impact };
    this.result = scoreJump(hill, {
      distance,
      outcome,
      prepTime,
      impact,
      avgAoaError: this.aoaErrTime > 0 ? this.aoaErrSum / this.aoaErrTime : 0,
    });
    this.result.takeoffQuality = this.takeoff.quality;
    this.result.takeoffSpeed = this.takeoffSpeed;
    this.pose = outcome;
    this.setPhase(Phase.SLIDE);
  }

  // --- Liuku ---
  stepSlide(dt) {
    const hill = this.hill;
    const p0 = hill.landingPos(this.s);
    const fell = this.outcome === Outcome.FALL;
    const braking = this.s > hill.brakeStart;
    const friction = fell ? (braking ? LANDING.ballBrake : LANDING.fallFriction)
      : braking ? LANDING.brakeFriction : LANDING.slideFriction;
    let a = slideAccel(this.speed, p0.angle, friction);
    if (fell) a -= LANDING.ballDrag * this.speed * this.speed;
    this.speed = Math.max(0, this.speed + a * dt);
    this.s = Math.min(this.s + this.speed * dt, hill.landingLength - 2);
    if (fell) {
      // Pyöriessään hyppääjä kerää lunta ja kasvaa lumipalloksi
      this.snow = clamp((this.s - this.fallS) / LANDING.ballGrow, 0, 1);
      this.ballRadius = LANDING.ballRadius * Math.pow(this.snow, 0.7);
      this.roll += (this.speed * dt) / Math.max(0.6, this.ballRadius);
    }
    const p = hill.landingPos(this.s);
    this.x = p.x; this.y = p.y;
    this.pitch = -p.angle;
    this.vx = Math.cos(p.angle) * this.speed;
    this.vy = -Math.sin(p.angle) * this.speed;
    if (!fell && this.t > 0.9) this.pose = 'outrun';
    if (this.speed < 0.3 && this.t > 1 || this.s >= hill.landingLength - 2.01) {
      this.speed = 0;
      this.setPhase(Phase.DONE);
    }
  }
}
