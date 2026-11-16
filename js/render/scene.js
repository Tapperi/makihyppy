// Maailman piirto: taivas, maasto, hyppyri, merkinnät, hyppääjä, lumi.
// Maailma on metreissä (x oikealle, y ylös); kamera seuraa hyppääjää.

import { Phase } from '../jump.js';
import { makeRng, clamp, lerp } from '../util.js';
import { JumperSprite, COLORS } from './jumper.js';
import { TAKEOFF } from '../config.js';
import { takeoffQuality } from '../physics.js';
import { guidance, takeoffFlash, GUIDE_COLOR, DANGER_COLOR } from '../guidance.js';
import { GHOST, sampleTrack } from '../ghost.js';

const VIEW_METERS = 22;     // ruudun lyhyemmälle sivulle mahtuva matka
const JUMPER_SCALE = 1.5;  // hyppääjä piirretään hieman luonnollista suurempana

const CAM_OFFSET = {
  [Phase.READY]: [3, -1],
  [Phase.INRUN]: [4, -1.5],
  [Phase.FLIGHT]: [5, -2.5],
  [Phase.SLIDE]: [2, 0.5],
  [Phase.CRASH]: [3, 0.8],
  [Phase.DONE]: [0, 1],
};

const GHOST_REACH = 2.2;    // haamun piirtoalueen puolikas hahmon mitoissa (m): sukset ja pää mahtuvat joka asennossa
const SKI_LENGTH = 2.45;    // irronneen suksen pituus (m)
const BODY_WOBBLE = 0.35;   // asentovirheen osuus vartalon huojunnasta: suunnan näyttää asento (guidance.js)
const TARGET_COLOR = { own: '#12924a', next: '#7a4fd0', leader: '#b97a00' };
const STREAK_RGB = { good: '235, 246, 255', sweet: '235, 246, 255', warn: '255, 226, 120', bad: '255, 150, 130' };

