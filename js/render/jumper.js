// Hyppääjän piirto nivelkulmista. Kaikki mitat metreinä suksen koordinaatistossa:
// x suksen kärkeä kohti, y suksesta ylöspäin, origo monon kohdalla.

import { DEG } from '../config.js';

// Kulmat asteina suksen suunnasta vastapäivään. split = jalkojen etäisyys (telemark).
const POSES = {
  gate:     { shin: 78, thigh: 172, torso: 80, arm: 262, split: 0 },
  crouch:   { shin: 55, thigh: 165, torso: 12, arm: 195, split: 0 },
  extend:   { shin: 62, thigh: 72, torso: 46, arm: 208, split: 0 },
  flight:   { shin: 38, thigh: 30, torso: 20, arm: 201, split: 0 },
  prep:     { shin: 70, thigh: 96, torso: 66, arm: 135, split: 0.12 },
  telemark: { shin: 60, thigh: 120, torso: 74, arm: 172, split: 0.42 },
  twofoot:  { shin: 58, thigh: 128, torso: 52, arm: 150, split: 0 },
  outrun:   { shin: 82, thigh: 96, torso: 86, arm: 62, split: 0 },
  fall:     { shin: 150, thigh: 175, torso: 8, arm: 40, split: 0.3 },
};
// Kaatunut hyppääjä makaa rinteessä pää ylämäkeen
const SPRAWL = { shin: 170, thigh: 178, torso: 172, arm: 160, split: 0.35 };
const KEYS = ['shin', 'thigh', 'torso', 'arm', 'split'];
const lerp = (a, b, t) => a + (b - a) * t;
const NO_WOBBLE = { roll: 0, skiA: 0, skiB: 0, torso: 0, arm: 0 };

// Ohjaussignaalin (guidance.js: lean -1..1) siirtymät asteina täydellä poikkeamalla.
// high = osoitin ylhäällä: pitää nojata eteen. low = osoitin alhaalla: pitää nojata taakse.
const LEAN = {
  // Vauhtimäki: asento nousee ja paino valuu kantapäille / hyppääjä painuu kärkien päälle
  crouch: {
    high: { shin: 14, thigh: -16, torso: 26, arm: 10 },
    low: { shin: -11, thigh: 6, torso: -15, arm: -8 },
  },
  // Lento: vartalo irtoaa suksista purjeeksi / liimautuu suksiin ja pää menee kärkien yli
  flight: {
    high: { shin: 8, thigh: 14, torso: 20, arm: 26 },
    low: { shin: -8, thigh: -8, torso: -14, arm: -13 },
  },
};
const LEAN_KEYS = ['shin', 'thigh', 'torso', 'arm'];

const LEN = { shin: 0.46, thigh: 0.46, torso: 0.62, arm: 0.6, neck: 0.2 };
const SKI_BACK = -0.95, SKI_FRONT = 1.5;

// Puku ja sukset ovat tarkoituksella muuta kuin vihreää, keltaista tai punaista:
// ne värit on varattu ohjaussignaalille (guidance.js).
export const COLORS = {
  suit: '#2f7fd6',
  suitDark: '#1f579c',
  helmet: '#1d3557',
  ski: '#2b3340',
  boot: '#20242c',
  glove: '#20242c',
};

export class JumperSprite {
  constructor() {
    this.cur = { ...POSES.gate };
    this.fallTilt = 0;
    this.skis = true;      // false, kun sukset ovat irronneet kaatuessa
    this.limp = false;     // holtiton ragdoll: molemmat kädet piirretään
    this.flail = 0;        // raajojen heilunnan vaihe
    this.lean = 0;         // pehmennetty ohjaussignaali -1..1
    this.leanKind = 'crouch';
  }

  snap(pose) {
    this.cur = { ...POSES[pose] };
    this.fallTilt = 0;
    this.skis = true;
    this.limp = false;
    this.flail = 0;
    this.lean = 0;
  }

  /** Isku heittää raajat äkisti uuteen asentoon. */
  jolt() {
    this.flail += 1.5 + Math.random() * 3;
  }

  /** Lantion paikka suksen koordinaatistossa (m): ragdoll pyörii tämän ympäri. */
  hip() {
    const c = this.cur;
    return [
      c.split + Math.cos(c.shin * DEG) * LEN.shin + Math.cos(c.thigh * DEG) * LEN.thigh,
      Math.sin(c.shin * DEG) * LEN.shin + Math.sin(c.thigh * DEG) * LEN.thigh,
    ];
  }

