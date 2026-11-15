// DOM-käyttöliittymä: alkuruutu, tulospaneeli ja ohjauspainikkeiden tekstit.

import { Phase } from './jump.js';

const $ = (id) => document.getElementById(id);

const ACTION_LABEL = {
  [Phase.READY]: 'LÄHTÖ',
  [Phase.INRUN]: 'PONNISTA',
  [Phase.FLIGHT]: 'ALASTULO',
  [Phase.SLIDE]: '',
  [Phase.DONE]: '',
};

const OUTCOME_TEXT = {
  telemark: 'Telemark-alastulo',
  twofoot: 'Tasajalka-alastulo',
  fall: 'Kaatuminen',
};

const fmt = (v) => v.toFixed(1).replace('.', ',');

export class Ui {
  constructor() {
    this.title = $('title');
    this.result = $('result');
    this.controls = $('controls');
    this.btnAction = $('btn-action');
    this.btnFwd = $('btn-fwd');
    this.btnBack = $('btn-back');
    this.lastLabel = null;
    this.lastLean = null;
  }

  onStart(fn) { $('btn-start').addEventListener('click', fn); }
  onAgain(fn) { $('btn-again').addEventListener('click', fn); }

  showTitle(best) {
    this.title.hidden = false;
    this.result.hidden = true;
    this.controls.hidden = true;
    $('title-best').textContent = best?.distance
      ? `Mäkiennätyksesi: ${fmt(best.distance)} m · ${fmt(best.total)} p`
      : '';
  }

  showGame() {
    this.title.hidden = true;
    this.result.hidden = true;
    this.controls.hidden = false;
  }

  get resultVisible() { return !this.result.hidden; }

  showResult(r, record) {
    $('res-outcome').textContent = OUTCOME_TEXT[r.outcome];
    $('res-outcome').dataset.outcome = r.outcome;
    $('res-distance').textContent = `${fmt(r.distance)} m`;
    $('res-distpts').textContent = fmt(r.distancePoints);
    $('res-style').textContent = `3 × ${fmt(r.judge)} = ${fmt(r.style)}`;
    $('res-total').textContent = fmt(r.total);
    $('res-takeoff').textContent = `${Math.round(r.takeoffQuality * 100)} %`;
    $('res-speed').textContent = `${fmt(r.takeoffSpeed * 3.6)} km/h`;
    $('res-deductions').textContent = r.deductions.length
      ? r.deductions.map((d) => `${d.label} −${fmt(d.amount)}`).join(' · ')
      : 'Ei tyylivähennyksiä';
    const rec = $('res-record');
    if (record.distanceRecord) rec.textContent = 'Uusi mäkiennätys!';
    else if (record.pointsRecord) rec.textContent = 'Uusi piste-ennätys!';
    else rec.textContent = `Ennätys: ${fmt(record.best.distance)} m · ${fmt(record.best.total)} p`;
    rec.classList.toggle('new', record.distanceRecord || record.pointsRecord);
    this.result.hidden = false;
    this.controls.hidden = true;
  }

  /** Päivittää painikkeiden tilan pelivaiheen mukaan (DOMiin kosketaan vain muutoksissa). */
  sync(jump) {
    const label = ACTION_LABEL[jump.phase];
    if (label !== this.lastLabel) {
      this.btnAction.textContent = label;
      this.btnAction.disabled = !label;
      this.lastLabel = label;
    }
    const lean = jump.phase === Phase.FLIGHT && !jump.landPrep;
    if (lean !== this.lastLean) {
      this.btnFwd.disabled = this.btnBack.disabled = !lean;
      this.lastLean = lean;
    }
  }
}
