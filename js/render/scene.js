// Maailman piirto: taivas, maasto, hyppyri, merkinnät, hyppääjä, lumi.
// Maailma on metreissä (x oikealle, y ylös); kamera seuraa hyppääjää.

import { Phase } from '../jump.js';
import { makeRng, clamp, lerp } from '../util.js';
import { JumperSprite, COLORS } from './jumper.js';

const VIEW_METERS = 22;     // ruudun lyhyemmälle sivulle mahtuva matka
const JUMPER_SCALE = 1.5;  // hyppääjä piirretään hieman luonnollista suurempana

const CAM_OFFSET = {
  [Phase.READY]: [3, -1],
  [Phase.INRUN]: [4, -1.5],
  [Phase.FLIGHT]: [5, -2.5],
  [Phase.SLIDE]: [2, 0.5],
  [Phase.DONE]: [0, 1],
};

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
    this.streaks = [];     // ilmavirtaviivat hyppääjän ympärillä
    this.streakDebt = 0;
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
    this.scale = Math.min(w, h) / VIEW_METERS;
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
    this.particles.length = 0;
    this.streaks.length = 0;
    this.wobble = 0; this.shx = 0; this.shy = 0;
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
    const nx = jump.x + cam.ox, ny = jump.y + cam.oy;
    if (dt > 0) { cam.vx = (nx - cam.x) / dt; cam.vy = (ny - cam.y) / dt; }
    cam.x = nx; cam.y = ny;

    this.sprite.update(dt, jump.pose);
    this.updateWobble(jump, wind, dt);
    this.updateStreaks(jump, wind, dt);

    // Lumipöllähdys alastulossa ja jarrutuksessa
    if (jump.phase === Phase.SLIDE && this.lastPhase === Phase.FLIGHT) {
      this.spray(jump, jump.outcome === 'fall' ? 46 : 22, 1);
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
    const target = gliding
      ? clamp((jump.bandError + 0.45 * (wind.gustLevel || 0)) * jump.posture, 0, 1)
      : 0;
    this.wobble += (target - this.wobble) * (1 - Math.exp(-dt * 9));
    // Kevyt kameran tärinä vasta isolla virheellä
    const shake = clamp((this.wobble - 0.55) / 0.45, 0, 1) * 4;
    this.shx = shake * Math.sin(this.time * 83);
    this.shy = shake * Math.cos(this.time * 67);
  }

  /** Hyppääjän piirtoon välitettävät heilahdukset. */
  wobbleOffsets() {
    const a = this.wobble, t = this.time;
    if (a < 0.004) return null;
    return {
      roll: a * 0.07 * Math.sin(t * 5.3),                                   // koko hyppääjä keinuu
      skiA: a * 0.13 * Math.sin(t * 31),                                    // sukset väpättävät eri tahtiin
      skiB: a * 0.13 * Math.sin(t * 27 + 1.3),
      torso: a * (10 * Math.sin(t * 6.5) + 3 * Math.sin(t * 11.3 + 0.7)),   // vartalo keinuu (astetta)
      arm: a * (24 * Math.sin(t * 9.1 + 2) + 8 * Math.sin(t * 17)),         // kädet ja hartiat heiluvat
    };
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
    // Väri seuraa mittaria: valkoinen -> keltainen -> punainen
    const rgb = this.wobble < 0.25 ? '235, 246, 255' : this.wobble < 0.6 ? '255, 226, 120' : '255, 150, 130';
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

  spray(jump, count, power) {
    const slope = -jump.pitch;
    for (let i = 0; i < count; i++) {
      const a = slope + 0.3 + Math.random() * 1.2;
      const v = (2 + Math.random() * 5) * power;
      this.particles.push({
        x: jump.x + (Math.random() - 0.5) * 1.2,
        y: jump.y + 0.1,
        vx: jump.vx * 0.35 + Math.cos(a) * v * (Math.random() < 0.5 ? -0.4 : 1),
        vy: jump.vy * 0.35 + Math.sin(a) * v,
        life: 0.35 + Math.random() * 0.5,
        r: 0.08 + Math.random() * 0.14,
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
    this.drawJumper(ctx, jump);
    this.drawStreaks(ctx, jump, wind);
    this.drawParticles(ctx);
    this.drawFlakes(ctx);
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

    // Alastulokohdan merkki
    if (jump.touchdown) {
      const X = this.sx(jump.touchdown.x), Y = this.sy(jump.touchdown.y);
      ctx.fillStyle = '#f2542d';
      ctx.beginPath();
      ctx.moveTo(X, Y); ctx.lineTo(X - sc * 0.45, Y - sc * 1.3); ctx.lineTo(X + sc * 0.45, Y - sc * 1.3);
      ctx.fill();
    }
  }

  drawJumper(ctx, jump) {
    const sc = this.scale;
    const X = this.sx(jump.x), Y = this.sy(jump.y);
    if (jump.phase === Phase.FLIGHT && jump.x > 0) {
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
    if (jump.outcome === 'fall' && jump.phase !== Phase.FLIGHT) { this.drawSnowball(ctx, jump, X, Y); return; }
    this.sprite.draw(ctx, X, Y, sc * JUMPER_SCALE, jump.pitch, this.wobbleOffsets());
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

    // Hyppääjä pyörii pallon keskellä; kasvava pallo peittää hänet vähitellen
    this.sprite.draw(ctx, -0.25 * js, 0.45 * js, js, 0);

    if (R > 0.15 * sc) {
      // Pallosta törröttävät sukset, käsi ja mono
      const stick = (angle, len, width, color) => {
        const c = Math.cos(angle), s = Math.sin(angle);
        ctx.strokeStyle = color;
        ctx.lineWidth = width * js;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(c * R * 0.7, s * R * 0.7);
        ctx.lineTo(c * (R + len * js), s * (R + len * js));
        ctx.stroke();
      };
      const grown = clamp((jump.ballRadius - 1.6) / 0.8, 0, 1); // isossa pallossa näkyvät vain tyngät
      if (grown > 0) {
        stick(-0.5, 0.75 * grown, 0.07, COLORS.ski);
        stick(2.5, 0.6 * grown, 0.07, COLORS.ski);
        stick(1.2, 0.4 * grown, 0.11, COLORS.suitDark);
        stick(-2.1, 0.3 * grown, 0.14, COLORS.boot);
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
