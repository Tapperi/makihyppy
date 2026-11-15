// Pelinaikainen HUD canvasille: tuuli, nopeus, ponnistuspalkki, asentomittari, viestit.

import { Phase } from '../jump.js';
import { INRUN, TAKEOFF, FLIGHT, WIND, BAND, CRASH, DEG } from '../config.js';
import { takeoffQuality, lateTakeoffQuality } from '../physics.js';
import { clamp } from '../util.js';

// Vanhemmissa selaimissa (esim. Safari < 16) ei ole roundRectia: käytä suorakulmiota
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PANEL = 'rgba(13, 27, 42, 0.72)';
const GOOD = '#52d273', WARN = '#ffd23f', BAD = '#ff5d5d';
const RED_ZONE = '#7a2e39', CRASH_ZONE = '#e0102e'; // mittarin punainen ja sen kaatumisalue

const fmt = (v) => v.toFixed(1).replace('.', ',');

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
}

function qualityColor(q) {
  return q >= 0.9 ? GOOD : q >= 0.6 ? WARN : BAD;
}

/** Leveässä (selain)näkymässä asentomittari on keskellä ponnistuspalkin paikalla, kapeassa oikeassa reunassa. */
const isWide = ({ W, H }) => W > H;
const BAR_Y = 104;          // ponnistuspalkin yläreuna turva-alueesta (px)
const GAUGE_SHOW = 0.35;    // asentomittari tulee näkyviin näin pian ponnistuksen jälkeen (s)

function gaugeRect({ W, H, top }) {
  const gh = Math.min(170, H * 0.24), gw = 16;
  return isWide({ W, H })
    ? { x: W / 2 - gw / 2 - 7, y: top + BAR_Y + 16, gw, gh }
    : { x: W - 12 - 30, y: top + BAR_Y + 54, gw, gh };
}

/** Vauhtimäessä ponnistuspalkki on keskellä: leveässä näkymässä tasapainomittari sen oikealla puolella. */
function balanceRect(view) {
  const r = gaugeRect(view);
  if (!isWide(view)) return r;
  const bw = Math.min(view.W - 32, 360);
  return { ...r, x: Math.min(view.W / 2 + bw / 2 + 28, view.W - 12 - 30), y: view.top + BAR_Y + 16 };
}

/** Arvio ajasta maakosketukseen (s), tai Infinity. */
export function timeToGround(jump) {
  const slope = jump.hill.slopeAtX(jump.x);
  const closing = -(jump.vx * Math.sin(slope) + jump.vy * Math.cos(slope));
  return closing > 0.1 ? jump.height / closing : Infinity;
}

export function takeoffLabel(jump) {
  const t = jump.takeoff;
  if (!t.pressed) return { text: 'Ponnistus jäi väliin!', color: BAD };
  const q = t.quality;
  const when = t.late ? ' – myöhässä' : t.at > TAKEOFF.optimum + TAKEOFF.perfect ? ' – aikaisin' : '';
  if (q >= 0.97) return { text: 'Täydellinen ponnistus!', color: GOOD };
  if (q >= 0.85) return { text: 'Hyvä ponnistus' + when, color: GOOD };
  if (q >= 0.6) return { text: 'Kohtalainen ponnistus' + when, color: WARN };
  return { text: 'Heikko ponnistus' + when, color: BAD };
}

export class Hud {
  constructor(ctx) {
    this.ctx = ctx;
    this.barGradient = null;
    this.barKey = '';
  }