  /**
   * @param energy 0..1: kaatuessa kuinka rajusti raajat heiluvat (0 = makaa paikallaan)
   * @param lean   -1..1: ohjaussignaali, näkyy vain kyykyssä ja lentoasennossa
   */
  update(dt, pose, energy = 0, lean = 0) {
    const guided = pose === 'crouch' || pose === 'flight';
    if (guided) this.leanKind = pose;
    this.lean += ((guided ? lean : 0) - this.lean) * (1 - Math.exp(-dt * 16));
    this.limp = pose === 'ragdoll';
    if (this.limp) {
      // Raajat viuhtovat eri tahtiin vauhdin mukana; vauhdin loputtua hyppääjä jää makaamaan
      this.flail += dt * (6 + 16 * energy);
      const p = this.flail;
      const wild = {
        shin: 100 + 75 * Math.sin(p),
        thigh: 110 + 80 * Math.sin(p * 1.37 + 1),
        torso: 60 + 70 * Math.sin(p * 0.83 + 2),
        arm: 150 + 170 * Math.sin(p * 1.71 + 0.5),
        split: 0.28 + 0.22 * Math.sin(p * 1.2 + 3),
      };
      const k = 1 - Math.exp(-dt * 28);
      for (const key of KEYS) this.cur[key] += (lerp(SPRAWL[key], wild[key], energy) - this.cur[key]) * k;
      this.fallTilt = 0;
      return;
    }
    const target = POSES[pose] ?? POSES.flight;
    const rate = pose === 'extend' ? 30 : pose === 'fall' ? 9 : 14;
    const k = 1 - Math.exp(-dt * rate);
    for (const key of KEYS) this.cur[key] += (target[key] - this.cur[key]) * k;
    const tiltTarget = pose === 'fall' ? 1 : 0;
    this.fallTilt += (tiltTarget - this.fallTilt) * (1 - Math.exp(-dt * 7));
  }

