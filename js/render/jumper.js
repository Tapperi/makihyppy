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
const KEYS = ['shin', 'thigh', 'torso', 'arm', 'split'];
const NO_WOBBLE = { roll: 0, skiA: 0, skiB: 0, torso: 0, arm: 0 };

const LEN = { shin: 0.46, thigh: 0.46, torso: 0.62, arm: 0.6, neck: 0.2 };
const SKI_BACK = -0.95, SKI_FRONT = 1.5;

export const COLORS = {
  suit: '#e2383f',
  suitDark: '#a8242b',
  helmet: '#1d3557',
  ski: '#ffcf33',
  boot: '#20242c',
  glove: '#20242c',
};

export class JumperSprite {
  constructor() {
    this.cur = { ...POSES.gate };
    this.fallTilt = 0;
  }

  snap(pose) {
    this.cur = { ...POSES[pose] };
    this.fallTilt = 0;
  }

  update(dt, pose) {
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
   */
  draw(ctx, X, Y, scale, pitch, wob = null) {
    const w = wob ?? NO_WOBBLE;
    const c = { ...this.cur };
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

    const line = (a, b, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    const ski = (footX, tilt) => {
      ctx.save();
      ctx.translate(footX, 0.03);
      ctx.rotate(tilt);
      ctx.strokeStyle = COLORS.ski;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(SKI_BACK, 0);
      ctx.lineTo(SKI_FRONT - 0.12, 0);
      ctx.quadraticCurveTo(SKI_FRONT, 0, SKI_FRONT + 0.03, 0.09); // kärjen taivutus
      ctx.stroke();
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

    // Takajalka: kaksiniveinen IK lonkasta takamonoon, polvi eteenpäin
    if (c.split > 0.02) {
      const backKnee = solveKnee(hip, backFoot, LEN.thigh, LEN.shin);
      line(hip, backKnee, 0.17, COLORS.suitDark);
      line(backKnee, backFoot, 0.15, COLORS.suitDark);
      line(backFoot, [backFoot[0] + 0.2, 0.02], 0.13, COLORS.boot);
    }

    // Etujalka
    line(frontFoot, [frontFoot[0] + 0.22, 0.02], 0.13, COLORS.boot);
    line(frontFoot, knee, 0.16, COLORS.suit);
    line(knee, hip, 0.19, COLORS.suit);
    // Vartalo, käsi, pää
    line(hip, shoulder, 0.25, COLORS.suit);
    line(shoulder, hand, 0.11, COLORS.suitDark);
    ctx.fillStyle = COLORS.glove;
    ctx.beginPath(); ctx.arc(hand[0], hand[1], 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.helmet;
    ctx.beginPath(); ctx.arc(head[0], head[1], 0.135, 0, Math.PI * 2); ctx.fill();
    // Lasit
    const gd = dir(c.torso - 55);
    line(add(head, gd, 0.07), add(head, gd, 0.135), 0.07, '#f4f1de');
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