export class Scene {
  constructor(canvas, hill) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hill = hill;
    this.sprite = new JumperSprite();
    this.cam = { x: 0, y: 0, ox: 0, oy: 0, vx: 0, vy: 0 };
    this.time = 0;
    this.particles = [];
    this.flakes = [];
    this.W = 0; this.H = 0; this.scale = 10;
    this.lastPhase = null;
    this.wobble = 0;       // 0..1: huojunnan amplitudi (asentovirhe + puuska), pehmennetty
    this.shx = 0; this.shy = 0; // kameran tärinä (px)
    this.guide = guidance({});  // ohjaussignaali: hyppääjän asento ja värit
    this.danger = 0;
    this.streaks = [];     // ilmavirtaviivat hyppääjän ympärillä
    this.streakDebt = 0;
    // Kaatumisen tehosteet
    this.debris = [];      // irronneet sukset
    this.bursts = [];      // iskutähdet
    this.shake = 0;        // iskun aiheuttama kameran tärinä (px), vaimenee
    this.flash = 0;        // 0..1: iskun välähdys
    this.hitStop = 0;      // kovan iskun jälkeen peli pysähtyy hetkeksi (s) – main.js lukee tämän
    this.lastHits = 0;
    this.camH = 0;         // kaatuessa kamera seuraa pomppuja vain osittain
    this.zoom = 1;         // kaatuessa kamera zoomaa lähemmäs
    this.punch = 0;        // iskun aiheuttama lisäzoomin nytkähdys, vaimenee
    // Lehtikuva kaatumisesta: otetaan hetki kovimman iskun jälkeen (main.js kopioi kuvan, kun photoDue)
    this.photoTimer = -1;
    this.photoBest = 0;
    this.photoDue = false;
    this.photoTaken = false;
    this.targets = [];     // tavoiteviivat rinteessä [{d, kind, label}] (targets.js, main.js asettaa)
    // Haamuhyppääjä: ennätyshypyn nauha (ghost.js, main.js asettaa) tai null
    this.ghost = null;
    this.ghostName = null; // tulostaulun kärjen haamulle nimilappu; omalla ennätyksellä null
    this.run = { ghost: null, name: null }; // käynnissä olevan hypyn haamu: ei vaihdu kesken hypyn
    this.ghostNow = null;  // haamun tila tällä hetkellä {x, y, pitch, pose, alpha} tai null
    this.ghostSprite = new JumperSprite();
    this.ghostLayer = null; // apukangas: hahmo piirretään ensin tänne, jotta läpinäkyvyys on tasainen
    this.buildStatic();
  }

  buildStatic() {
    const hill = this.hill;
    const rng = makeRng(20240);
    const land = hill.landingPoints;
    const endX = land.x[land.n - 1];

    // Puut harjanteen takana: tyvi hieman maanpinnan alla, latvat näkyvät
    this.trees = [];
    for (let x = -135; x < endX + 60; x += 2.5 + rng() * 5) {
      if (x > -6 && x < 3) continue;
      const ground = x < 0 ? hill.backGroundY(x) : hill.groundY(Math.min(x, endX));
      this.trees.push({ x, y: ground - 0.5 - rng() * 2.5, h: 7 + rng() * 6, w: 2.4 + rng() * 1.4, tone: rng() });
    }

    // Vauhtimäen tukipilarit
    const inr = hill.inrunPoints;
    this.pillars = [];
    for (let i = 24; i < inr.n - 4; i += 22) this.pillars.push({ x: inr.x[i], top: inr.y[i], bottom: hill.backGroundY(inr.x[i]) });

    // Tuuliviirit
    const kPos = hill.landingPos(hill.k + 6), farPos = hill.landingPos(hill.hs + 30);
    this.flags = [
      { x: 7, y: hill.groundY(7), h: 6 },
      { x: kPos.x, y: kPos.y, h: 7.5 },
      { x: farPos.x, y: farPos.y, h: 6 },
    ];

    // Etäisyysmerkit
    this.marks = [];
    for (let d = 50; d <= hill.hs + 16; d += 5) {
      if (Math.abs(d - hill.k) < 2.5 || Math.abs(d - hill.hs) < 2.5) continue;
      this.marks.push({ d, pos: hill.landingPos(d), major: d % 10 === 0 });
    }
    this.kMark = hill.landingPos(hill.k);
    this.hsMark = hill.landingPos(hill.hs);
  }

  resize(w, h, dpr) {
    this.W = w; this.H = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.baseScale = Math.min(w, h) / VIEW_METERS;
    this.scale = this.baseScale * (this.zoom + this.punch);
    const ctx = this.ctx;
    this.sky = ctx.createLinearGradient(0, 0, 0, h);
    this.sky.addColorStop(0, '#4f93d1');
    this.sky.addColorStop(0.55, '#a9d3f0');
    this.sky.addColorStop(1, '#e6f3fb');
    this.snow = ctx.createLinearGradient(0, 0, 0, h);
    this.snow.addColorStop(0, '#ffffff');
    this.snow.addColorStop(1, '#d3e3f0');

    const rng = makeRng(7);
    const count = Math.round(clamp((w * h) / 9000, 40, 140));
    this.flakes = Array.from({ length: count }, () => ({ x: rng() * w, y: rng() * h, z: 0.35 + rng() * 0.65 }));
  }

  /** Kutsutaan uuden hypyn alussa: kamera ja hahmo heti paikalleen. */
  reset(jump) {
    const [ox, oy] = CAM_OFFSET[jump.phase];
    Object.assign(this.cam, { ox, oy, x: jump.x + ox, y: jump.y + oy, vx: 0, vy: 0 });
    this.sprite.snap(jump.pose);
    this.ghostSprite.snap('crouch');
    this.run = { ghost: this.ghost, name: this.ghostName };
    this.ghostNow = null;
    this.particles.length = 0;
    this.streaks.length = 0;
    this.wobble = 0; this.shx = 0; this.shy = 0;
    this.guide = guidance(jump);
    this.danger = 0;
    this.debris.length = 0;
    this.bursts.length = 0;
    this.shake = 0; this.flash = 0; this.hitStop = 0; this.camH = 0;
    this.zoom = 1; this.punch = 0;
    this.scale = this.baseScale ?? this.scale;
    this.photoTimer = -1; this.photoBest = 0; this.photoDue = false; this.photoTaken = false;
    this.lastHits = jump.crashHits;
    this.lastPhase = jump.phase;
  }

  sx(x) { return (x - this.cam.x) * this.scale + this.W * 0.4 + this.shx; }
  sy(y) { return (this.cam.y - y) * this.scale + this.H * 0.42 + this.shy; }

  update(jump, wind, dt) {
    this.time += dt;
    const cam = this.cam;
    const [tx, ty] = CAM_OFFSET[jump.phase];
    const k = 1 - Math.exp(-dt * 3);
    cam.ox += (tx - cam.ox) * k;
    cam.oy += (ty - cam.oy) * k;
    // Kaatuessa kamera pysyy lähempänä rinnettä, jotta pomput näkyvät pomppuina
    const crashed = jump.phase === Phase.CRASH;
    this.camH += ((jump.crash ? jump.height : 0) - this.camH) * (1 - Math.exp(-dt * 6));
    const nx = jump.x + cam.ox, ny = jump.y + cam.oy - this.camH * 0.6;
    if (dt > 0) { cam.vx = (nx - cam.x) / dt; cam.vy = (ny - cam.y) / dt; }
    cam.x = nx; cam.y = ny;

    const energy = crashed ? clamp(Math.max(Math.abs(jump.spin) / 6, jump.speed / 14), 0, 1) : 0;
    this.guide = guidance(jump);
    this.danger = jump.danger;
    this.sprite.update(dt, jump.pose, energy, this.guide.lean);
    // Haamu lähtee puomilta samalla hetkellä kuin pelaaja ja kulkee oman nauhansa mukaan
    this.ghostNow = this.run.ghost && jump.phase !== Phase.READY ? sampleTrack(this.run.ghost, jump.runT) : null;
    if (this.ghostNow) this.ghostSprite.update(dt, this.ghostNow.pose);
    this.updateWobble(jump, wind, dt);
    this.updateStreaks(jump, wind, dt);
    this.updateCrashFx(jump, dt);

    // Lumipöllähdys alastulossa ja jarrutuksessa
    if (crashed) {
      // Kierivä hyppääjä auraa lunta koko matkan
      if (!jump.airborne && jump.speed > 2 && Math.random() < dt * 140) this.spray(jump, 2, 0.7);
    } else if (jump.phase === Phase.SLIDE && this.lastPhase === Phase.FLIGHT) {
      this.spray(jump, jump.outcome === 'fall' ? 46 : 22, 1);
      if (jump.outcome === 'fall') this.photoTimer = 0.12;
    } else if (jump.phase === Phase.SLIDE && jump.speed > 3 && (jump.outcome === 'fall' || jump.s > this.hill.brakeStart)) {
      if (Math.random() < dt * 90) this.spray(jump, 1, 0.5);
    }
    this.lastPhase = jump.phase;

    for (const p of this.particles) {
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    const sc = this.scale;
    for (const f of this.flakes) {
      f.x += (-wind.value * 32 - cam.vx * sc * 0.3) * f.z * dt;
      f.y += (38 + cam.vy * sc * 0.3) * f.z * dt;
      f.x = ((f.x % this.W) + this.W) % this.W;
      f.y = ((f.y % this.H) + this.H) % this.H;
    }
  }

  // --- Huojunta: amplitudi kasvaa asentovirheen mukana, puuska lisää sitä hetkeksi ---
  updateWobble(jump, wind, dt) {
    const gliding = jump.phase === Phase.FLIGHT && !jump.landPrep;
    const base = gliding
      ? clamp((jump.bandError + 0.45 * (wind.gustLevel || 0)) * jump.posture, 0, 1)
      : jump.phase === Phase.INRUN ? jump.balanceError * 0.4 // huono kyykky näkyy kevyenä huojuntana
      : 0;
    // Kaatumisvaaran kasvaessa hyppääjä alkaa heilua holtittomasti
    const target = Math.max(base, jump.danger);
    this.wobble += (target - this.wobble) * (1 - Math.exp(-dt * 9));
    // Kevyt kameran tärinä vasta isolla virheellä; vaara ja iskut ravistavat kunnolla
    const shake = clamp((this.wobble - 0.55) / 0.45, 0, 1) * 4 + jump.danger * 5 + this.shake;
    this.shx = shake * Math.sin(this.time * 83);
    this.shy = shake * Math.cos(this.time * 67);
  }

  /** Hyppääjän piirtoon välitettävät heilahdukset. */
  wobbleOffsets() {
    const a = this.wobble, t = this.time;
    if (a < 0.004) return null;
    // Hidas keinunta peittäisi asennon kertoman korjaussuunnan: täysi keinunta vasta kaatumisvaarassa
    const b = Math.max(a * BODY_WOBBLE, this.danger);
    return {
      roll: b * 0.07 * Math.sin(t * 5.3),                                   // koko hyppääjä keinuu
      skiA: a * 0.13 * Math.sin(t * 31),                                    // sukset väpättävät eri tahtiin
      skiB: a * 0.13 * Math.sin(t * 27 + 1.3),
      torso: b * (10 * Math.sin(t * 6.5) + 3 * Math.sin(t * 11.3 + 0.7)),   // vartalo keinuu (astetta)
      arm: b * (24 * Math.sin(t * 9.1 + 2) + 8 * Math.sin(t * 17)),         // kädet ja hartiat heiluvat
    };
  }

  /** Hyppääjän ohjausvärit (ks. JumperSprite.draw) tai null, kun signaalia ei ole. */
  jumperLook(jump) {
    const flash = takeoffFlash(jump);
    if (flash) return { ski: flash, halo: flash, haloAlpha: 0.55, high: 0 };
    const g = this.guide;
    if (!g.active || g.weight < 0.3) return null;
    const high = g.severity > 0 ? g.lean : 0;
    if (jump.danger > 0) {
      // Kaatumisvaara: koko hahmo vilkkuu
      const blink = Math.sin(this.time * 40) > 0 ? '#ffffff' : DANGER_COLOR;
      return { ski: blink, halo: blink, haloAlpha: 0.9, high };
    }
    const color = GUIDE_COLOR[g.state];
    return { ski: color, halo: g.severity > 0 ? color : null, haloAlpha: 0.35 + 0.45 * g.severity, high };
  }

  // --- Ilmavirtaviivat: suoria ja sileitä hyvässä asennossa, vääristyvät huonossa ---
  updateStreaks(jump, wind, dt) {
    const flying = jump.phase === Phase.FLIGHT && jump.t > 0.3 && jump.speed > 1;
    const alert = wind.gustAlert || 0;
    const ux = flying ? jump.vx / jump.speed : 1, uy = flying ? jump.vy / jump.speed : 0;
    const nx = -uy, ny = ux; // kohtisuoraan lentosuuntaa vastaan

    if (flying) {
      this.streakDebt += dt * (14 + 22 * alert + 10 * this.wobble);
      while (this.streakDebt >= 1) {
        this.streakDebt -= 1;
        const along = 3.2 + Math.random() * 1.6, side = (Math.random() - 0.5) * 4.6;
        const x = ux * along + nx * side, y = uy * along + ny * side;
        this.streaks.push({ x, y, age: 0, life: 0.42 + Math.random() * 0.2, ph: Math.random() * 6.28, pts: [x, y] });
      }
    } else {
      this.streakDebt = 0;
    }

    const bend = this.wobble * 8 + alert * 2.5;      // poikittainen aaltoilu (m/s)
    const push = -(wind.burstValue || 0) * 2.2;      // puuska painaa viivoja tuulen suuntaan
    for (const s of this.streaks) {
      s.age += dt;
      const lat = bend * Math.sin(s.ph + s.age * 17) + (Math.random() - 0.5) * bend * 0.6;
      s.x += (-ux * 16 + nx * lat + push) * dt;
      s.y += (-uy * 16 + ny * lat) * dt;
      s.pts.push(s.x, s.y);
      if (s.pts.length > 16) s.pts.splice(0, 2);
    }
    this.streaks = this.streaks.filter((s) => s.age < s.life);
  }

  drawStreaks(ctx, jump, wind) {
    if (!this.streaks.length) return;
    const sc = this.scale, X = this.sx(jump.x), Y = this.sy(jump.y) - sc * 0.6;
    const boost = Math.max(this.wobble, wind.gustAlert || 0);
    // Väri seuraa ohjaussignaalia: valkoinen -> keltainen -> punainen
    const rgb = STREAK_RGB[this.guide.state] ?? STREAK_RGB.good;
    ctx.lineWidth = 1.5 + boost;
    ctx.lineCap = 'round';
    for (const s of this.streaks) {
      const p = s.pts;
      if (p.length < 4) continue;
      ctx.strokeStyle = `rgba(${rgb}, ${Math.sin((s.age / s.life) * Math.PI) * (0.3 + 0.4 * boost)})`;
      ctx.beginPath();
      ctx.moveTo(X + p[0] * sc, Y - p[1] * sc);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(X + p[i] * sc, Y - p[i + 1] * sc);
      ctx.stroke();
    }
  }

  // --- Kaatumisen tehosteet: iskut, irtoavat sukset, tärinä ja välähdykset ---
  updateCrashFx(jump, dt) {
    if (jump.phase === Phase.CRASH && this.lastPhase !== Phase.CRASH) this.shake = Math.max(this.shake, 9);
    if (jump.crashHits > this.lastHits) this.crashHit(jump);
    this.lastHits = jump.crashHits;

    if (this.photoTimer >= 0 && (this.photoTimer -= dt) < 0) this.photoDue = true;

    this.shake *= Math.exp(-dt * 7);
    this.flash *= Math.exp(-dt * 9);
    // Kamera zoomaa kaatujaan ja nytkähtää jokaisesta iskusta
    const zoomTo = jump.phase === Phase.CRASH ? 1.35 : jump.crash ? 1.2 : 1;
    this.zoom += (zoomTo - this.zoom) * (1 - Math.exp(-dt * 4));
    this.punch *= Math.exp(-dt * 10);
    if (this.baseScale) this.scale = this.baseScale * (this.zoom + this.punch);
    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => b.age < b.life);

    // Irronneet sukset lentävät, pyörivät ja kimpoilevat rinteessä
    const hill = this.hill;
    for (const d of this.debris) {
      if (d.rest) continue;
      d.vy -= 9.81 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.a += d.va * dt;
      const surf = hill.surfaceAt(d.x);
      if (d.y > surf.y) continue;
      const sin = Math.sin(surf.angle), cos = Math.cos(surf.angle);
      const vn = d.vx * sin + d.vy * cos, vt = (d.vx * cos - d.vy * sin) * 0.72;
      const up = Math.max(0, -vn) * 0.45;
      d.y = surf.y;
      d.vx = cos * vt + sin * up;
      d.vy = -sin * vt + cos * up;
      d.va = (Math.random() - 0.5) * 3 * Math.abs(vt) - d.va * 0.4;
      if (up > 1.5) this.sprayAt(d.x, d.y, surf.angle, d.vx, d.vy, 4, 0.5);
      if (up < 0.8 && Math.abs(vt) < 1.5) {
        // Jää lojumaan rinteeseen
        d.rest = true;
        d.a = -surf.angle + Math.round((d.a + surf.angle) / Math.PI) * Math.PI;
      }
    }
  }

  /** Hyppääjä iski pintaan: lumiräjähdys, tärähdys, välähdys ja ensimmäisellä kerralla sukset irti. */
  crashHit(jump) {
    const p = clamp(jump.crashImpact / 11, 0.2, 1);
    this.spray(jump, Math.round(18 + 60 * p), 0.8 + 1.4 * p);
    this.shake = Math.max(this.shake, 6 + 20 * p);
    this.flash = Math.max(this.flash, 0.25 + 0.75 * p);
    this.punch = Math.max(this.punch, 0.04 + 0.12 * p);
    if (p > 0.45) this.hitStop = Math.max(this.hitStop, 0.03 + 0.07 * p);
    this.bursts.push({ x: jump.x, y: jump.y + 0.5, age: 0, life: 0.2 + 0.12 * p, p, rot: Math.random() * 6.28 });
    this.sprite.jolt();
    if (jump.crashImpact > this.photoBest) {
      this.photoBest = jump.crashImpact;
      this.photoTimer = 0.08;
    }
    if (this.sprite.skis) {
      this.sprite.skis = false;
      for (let i = 0; i < 2; i++) {
        const keep = 0.55 + Math.random() * 0.5;
        this.debris.push({
          x: jump.x, y: jump.y + 0.4,
          vx: jump.vx * keep + (Math.random() - 0.5) * 6,
          vy: jump.vy * keep + 4 + Math.random() * 7,
          a: jump.pitch, va: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 12),
          rest: false,
        });
      }
    }
  }

  /** Lehtikuvan rajaus hyppääjän ympäriltä canvasin pikseleinä. aspect = leveys / korkeus. */
  photoRect(jump, aspect) {
    const w = 12 * this.scale, h = w / aspect;
    const x = this.sx(jump.x) - w * 0.45, y = this.sy(jump.y) - h * 0.62;
    this.photoTaken = true;
    return { x: x * this.dpr, y: y * this.dpr, w: w * this.dpr, h: h * this.dpr };
  }

  spray(jump, count, power) {
    this.sprayAt(jump.x, jump.y, -jump.pitch, jump.vx, jump.vy, count, power);
  }

  sprayAt(x, y, slope, vx0, vy0, count, power) {
    for (let i = 0; i < count; i++) {
      const a = slope + 0.3 + Math.random() * 1.2;
      const v = (2 + Math.random() * 5) * power;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 1.2,
        y: y + 0.1,
        vx: vx0 * 0.35 + Math.cos(a) * v * (Math.random() < 0.5 ? -0.4 : 1),
        vy: vy0 * 0.35 + Math.sin(a) * v,
        life: 0.35 + Math.random() * 0.5,
        r: (0.08 + Math.random() * 0.14) * Math.max(1, power), // kova isku heittää isompia lumipaakkuja
      });
    }
  }

  draw(jump, wind) {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, W, H);

    this.drawBackdrop(ctx);
    this.drawTrees(ctx);
    this.drawFlags(ctx, wind);
    this.drawTerrain(ctx);
    this.drawInrun(ctx);
    this.drawMarks(ctx, jump);
    this.drawGhost(ctx);
    this.drawJumper(ctx, jump);
    this.drawDebris(ctx);
    this.drawStreaks(ctx, jump, wind);
    this.drawParticles(ctx);
    this.drawBursts(ctx);
    this.drawFlakes(ctx);
    this.drawImpactOverlay(ctx, jump);
  }

  drawDebris(ctx) {
    if (!this.debris.length) return;
    const sc = this.scale, half = SKI_LENGTH * JUMPER_SCALE / 2;
    ctx.strokeStyle = COLORS.ski;
    ctx.lineWidth = 0.07 * JUMPER_SCALE * sc;
    ctx.lineCap = 'round';
    for (const d of this.debris) {
      const dx = Math.cos(d.a) * half, dy = Math.sin(d.a) * half, lift = d.rest ? 0.06 : 0;
      ctx.beginPath();
      ctx.moveTo(this.sx(d.x - dx), this.sy(d.y - dy + lift));
      ctx.lineTo(this.sx(d.x + dx), this.sy(d.y + dy + lift));
      ctx.stroke();
    }
  }

  /** Iskutähti: säteet leviävät iskukohdasta ja haihtuvat. */
  drawBursts(ctx) {
    const sc = this.scale;
    ctx.lineCap = 'round';
    for (const b of this.bursts) {
      const u = b.age / b.life, X = this.sx(b.x), Y = this.sy(b.y);
      const r0 = (0.5 + 2.2 * u) * (0.6 + b.p) * sc, r1 = r0 + (1 - u) * (1.2 + 2.4 * b.p) * sc;
      ctx.strokeStyle = `rgba(255, 244, 214, ${0.95 * (1 - u)})`;
      ctx.lineWidth = Math.max(2, sc * 0.22 * (0.5 + b.p) * (1 - u));
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = b.rot + i * (Math.PI * 2 / 9) + (i % 2) * 0.2, k = i % 2 ? 0.7 : 1;
        ctx.moveTo(X + Math.cos(a) * r0, Y + Math.sin(a) * r0);
        ctx.lineTo(X + Math.cos(a) * r1 * k, Y + Math.sin(a) * r1 * k);
      }
      ctx.stroke();
    }
  }

  /** Punainen reunahehku kaatumisvaarassa ja iskuissa sekä iskun valkoinen välähdys. */
  drawImpactOverlay(ctx, jump) {
    const { W, H } = this;
    const red = Math.max(jump.danger * (0.5 + 0.2 * Math.sin(this.time * 24)), this.flash * 0.6);
    if (red > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(190, 20, 30, 0)');
      g.addColorStop(1, `rgba(190, 20, 30, ${red})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.flash > 0.3) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(this.flash - 0.3) * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // --- Taustavuoret ja metsänreuna (parallaksi) ---
  drawBackdrop(ctx) {
    const { W, H, cam, scale: sc } = this;
    const layer = (factor, baseY, amp, color, rough) => {
      const shift = cam.x * sc * factor;
      const y0 = baseY + cam.y * sc * factor;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let px = 0; px <= W + 8; px += 8) {
        const u = (px + shift) / amp;
        let y = Math.sin(u * 0.9) * 0.5 + Math.sin(u * 2.3 + 1.7) * 0.28 + Math.sin(u * 5.1 + 0.4) * 0.12;
        if (rough) y += Math.abs(Math.sin(u * 23)) * 0.05;
        ctx.lineTo(px, y0 - y * amp * 0.45);
      }
      ctx.lineTo(W, H);
      ctx.fill();
    };
    layer(0.05, H * 0.5, Math.max(W, H) * 0.3, '#8fb8dc', false);
    layer(0.12, H * 0.6, Math.max(W, H) * 0.22, '#6c9cc0', false);
    layer(0.25, H * 0.74, Math.max(W, H) * 0.16, '#3f6f7f', true);
  }

  drawTrees(ctx) {
    const sc = this.scale;
    const minX = this.cam.x - (this.W * 0.4) / sc - 4, maxX = this.cam.x + (this.W * 0.6) / sc + 4;
    for (const t of this.trees) {
      if (t.x < minX || t.x > maxX) continue;
      const X = this.sx(t.x), Y = this.sy(t.y), h = t.h * sc, w = t.w * sc;
      const g = Math.round(lerp(58, 84, t.tone));
      ctx.fillStyle = `rgb(${Math.round(g * 0.42)}, ${g}, ${Math.round(g * 0.72)})`;
      for (let i = 0; i < 3; i++) {
        const top = Y - h + (h * 0.22) * i, bottom = Y - h + h * (0.5 + 0.25 * i), half = w * (0.42 + 0.29 * i) * 0.5;
        ctx.beginPath();
        ctx.moveTo(X, top); ctx.lineTo(X + half, bottom); ctx.lineTo(X - half, bottom);
        ctx.fill();
      }
      // lunta latvassa
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(X, Y - h); ctx.lineTo(X + w * 0.13, Y - h * 0.8); ctx.lineTo(X - w * 0.13, Y - h * 0.8);
      ctx.fill();
    }
  }

  drawFlags(ctx, wind) {
    const sc = this.scale;
    const w = wind.value;
    const strength = clamp(Math.abs(w) / 3, 0, 1);
    const dirX = w >= 0 ? -1 : 1; // vastatuuli puhaltaa vasemmalle
    const gustAlert = wind.gustAlert || 0;
    for (const f of this.flags) {
      const X = this.sx(f.x), Y0 = this.sy(f.y), Y1 = this.sy(f.y + f.h);
      if (X < -60 || X > this.W + 60) continue;
      ctx.strokeStyle = '#5b6770';
      ctx.lineWidth = Math.max(1.5, sc * 0.1);
      ctx.beginPath(); ctx.moveTo(X, Y0); ctx.lineTo(X, Y1); ctx.stroke();
      // viiri: roikkuu tyynellä, suoristuu tuulessa
      const len = 2.2 * sc, droop = lerp(1.25, 0.12, strength);
      // puuskassa viiri lepattaa rajusti – jo varoitusvaiheessa
      const wave = Math.sin(this.time * (5 + 6 * strength) + f.x) * 0.12 * (0.3 + strength)
        + Math.sin(this.time * 23 + f.x) * 0.3 * gustAlert;
      const ex = X + dirX * Math.cos(droop + wave) * len, ey = Y1 + Math.sin(droop + wave) * len + sc * 0.3;
      ctx.fillStyle = '#f2542d';
      ctx.beginPath();
      ctx.moveTo(X, Y1); ctx.lineTo(X, Y1 + sc * 0.9); ctx.lineTo(ex, ey);
      ctx.fill();
    }
  }

  drawTerrain(ctx) {
    const hill = this.hill, land = hill.landingPoints, H = this.H;
    ctx.beginPath();
    ctx.moveTo(this.sx(-150), H + 40);
    for (let x = -150; x < 0; x += 3) ctx.lineTo(this.sx(x), this.sy(hill.backGroundY(x)));
    for (let i = 0; i < land.n; i += 2) ctx.lineTo(this.sx(land.x[i]), this.sy(land.y[i]));
    const endX = land.x[land.n - 1], endY = land.y[land.n - 1];
    ctx.lineTo(this.sx(endX + 300), this.sy(endY));
    ctx.lineTo(this.sx(endX + 300), H + 40);
    ctx.closePath();
    ctx.fillStyle = this.snow;
    ctx.fill();
    ctx.strokeStyle = '#b9cfe0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawInrun(ctx) {
    const hill = this.hill, inr = hill.inrunPoints, sc = this.scale;
    if (this.sx(0) < -40) return; // koko vauhtimäki ruudun ulkopuolella

    // Pilarit
    ctx.strokeStyle = '#51677a';
    ctx.lineWidth = Math.max(2, sc * 0.45);
    for (const p of this.pillars) {
      ctx.beginPath(); ctx.moveTo(this.sx(p.x), this.sy(p.top - 0.5)); ctx.lineTo(this.sx(p.x), this.sy(p.bottom - 1)); ctx.stroke();
    }

    // Hyppyrin nokan alusrakenne
    const blockEnd = 34; // näytettä = 17 m
    ctx.fillStyle = '#5d7284';
    ctx.beginPath();
    for (let i = 0; i <= blockEnd; i++) ctx.lineTo(this.sx(inr.x[i]), this.sy(inr.y[i]));
    for (let i = blockEnd; i >= 0; i--) ctx.lineTo(this.sx(inr.x[i]), this.sy(hill.backGroundY(inr.x[i]) - 0.3));
    ctx.fill();

    // Rata: paksu palkki, jonka päällä luminen latu
    const thick = 1.1;
    ctx.fillStyle = '#34495e';
    ctx.beginPath();
    for (let i = 0; i < inr.n; i++) ctx.lineTo(this.sx(inr.x[i]), this.sy(inr.y[i]));
    for (let i = inr.n - 1; i >= 0; i--) {
      const a = hill.inrunPos(i * 0.5).angle;
      ctx.lineTo(this.sx(inr.x[i] - Math.sin(a) * thick), this.sy(inr.y[i] - Math.cos(a) * thick));
    }
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, sc * 0.22);
    ctx.beginPath();
    for (let i = 0; i < inr.n; i++) ctx.lineTo(this.sx(inr.x[i]), this.sy(inr.y[i]));
    ctx.stroke();

    this.drawTakeoffZone(ctx);

    // Lähtökoppi radan yläpäässä ja lähtöpuomi
    const top = hill.inrunPos(hill.inrunTop);
    const X = this.sx(top.x), Y = this.sy(top.y);
    ctx.fillStyle = '#34495e';
    ctx.fillRect(X - sc * 4.5, Y - sc * 0.2, sc * 5.5, sc * 0.6);
    ctx.fillStyle = '#8c3b2e';
    ctx.fillRect(X - sc * 4, Y - sc * 3.2, sc * 3.4, sc * 3);
    ctx.fillStyle = '#f4f9fd';
    ctx.beginPath();
    ctx.moveTo(X - sc * 4.5, Y - sc * 3.1); ctx.lineTo(X - sc * 2.3, Y - sc * 4.3); ctx.lineTo(X - sc * 0.1, Y - sc * 3.1);
    ctx.fill();
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(X - sc * 2.9, Y - sc * 2.4, sc * 1.1, sc * 1);

    const gate = hill.inrunPos(hill.inrunLength + 0.35);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = Math.max(2, sc * 0.2);
    ctx.beginPath();
    ctx.moveTo(this.sx(gate.x - Math.sin(gate.angle) * 0.1), this.sy(gate.y - Math.cos(gate.angle) * 0.1));
    ctx.lineTo(this.sx(gate.x + Math.sin(gate.angle) * 0.75), this.sy(gate.y + Math.cos(gate.angle) * 0.75));
    ctx.stroke();
  }

  /**
   * Ponnistusalue: radan kylkeen maalattu väriliuku ponnistuksen tehon mukaan (sama kuin
   * ponnistuspalkissa) ja viiva parhaassa kohdassa. Ajoituksen näkee katsomalla hyppääjää ja nokkaa.
   */
  drawTakeoffZone(ctx) {
    const hill = this.hill, sc = this.scale;
    const DEPTH = 0.62; // kaistan keskilinja radan pinnasta alaspäin (m)
    const side = (d, depth) => {
      const p = hill.inrunPos(d);
      return [this.sx(p.x - Math.sin(p.angle) * depth), this.sy(p.y - Math.cos(p.angle) * depth)];
    };
    const [x0, y0] = side(0, DEPTH), [x1, y1] = side(TAKEOFF.zone, DEPTH);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i <= 20; i++) {
      const q = takeoffQuality((i / 20) * TAKEOFF.zone);
      // 0 = punainen, 120 = vihreä. Kaukana nokasta kaista häipyy pois, ettei pitkä punainen osuus hallitse kuvaa.
      g.addColorStop(i / 20, `hsla(${q * q * 120}, 78%, ${38 + q * 12}%, ${Math.min(1, q * 2.5)})`);
    }
    ctx.strokeStyle = g;
    ctx.lineWidth = sc * 0.6;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (let d = 0; d <= TAKEOFF.zone; d += 0.5) ctx.lineTo(...side(d, DEPTH));
    ctx.stroke();
    // Paras ponnistuskohta
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, sc * 0.16);
    ctx.beginPath();
    ctx.moveTo(...side(TAKEOFF.optimum, 0.2));
    ctx.lineTo(...side(TAKEOFF.optimum, 1.05));
    ctx.stroke();
  }

  drawMarks(ctx, jump) {
    const sc = this.scale;
    const tick = (pos, len, color, width) => {
      // viiva rinteen pinnasta kohtisuoraan lumen sisään
      const nx = -Math.sin(pos.angle), ny = -Math.cos(pos.angle);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(this.sx(pos.x), this.sy(pos.y));
      ctx.lineTo(this.sx(pos.x + nx * len), this.sy(pos.y + ny * len));
      ctx.stroke();
      return [this.sx(pos.x + nx * (len + 0.9)), this.sy(pos.y + ny * (len + 0.9))];
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(10, Math.round(sc * 0.85))}px system-ui, sans-serif`;
    for (const m of this.marks) {
      const X = this.sx(m.pos.x);
      if (X < -40 || X > this.W + 40) continue;
      const [lx, ly] = tick(m.pos, m.major ? 1.1 : 0.55, '#3f7fb5', m.major ? 2 : 1.2);
      if (m.major) { ctx.fillStyle = '#3f6f95'; ctx.fillText(String(m.d), lx, ly); }
    }
    ctx.font = `800 ${Math.max(11, Math.round(sc * 0.95))}px system-ui, sans-serif`;
    let [lx, ly] = tick(this.kMark, 2, '#d62828', 3.5);
    ctx.fillStyle = '#d62828'; ctx.fillText(`K ${this.hill.k}`, lx, ly);
    [lx, ly] = tick(this.hsMark, 2, '#1d3557', 3.5);
    ctx.fillStyle = '#1d3557'; ctx.fillText(`HS ${this.hill.hs}`, lx, ly);

    // Tavoiteviivat: oma ennätys ja tulostaulun kilpailijat. Lippu pinnalla, nimi syvemmällä kuin metriluvut.
    const targets = [...this.targets].sort((a, b) => a.d - b.d);
    targets.forEach((t, i) => {
      const pos = this.hill.landingPos(t.d), X = this.sx(pos.x), Y = this.sy(pos.y);
      if (X < -160 || X > this.W + 160) return;
      const color = TARGET_COLOR[t.kind];
      const [tx, ty] = tick(pos, 3.3 + i * 1.3, color, 3);
      ctx.fillStyle = color;
      ctx.fillText(t.label, tx, ty);
      ctx.beginPath();
      ctx.moveTo(X, Y); ctx.lineTo(X, Y - sc * 1.5); ctx.lineTo(X + sc * 0.8, Y - sc * 1.15); ctx.lineTo(X, Y - sc * 0.8);
      ctx.fill();
    });

    // Alastulokohdan merkki
    if (jump.touchdown) {
      const X = this.sx(jump.touchdown.x), Y = this.sy(jump.touchdown.y);
      ctx.fillStyle = '#f2542d';
      ctx.beginPath();
      ctx.moveTo(X, Y); ctx.lineTo(X - sc * 0.45, Y - sc * 1.3); ctx.lineTo(X + sc * 0.45, Y - sc * 1.3);
      ctx.fill();
    }
  }

  // --- Haamuhyppääjä: kauden ennätyshyppy puoliläpinäkyvänä pelaajan takana ---
  drawGhost(ctx) {
    const g = this.ghostNow;
    if (!g || this.photoDue) return; // lehtikuvaan ei haamua
    const js = this.scale * JUMPER_SCALE, half = GHOST_REACH * js;
    const X = this.sx(g.x), Y = this.sy(g.y);
    if (X < -half || X > this.W + half || Y < -half || Y > this.H + half) return;
    // Hahmon osat menevät päällekkäin, joten suoraan läpinäkyvänä piirrettynä nivelet näkyisivät tummempina
    const layer = (this.ghostLayer ??= document.createElement('canvas'));
    const px = Math.ceil(half * 2 * this.dpr);
    if (layer.width !== px) { layer.width = px; layer.height = px; }
    const lc = layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, px, px);
    lc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ghostSprite.draw(lc, half, half, js, g.pitch);
    ctx.globalAlpha = GHOST.alpha * g.alpha;
    ctx.drawImage(layer, X - half, Y - half, half * 2, half * 2);
    if (this.run.name) {
      // Nimilappu kertoo, kenen hyppy vieressä kulkee
      const up = g.pose === 'crouch' || g.pose === 'flight' ? 1.3 : 2.3; // pystyasennossa pään yläpuolelle
      ctx.globalAlpha = Math.min(1, GHOST.alpha * 1.8) * g.alpha;
      ctx.font = `700 ${Math.max(11, Math.round(this.scale * 0.8))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#1d3557';
      ctx.strokeText(this.run.name, X, Y - up * js);
      ctx.fillText(this.run.name, X, Y - up * js);
    }
    ctx.globalAlpha = 1;
  }

  drawJumper(ctx, jump) {
    const sc = this.scale;
    const X = this.sx(jump.x), Y = this.sy(jump.y);
    if ((jump.phase === Phase.FLIGHT || (jump.crash && jump.height > 0.2)) && jump.x > 0) {
      // varjo rinteessä
      const gy = this.hill.groundY(jump.x), slope = this.hill.slopeAtX(jump.x);
      const fade = clamp(1 - jump.height / 9, 0.15, 1);
      ctx.save();
      ctx.translate(X, this.sy(gy));
      ctx.rotate(slope);
      ctx.fillStyle = `rgba(40, 70, 100, ${0.28 * fade})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, sc * 1.5 * fade, sc * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (jump.crash) { this.drawRagdoll(ctx, jump, X, Y); return; }
    if (jump.outcome === 'fall' && jump.phase !== Phase.FLIGHT) { this.drawSnowball(ctx, jump, X, Y); return; }
    this.sprite.draw(ctx, X, Y, sc * JUMPER_SCALE, jump.pitch, this.wobbleOffsets(), this.jumperLook(jump));
  }

  // --- Hallintansa menettänyt hyppääjä: pyörii lantionsa ympäri raajat viuhtoen ---
  drawRagdoll(ctx, jump, X, Y) {
    const js = this.scale * JUMPER_SCALE;
    const slope = -jump.pitch;
    const moving = jump.phase === Phase.CRASH ? clamp(jump.speed / 8, 0, 1) : 0;
    const r = (0.22 + 0.3 * moving) * js; // lantion korkeus pinnasta: maatessa matalalla
    const hip = this.sprite.hip();
    ctx.save();
    ctx.translate(X + Math.sin(slope) * r, Y - Math.cos(slope) * r);
    ctx.rotate(jump.roll);
    this.sprite.draw(ctx, -hip[0] * js, hip[1] * js, js, 0);
    ctx.restore();
  }

  // --- Kaatunut hyppääjä pyörii alas ja kasvaa lumipalloksi ---
  drawSnowball(ctx, jump, X, Y) {
    const sc = this.scale, js = sc * JUMPER_SCALE;
    const slope = -jump.pitch;                 // rinteen kaltevuus (+ = alamäki)
    const r = Math.max(0.55, jump.ballRadius); // pyörimiskeskipisteen korkeus rinteestä (m)
    const R = jump.ballRadius * sc;
    const cx = X + Math.sin(slope) * r * sc, cy = Y - Math.cos(slope) * r * sc;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(jump.roll);                     // myötäpäivään = pyörii alamäkeen

    // Aluksi hyppääjä pyörii näkyvissä; kun pallo kasvaa, hän jää kokonaan lumen sisään
    if (jump.ballRadius < 0.9) this.sprite.draw(ctx, -0.25 * js, 0.45 * js, js, 0);

    if (R > 0.15 * sc) {
      // Pallosta törröttää vain kaksi suksea, vinosti pintaan nähden (ei kohtisuoraan)
      const ski = (angle, tilt, len) => {
        const px = Math.cos(angle) * R, py = Math.sin(angle) * R;
        const dx = Math.cos(angle + tilt), dy = Math.sin(angle + tilt);
        const out = len * js;
        ctx.strokeStyle = COLORS.ski;
        ctx.lineWidth = 0.07 * js;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(px - dx * R * 0.5, py - dy * R * 0.5); // tyvi jää pallon alle
        ctx.lineTo(px + dx * out, py + dy * out);
        // kärjen taivutus
        ctx.lineTo(px + dx * out + Math.cos(angle + tilt - 0.9) * 0.1 * js, py + dy * out + Math.sin(angle + tilt - 0.9) * 0.1 * js);
        ctx.stroke();
      };
      const grown = clamp((jump.ballRadius - 0.7) / 0.6, 0, 1);
      if (grown > 0) {
        ski(-0.7, 0.95, 0.95 * grown);
        ski(2.2, -0.75, 0.6 * grown);
      }

      const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, '#eaf2f9');
      g.addColorStop(1, '#c3d6e6');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a9c3d8';
      ctx.lineWidth = Math.max(1.5, sc * 0.08);
      ctx.stroke();

      // Lumipaakut pinnassa: näyttävät pyörimisen
      ctx.strokeStyle = 'rgba(140, 170, 196, 0.7)';
      ctx.lineWidth = Math.max(1.2, sc * 0.07);
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + (i % 2) * 0.35, d = R * (0.35 + 0.42 * ((i * 37) % 10) / 10);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, R * 0.16, a + 0.4, a + 2.0);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    const sc = this.scale;
    ctx.fillStyle = '#ffffff';
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life * 2.5, 0, 1);
      ctx.beginPath();
      ctx.arc(this.sx(p.x), this.sy(p.y), p.r * sc, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawFlakes(ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const f of this.flakes) {
      const r = 0.8 + f.z * 1.4;
      ctx.fillRect(f.x, f.y, r, r);
    }
  }
}
