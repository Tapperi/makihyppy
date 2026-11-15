// Yhden hypyn tilakone: lähtöpuomi -> vauhtimäki -> lento -> liuku -> valmis.
// Vauhtimäestä ja lennosta voi myös päätyä kaatumiseen (CRASH), jos asento pettää.
// Ei riipu DOMista eikä piirrosta: ohjaus annetaan step()-kutsulle, joten samaa
// luokkaa voi ajaa ihmispelaaja, testibotti tai (vaiheessa 2) tietokonevastustaja.

import { G, INRUN, TAKEOFF, FLIGHT, LANDING, GATE_TIME, WIND, BAND, CRASH } from './config.js';
import { clamp, lerp, randn } from './util.js';
import { inrunAccel, takeoffQuality, lateTakeoffQuality, flightAccel, slideAccel } from './physics.js';
import { scoreJump, scoreInrunCrash, Outcome } from './scoring.js';

export const Phase = {
  READY: 'ready',     // puomilla, odottaa lähtöä
  INRUN: 'inrun',
  FLIGHT: 'flight',
  SLIDE: 'slide',     // alastulon jälkeinen liuku
  CRASH: 'crash',     // hallinta meni vauhtimäessä tai ilmassa: hyppääjä pomppii ja kierii alas
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
    this.roll = 0;              // pyörimiskulma (rad, ruudulla myötäpäivään = eteenpäin)
    this.danger = 0;            // 0..1: kaatumisvaara, kasvaa kun mittari on syvällä punaisella
    this.crash = null;          // 'inrun' | 'flight', kun hallinta on mennyt
    this.airborne = false;      // kaatunut hyppääjä on ilmassa (pomppujen välissä)
    this.spin = 0;              // pyörimisnopeus kaatuessa (rad/s)
    this.crashHits = 0;         // iskujen määrä (piirto seuraa tätä tehosteita varten)
    this.crashImpact = 0;       // viimeisimmän iskun voimakkuus (m/s)
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
      case Phase.CRASH: this.stepCrash(dt); break;
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
    // Ponnistuksen jälkeen kyykky on jo purettu: silloin ei enää kaaduta
    if (!this.takeoff.pressed && this.updateDanger(dt, this.balanceError, CRASH.inrunError, CRASH.inrunTime)) {
      this.startCrash('inrun');
      return;
    }
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

  /** Kasvattaa tai purkaa kaatumisvaaraa. Palauttaa true, kun hallinta menee. */
  updateDanger(dt, error, limit, time) {
    this.danger = clamp(this.danger + (error >= limit ? dt / time : -dt / CRASH.recover), 0, 1);
    return this.danger >= 1;
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
    this.danger = 0;
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
    if (this.height <= 0) {
      this.land(ground);
      return;
    }
    // Liian kauan liian kaukana kaistasta: hyppääjä menettää hallinnan ilmassa
    const risky = !this.landPrep && this.t > FLIGHT.entryTime + 0.3;
    const limit = this.bandHalf + (this.aoa < aoaOpt ? CRASH.flightFront : CRASH.flightBack);
    if (this.updateDanger(dt, risky ? off : 0, limit, CRASH.flightTime)) this.startCrash('flight');
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
    this.danger = 0;
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

  // --- Kaatuminen kesken suorituksen ---
  startCrash(kind) {
    const rng = this.rng;
    this.crash = kind;
    this.outcome = Outcome.FALL;
    this.pose = 'ragdoll';
    this.roll = -this.pitch;
    this.bandError = 0;
    this.balanceError = 0;
    this.posture = 0;
    this.danger = 0;
    this.airborne = true;
    if (kind === 'inrun') {
      // Kimpoaa ladusta ja jatkaa rataa alas. Paino edessä -> naamalleen, takana -> selälleen.
      const a = this.hill.inrunPos(this.d).angle;
      const v = this.speed * CRASH.inrunKeep;
      const pop = CRASH.inrunPop * (0.7 + 0.6 * rng());
      this.vx = Math.cos(a) * v + Math.sin(a) * pop;
      this.vy = -Math.sin(a) * v + Math.cos(a) * pop;
      this.spin = (this.balance < 0 ? 1 : -1) * (4 + 4 * rng());
      this.takeoffSpeed = this.speed;
      this.result = scoreInrunCrash();
      this.result.takeoffQuality = 0;
      this.result.takeoffSpeed = this.speed;
      this.hit(CRASH.inrunImpact);
    } else {
      // Kärjet liian alhaalla -> kiepsahtaa eteen, liian ylhäällä -> ilma kaataa selälleen
      this.spin = (this.aoa < FLIGHT.aoaOpt + this.bandCenter ? 1 : -1) * (5 + 4 * rng());
    }
    this.setPhase(Phase.CRASH);
  }

  hit(impact) {
    this.crashHits++;
    this.crashImpact = impact;
  }

  stepCrash(dt) {
    const hill = this.hill, C = CRASH, rng = this.rng;
    if (this.airborne) {
      const v = Math.hypot(this.vx, this.vy);
      this.vx -= C.airDrag * v * this.vx * dt;
      this.vy -= (G + C.airDrag * v * this.vy) * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.roll += this.spin * dt;
      this.speed = Math.hypot(this.vx, this.vy);
      const surf = hill.surfaceAt(this.x);
      if (this.y <= surf.y) this.crashLand(surf);
    } else {
      const a = hill.surfaceAt(this.x).angle;
      const braking = this.x > 0 && hill.distAtX(this.x) > hill.brakeStart;
      const mu = braking ? C.brakeFriction : C.friction;
      const s = Math.max(0, this.speed + (G * (Math.sin(a) - mu * Math.cos(a)) - C.groundDrag * this.speed * this.speed) * dt);
      const nx = this.x + Math.cos(a) * s * dt;
      this.speed = s;
      if (this.x < 0 && nx >= 0) {
        // Kierii nokan yli tyhjän päälle
        this.airborne = true;
        this.vx = Math.cos(a) * s;
        this.vy = -Math.sin(a) * s;
        this.x = nx;
        this.y -= Math.sin(a) * s * dt;
      } else {
        this.x = Math.min(nx, hill.endX - 2);
        const surf = hill.surfaceAt(this.x);
        const sin = Math.sin(surf.angle), cos = Math.cos(surf.angle);
        this.y = surf.y;
        this.vx = cos * s;
        this.vy = -sin * s;
        if (s > C.restSpeed) {
          this.spin += (s / C.spinRadius * 0.7 - this.spin) * (1 - Math.exp(-dt * 5));
        } else {
          // Vauhti loppuu: jää makaamaan rinteen suuntaisesti
          this.spin *= Math.exp(-dt * 6);
          const rest = surf.angle + Math.round((this.roll - surf.angle) / Math.PI) * Math.PI;
          this.roll += (rest - this.roll) * (1 - Math.exp(-dt * 5));
        }
        this.roll += this.spin * dt;
        if (s > C.popSpeed && rng() < C.popRate * dt) {
          // Raaja tarttuu hankeen ja sinkoaa hyppääjän taas ilmaan
          const up = s * (C.popMin + (C.popMax - C.popMin) * rng());
          this.vx = cos * s * C.popKeep + sin * up;
          this.vy = -sin * s * C.popKeep + cos * up;
          this.spin = s / C.spinRadius * (0.6 + 0.8 * rng());
          this.airborne = true;
          this.hit(up + 2);
        }
      }
    }
    const surf = hill.surfaceAt(this.x);
    this.height = Math.max(0, this.y - surf.y);
    this.pitch = -surf.angle;
    if (!this.airborne && (this.speed < 0.3 && this.t > 1 || this.x >= hill.endX - 2.01)) {
      this.speed = 0;
      this.setPhase(Phase.DONE);
    }
  }

  /** Kaatunut hyppääjä iskeytyy pintaan: pomppaa, menettää vauhtia ja alkaa kieriä. */
  crashLand(surf) {
    const C = CRASH, rng = this.rng;
    const sin = Math.sin(surf.angle), cos = Math.cos(surf.angle);
    const vn = this.vx * sin + this.vy * cos; // pintaa vastaan kohtisuoraan (+ = irti pinnasta)
    const impact = Math.max(0, -vn);
    this.y = surf.y;
    if (this.crash === 'flight' && !this.touchdown) {
      // Pituus mitataan siitä, mihin hyppääjä putoaa
      this.s = this.hill.distAtX(this.x);
      const distance = Math.round(this.s * 2) / 2;
      this.touchdown = { x: this.x, y: this.y, distance, impact };
      this.result = scoreJump(this.hill, {
        distance,
        outcome: Outcome.FALL,
        prepTime: 0,
        impact,
        avgAoaError: this.aoaErrTime > 0 ? this.aoaErrSum / this.aoaErrTime : 0,
        crash: true,
      });
      this.result.takeoffQuality = this.takeoff.quality;
      this.result.takeoffSpeed = this.takeoffSpeed;
    }
    this.hit(impact);
    const vt = Math.max(0, this.vx * cos - this.vy * sin) * C.hitKeep;
    const bounce = impact * C.restitution + vt * C.kick * rng();
    this.spin = vt / C.spinRadius * (0.5 + 0.7 * rng());
    if (bounce < C.settle) {
      this.airborne = false;
      this.speed = vt;
      this.vx = cos * vt;
      this.vy = -sin * vt;
    } else {
      this.vx = cos * vt + sin * bounce;
      this.vy = -sin * vt + cos * bounce;
    }
  }
}