  /**
   * @param ctx    canvas
   * @param X,Y    monon paikka ruudulla (px)
   * @param scale  px / m
   * @param pitch  suksien kulma vaakatasosta (rad, + = kärjet ylös)
   * @param wob    huojunta: {roll, skiA, skiB (rad), torso, arm (astetta)} tai null
   * @param look   ohjausvärit: {ski, halo, haloAlpha, high} tai null.
   *               ski = suksien väri, halo = hahmon ääriviivan väri (tai null),
   *               high = -1..1: kumpi suksen pää on liian korkealla (+ = kärki) – se pää hehkuu
   */
  draw(ctx, X, Y, scale, pitch, wob = null, look = null) {
    const w = wob ?? NO_WOBBLE;
    const c = { ...this.cur };
    if (Math.abs(this.lean) > 0.002) {
      const d = LEAN[this.leanKind][this.lean > 0 ? 'high' : 'low'], amount = Math.abs(this.lean);
      for (const key of LEAN_KEYS) c[key] += d[key] * amount;
    }
    c.torso += w.torso;
    c.thigh += w.torso * 0.4;
    c.arm += w.arm;
    const dir = (deg) => [Math.cos(deg * DEG), Math.sin(deg * DEG)];
    const add = (p, d, len) => [p[0] + d[0] * len, p[1] + d[1] * len];

    ctx.save();
    ctx.translate(X, Y);
    ctx.scale(scale, -scale); // metrit, y ylöspäin
    ctx.rotate(pitch + w.roll);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const ski = (footX, tilt) => {
      if (!this.skis) return;
      ctx.save();
      ctx.translate(footX, 0.03);
      ctx.rotate(tilt);
      const stroke = (color, width, from = SKI_BACK, to = SKI_FRONT) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(from, 0);
        if (to < SKI_FRONT) ctx.lineTo(to, 0);
        else {
          ctx.lineTo(SKI_FRONT - 0.12, 0);
          ctx.quadraticCurveTo(SKI_FRONT, 0, SKI_FRONT + 0.03, 0.09); // kärjen taivutus
        }
        ctx.stroke();
      };
      if (!look) stroke(COLORS.ski, 0.07);
      else {
        // Sukset ovat mittarin osoitin: hehku, tumma reunus ja tilan värinen ydin
        ctx.globalAlpha = 0.3;
        stroke(look.ski, 0.3);
        ctx.globalAlpha = 1;
        stroke(COLORS.ski, 0.17);
        stroke(look.ski, 0.1);
        if (Math.abs(look.high) > 0.02) {
          // Liian korkealla oleva pää hehkuu: "paina kirkas pää alas"
          ctx.globalAlpha = Math.min(1, Math.abs(look.high) * 1.3);
          if (look.high > 0) stroke('#ffffff', 0.1, SKI_FRONT - 0.85);
          else stroke('#ffffff', 0.1, SKI_BACK, SKI_BACK + 0.85);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    };

    const fall = this.fallTilt;
    // Takasuksi ja takajalka
    const backFoot = [-c.split, 0];
    const frontFoot = [c.split, 0];
    ski(backFoot[0], fall * -0.35 + w.skiB);

    // Kaatuessa vartalo kiertyy eteen ja painuu hankeen
    ctx.save();
    if (fall > 0.001) {
      ctx.translate(0, 0.12 * fall);
      ctx.rotate(-fall * 0.25);
    }

    const knee = add(frontFoot, dir(c.shin), LEN.shin);
    const hip = add(knee, dir(c.thigh), LEN.thigh);
    const shoulder = add(hip, dir(c.torso), LEN.torso);
    const head = add(shoulder, dir(c.torso + 8), LEN.neck);
    const hand = add(shoulder, dir(c.arm), LEN.arm);

    // Hahmon osat piirtojärjestyksessä: viivat [a, b, leveys, väri] ja pallot [keskipiste, säde, väri]
    const parts = [];
    // Takajalka: kaksiniveinen IK lonkasta takamonoon, polvi eteenpäin
    if (c.split > 0.02) {
      const backKnee = solveKnee(hip, backFoot, LEN.thigh, LEN.shin);
      parts.push([hip, backKnee, 0.17, COLORS.suitDark]);
      parts.push([backKnee, backFoot, 0.15, COLORS.suitDark]);
      parts.push([backFoot, [backFoot[0] + 0.2, 0.02], 0.13, COLORS.boot]);
    }
    // Holtittomasti pyörivällä hyppääjällä näkyy myös toinen käsi
    if (this.limp) {
      const hand2 = add(shoulder, dir(c.arm + 150 + 40 * Math.sin(this.flail * 1.3)), LEN.arm);
      parts.push([shoulder, hand2, 0.11, COLORS.suitDark]);
      parts.push([hand2, 0.07, COLORS.glove]);
    }
    // Etujalka
    parts.push([frontFoot, [frontFoot[0] + 0.22, 0.02], 0.13, COLORS.boot]);
    parts.push([frontFoot, knee, 0.16, COLORS.suit]);
    parts.push([knee, hip, 0.19, COLORS.suit]);
    // Vartalo, käsi, pää
    parts.push([hip, shoulder, 0.25, COLORS.suit]);
    parts.push([shoulder, hand, 0.11, COLORS.suitDark]);
    parts.push([hand, 0.07, COLORS.glove]);
    parts.push([head, 0.135, COLORS.helmet]);
    // Lasit
    const gd = dir(c.torso - 55);
    parts.push([add(head, gd, 0.07), add(head, gd, 0.135), 0.07, '#f4f1de']);

    const paint = (grow, override) => {
      for (const p of parts) {
        if (p.length === 4) {
          ctx.strokeStyle = override ?? p[3];
          ctx.lineWidth = p[2] + grow;
          ctx.beginPath();
          ctx.moveTo(p[0][0], p[0][1]);
          ctx.lineTo(p[1][0], p[1][1]);
          ctx.stroke();
        } else {
          ctx.fillStyle = override ?? p[2];
          ctx.beginPath(); ctx.arc(p[0][0], p[0][1], p[1] + grow / 2, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    if (look?.halo) {
      // Ääriviiva tilan värillä: varoitus näkyy koko hahmossa
      ctx.globalAlpha = look.haloAlpha;
      paint(0.16, look.halo);
      ctx.globalAlpha = 1;
    }
    paint(0, null);
    ctx.restore();

    // Etusuksi päällimmäiseksi
    ski(frontFoot[0], fall * 0.45 + w.skiA);
    ctx.restore();
  }
}

/** Polven paikka, kun lonkka ja nilkka tunnetaan. Polvi taipuu +x-suuntaan. */
function solveKnee(hip, foot, l1, l2) {
  const dx = foot[0] - hip[0], dy = foot[1] - hip[1];
  const dist = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy);
  // kaksi ratkaisua – valitaan se, jonka x on suurempi (polvi edessä)
  const k1 = [hip[0] + ux * a - uy * h, hip[1] + uy * a + ux * h];
  const k2 = [hip[0] + ux * a + uy * h, hip[1] + uy * a - ux * h];
  return k1[0] > k2[0] ? k1 : k2;
}