  /**
   * Mittarin pohja: punainen palkki, jonka päissä kirkkaampi kaatumisalue (y-rajat ruudulla).
   * Kaatumisvaaran kasvaessa alue vilkkuu.
   */
  gaugeBase(x, y, gw, gh, topEnd, bottomStart, jump) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, gw, gh, 5); ctx.clip();
    ctx.fillStyle = RED_ZONE;
    ctx.fillRect(x, y, gw, gh);
    ctx.fillStyle = jump.danger > 0 && Math.sin(jump.t * 40) > 0 ? '#ffffff' : CRASH_ZONE;
    if (topEnd > y) ctx.fillRect(x, y, gw, topEnd - y);
    if (bottomStart < y + gh) ctx.fillRect(x, bottomStart, gw, y + gh - bottomStart);
    ctx.restore();
  }

  /** Mittarin kehys: väri tilan mukaan, kaatumisvaarassa paksu ja vilkkuva. */
  gaugeFrame(x, y, gw, gh, state, label, jump) {
    const ctx = this.ctx, d = jump.danger;
    panel(ctx, x - 10, y - 22, gw + 34, gh + 34);
    const color = d > 0 ? (Math.sin(jump.t * 40) > 0 ? '#ffffff' : CRASH_ZONE) : state;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + 4 * d;
    ctx.beginPath(); ctx.roundRect(x - 10, y - 22, gw + 34, gh + 34, 10); ctx.stroke();
    ctx.fillStyle = d > 0 ? color : state;
    ctx.font = `600 9px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x + gw / 2 + 7, y - 9);
  }

  /**
   * @param view {W, H, top} – top = yläreunan turva-alue (px)
   */
  draw(view, jump, wind) {
    const { top } = view;
    this.drawWind(12, top + 10, wind);
    this.drawInfo(view, jump);

    const inAir = jump.phase === Phase.FLIGHT;
    // Leveässä näkymässä mittari korvaa ponnistuspalkin heti kun se tulee näkyviin
    const barUntil = isWide(view) ? GAUGE_SHOW : 1.3;
    if (jump.phase === Phase.INRUN || (inAir && jump.t <= barUntil)) this.drawTakeoffBar(view, jump);
    if (jump.phase === Phase.INRUN) this.drawBalanceGauge(view, jump);
    if (inAir && jump.t > GAUGE_SHOW) this.drawAoaGauge(view, jump, wind);
    this.drawMessage(view, jump);
  }

  // --- Tuuli: nuoli, lukema ja lyhyt historia ---
  drawWind(x, y, wind) {
    const ctx = this.ctx, w = wind.value, pw = 148, ph = 74;
    panel(ctx, x, y, pw, ph);
    const head = w >= 0;
    const color = Math.abs(w) < 0.3 ? '#dfe9f2' : head ? GOOD : BAD;

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9db4c8';
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText('TUULI', x + 10, y + 16);
    // Puuskavaroitus vilkkuu jo ennen kuin puuska alkaa vaikuttaa
    const alert = wind.gustAlert || 0;
    if (alert > 0.05) {
      ctx.globalAlpha = alert * (0.65 + 0.35 * Math.sin(wind.t * 30));
      ctx.fillStyle = WARN;
      ctx.fillText('PUUSKA!', x + 46, y + 16);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(`${fmt(Math.abs(w))} m/s`, x + 10, y + 39);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(Math.abs(w) < 0.3 ? 'tyyntä' : head ? 'vastatuuli' : 'myötätuuli', x + 10, y + 54);

    // Nuoli: vastatuuli osoittaa vasemmalle (hyppääjää vastaan)
    const cx = x + pw - 34, cy = y + 26;
    const len = 8 + 18 * clamp(Math.abs(w) / WIND.max, 0, 1);
    const dir = head ? -1 : 1;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - dir * len, cy); ctx.lineTo(cx + dir * (len - 6), cy); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + dir * (len + 4), cy); ctx.lineTo(cx + dir * (len - 7), cy - 8); ctx.lineTo(cx + dir * (len - 7), cy + 8);
    ctx.fill();

    // Historia
    const hx = x + 84, hy = y + 58, hw = pw - 94, hh = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + hw, hy); ctx.stroke();
    const hist = wind.history;
    if (hist.length > 1) {
      ctx.strokeStyle = '#dfe9f2';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const n = Math.min(hist.length, 60);
      for (let i = 0; i < n; i++) {
        const v = hist[hist.length - n + i];
        const px = hx + (i / 59) * hw + (60 - n) / 59 * hw, py = hy - (v / WIND.max) * hh;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // --- Oikea yläkulma: lähtöaika / nopeus / korkeus ---
  drawInfo({ W, top }, jump) {
    const ctx = this.ctx, pw = 118, ph = 56, x = W - pw - 12, y = top + 10;
    let label, value, color = '#ffffff';
    if (jump.phase === Phase.READY) {
      label = 'LÄHTÖAIKA';
      value = `${Math.ceil(jump.gateLeft)} s`;
      if (jump.gateLeft < 5) color = WARN;
    } else if (jump.phase === Phase.FLIGHT && jump.t > 0.8) {
      label = 'KORKEUS';
      value = `${fmt(Math.max(0, jump.height))} m`;
      if (!jump.landPrep && timeToGround(jump) < 0.55) color = GOOD;
    } else if (jump.touchdown) {
      label = 'PITUUS';
      value = `${fmt(jump.touchdown.distance)} m`;
    } else {
      label = 'NOPEUS';
      value = `${fmt(jump.speed * 3.6)} km/h`;
    }
    panel(ctx, x, y, pw, ph);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9db4c8';
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText(label, x + pw - 10, y + 16);
    ctx.fillStyle = color;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(value, x + pw - 10, y + 41);
  }

  // --- Ponnistuksen ajoituspalkki ---
  drawTakeoffBar({ W, top }, jump) {
    const ctx = this.ctx;
    const bw = Math.min(W - 32, 360), bh = 20, x = (W - bw) / 2, y = top + BAR_Y;
    const span = TAKEOFF.zone + TAKEOFF.lateZone;
    const uOf = (d) => clamp((TAKEOFF.zone - d) / span, 0, 1);

    // Väriliuku ponnistuksen tehon mukaan
    const key = `${x}|${bw}`;
    if (this.barKey !== key) {
      const g = ctx.createLinearGradient(x, 0, x + bw, 0);
      for (let i = 0; i <= 40; i++) {
        const d = TAKEOFF.zone - (i / 40) * span;
        const q = d >= 0 ? takeoffQuality(d) : lateTakeoffQuality(-d / 24);
        const hue = q * q * 120; // 0 = punainen, 120 = vihreä
        g.addColorStop(i / 40, `hsl(${hue}, 78%, ${38 + q * 12}%)`);
      }
      this.barGradient = g;
      this.barKey = key;
    }
    panel(ctx, x - 6, y - 6, bw + 12, bh + 12);
    ctx.fillStyle = this.barGradient;
    ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 5); ctx.fill();

    // Nokan kohta
    const ex = x + uOf(0) * bw;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ex, y - 4); ctx.lineTo(ex, y + bh + 4); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 9px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('NOKKA', ex, y - 9);

    // Osoitin: hyppääjän paikka, tai painalluksen kohta kun on jo ponnistettu
    const t = jump.takeoff;
    const d = t.pressed ? t.at : jump.phase === Phase.FLIGHT ? -jump.takeoffSpeed * jump.t : jump.d;
    const mx = x + uOf(d) * bw;
    ctx.fillStyle = t.pressed ? qualityColor(t.quality) : '#ffffff';
    ctx.strokeStyle = '#0d1b2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, y + bh * 0.55); ctx.lineTo(mx - 9, y + bh + 13); ctx.lineTo(mx + 9, y + bh + 13);
    ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mx, y - 2); ctx.lineTo(mx, y + bh + 2);
    ctx.strokeStyle = t.pressed ? qualityColor(t.quality) : '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // --- Kyykkymittari vauhtimäessä: osoitin pidetään vihreällä kaistalla ---
  drawBalanceGauge(view, jump) {
    const ctx = this.ctx;
    const { x, y, gw, gh } = balanceRect(view);
    const half = INRUN.balanceHalf, e = jump.balanceError;
    const state = e <= 0 ? GOOD : e < 0.45 ? WARN : BAD;

    this.gaugeFrame(x, y, gw, gh, state, 'KYYKKY', jump);

    const yOf = (b) => y + gh / 2 - clamp(b, -1, 1) * (gh / 2);
    // Kaatumisalue: osoitin liian kauan täällä = hyppääjä kaatuu
    const limit = half + CRASH.inrunError * INRUN.balanceErrFull;
    this.gaugeBase(x, y, gw, gh, yOf(limit), yOf(-limit), jump);
    ctx.fillStyle = '#2f9e52';
    ctx.fillRect(x, yOf(half), gw, yOf(-half) - yOf(half));

    const ny = yOf(jump.balance);
    ctx.fillStyle = state;
    ctx.beginPath();
    ctx.moveTo(x + gw + 2, ny); ctx.lineTo(x + gw + 14, ny - 7); ctx.lineTo(x + gw + 14, ny + 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 2, ny - 1.5, gw + 4, 3);
  }

  // --- Asentomittari: kohtauskulma ja tuulen mukaan liikkuva vihreä kaista ---
  drawAoaGauge(view, jump, wind) {
    const ctx = this.ctx;
    const { x, y, gw, gh } = gaugeRect(view);
    const range = BAND.range;
    const err = jump.aoa - FLIGHT.aoaOpt; // + = kärjet ylempänä
    const c = jump.bandCenter, half = jump.bandHalf;
    const e = jump.bandError;
    // Mittarin väri virheen mukaan: vihreä -> keltainen -> punainen
    const state = jump.landPrep ? '#9db4c8' : e <= 0 ? GOOD : e < 0.45 ? WARN : BAD;

    // Puuskassa koko mittari värisee
    const alert = wind.gustAlert || 0;
    ctx.save();
    if (alert > 0.02) ctx.translate(Math.sin(jump.t * 70) * 2.2 * alert, Math.cos(jump.t * 53) * 1.6 * alert);

    this.gaugeFrame(x, y, gw, gh, state, 'ASENTO', jump);

    const yOf = (a) => y + gh / 2 - (clamp(a, -range, range) / range) * (gh / 2);
    // Kaatumisalueet: takareunan yllä kauempana kuin etureunan alla
    this.gaugeBase(x, y, gw, gh, yOf(c + half + CRASH.flightBack), yOf(c - half - CRASH.flightFront), jump);
    // Takareunan yläpuolella noste hiipuu loivasti (keltainen), etureunan alla se romahtaa (punainen)
    ctx.fillStyle = '#9a7b1f';
    ctx.fillRect(x, yOf(c + half + 6 * DEG), gw, yOf(c + half) - yOf(c + half + 6 * DEG));
    ctx.fillStyle = '#2f9e52';
    ctx.fillRect(x, yOf(c + half), gw, yOf(c - half) - yOf(c + half));
    // Herkkukaista etureunassa: paras noste aivan reunalla
    const sweet = Math.min(BAND.sweet, half);
    ctx.fillStyle = '#8dffab';
    ctx.fillRect(x, yOf(c - half + sweet), gw, yOf(c - half) - yOf(c - half + sweet));

    const ny = yOf(err);
    ctx.fillStyle = state;
    ctx.beginPath();
    ctx.moveTo(x + gw + 2, ny); ctx.lineTo(x + gw + 14, ny - 7); ctx.lineTo(x + gw + 14, ny + 7);
    ctx.fill();
    ctx.fillStyle = jump.landPrep ? '#9db4c8' : '#ffffff';
    ctx.fillRect(x - 2, ny - 1.5, gw + 4, 3);
    ctx.restore();
  }

  // --- Viestit ruudun keskellä ---
  drawMessage(view, jump) {
    const { W, H, top } = view;
    const ctx = this.ctx;
    let text = null, color = '#ffffff', size = 17, y = top + 164, sub = null;

    switch (jump.phase) {
      case Phase.READY:
        text = 'Odota sopivaa tuulta';
        sub = 'Napauta tai paina välilyöntiä lähteäksesi';
        y = top + 118;
        break;
      case Phase.INRUN:
        if (jump.takeoff.pressed) ({ text, color } = takeoffLabel(jump));
        else if (jump.danger > 0.2) { text = jump.balance > 0 ? '▼ KAATUMISVAARA!' : '▲ KAATUMISVAARA!'; color = BAD; size = 22; }
        else if (jump.d <= TAKEOFF.zone) { text = 'PONNISTA NOKALLA!'; color = WARN; }
        else if (jump.balance > INRUN.balanceHalf) { text = '▼ nojaa eteen'; color = WARN; }
        else if (jump.balance < -INRUN.balanceHalf) { text = '▲ nojaa taakse'; color = WARN; }
        else text = 'Pidä kyykky kaistalla';
        break;
      case Phase.FLIGHT:
        // Leveässä näkymässä mittari on keskellä: viestit sen alle
        if (isWide(view) && jump.t > GAUGE_SHOW) { const g = gaugeRect(view); y = g.y + g.gh + 36; }
        if (jump.t < 1.3) ({ text, color } = takeoffLabel(jump));
        else if (!jump.landPrep && timeToGround(jump) < 0.55) { text = 'ALASTULO!'; color = GOOD; size = 22; }
        else if (jump.danger > 0.2) {
          text = jump.aoa > FLIGHT.aoaOpt + jump.bandCenter ? '▼ KAATUMISVAARA!' : '▲ KAATUMISVAARA!';
          color = BAD; size = 22;
        }
        else if (!jump.landPrep) {
          const err = jump.aoa - FLIGHT.aoaOpt - jump.bandCenter;
          if (err > jump.bandHalf + 1 * DEG) { text = '▼ nojaa eteen'; color = WARN; }
          else if (err < -jump.bandHalf) { text = '▲ nojaa taakse'; color = BAD; }
        }
        break;
      case Phase.SLIDE:
      case Phase.CRASH:
      case Phase.DONE:
        if (view.resultOpen) break;
        if (jump.touchdown) {
          text = `${fmt(jump.touchdown.distance)} m`;
          size = 44; y = H * 0.24;
          sub = { telemark: 'Telemark!', twofoot: 'Tasajalka-alastulo', fall: 'Kaatui!' }[jump.outcome];
          color = jump.outcome === 'fall' ? BAD : '#ffffff';
        } else if (jump.crash) {
          // Vauhtimäessä kaatunut tai ilmassa hallintansa menettänyt, joka ei ole vielä pudonnut rinteeseen
          text = 'KAATUI!';
          size = 44; y = H * 0.24; color = BAD;
          if (jump.crash === 'inrun') sub = 'Vauhtimäessä – ei tulosta';
        }
        break;
    }
    if (!text) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const outlined = (str, yy, px, fill) => {
      ctx.font = `800 ${px}px ${FONT}`;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(13, 27, 42, 0.85)';
      ctx.lineWidth = Math.max(4, px * 0.22);
      ctx.strokeText(str, W / 2, yy);
      ctx.fillStyle = fill;
      ctx.fillText(str, W / 2, yy);
    };
    outlined(text, y, size, color);
    if (sub) outlined(sub, y + size * 0.6 + 14, size > 30 ? 18 : 13, '#ffffff');
  }
}
