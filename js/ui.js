// DOM-käyttöliittymä: alkuruutu, tulospaneeli ja ohjauspainikkeiden tekstit.

import { Phase } from './jump.js';

const $ = (id) => document.getElementById(id);

const ACTION_LABEL = {
  [Phase.READY]: 'LÄHTÖ',
  [Phase.INRUN]: 'PONNISTA',
  [Phase.FLIGHT]: 'ALASTULO',
  [Phase.SLIDE]: '',
  [Phase.CRASH]: '',
  [Phase.DONE]: '',
};

const OUTCOME_TEXT = {
  telemark: 'Telemark-alastulo',
  twofoot: 'Tasajalka-alastulo',
  fall: 'Kaatuminen',
};

const GAUGE_LABEL = { small: 'pienet', full: 'isot', off: 'pois' };

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
    this.board = $('board');
    this.nameDialog = $('name-dialog');
    this.tabloid = $('tabloid');
    this.photo = $('tab-photo');
    window.addEventListener('resize', () => this.fitTabloid());
    this.nameAsk = null;   // {validate, resolve} kun nimeä kysytään
    this.boardView = null;   // {fetchTop, myName, season, current} kun tulostaulu on avattu
    $('btn-board-close').addEventListener('click', () => { this.board.hidden = true; });
    $('btn-season-prev').addEventListener('click', () => this.loadBoard(this.boardView.season - 1));
    $('btn-season-next').addEventListener('click', () => this.loadBoard(this.boardView.season + 1));
    $('name-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.nameAsk) return;
      const value = $('name-input').value;
      const error = this.nameAsk.validate(value);
      $('name-error').textContent = error ?? '';
      if (error) return;
      const { resolve } = this.nameAsk;
      this.nameAsk = null;
      this.nameDialog.hidden = true;
      resolve(value);
    });
  }

  /** Tulostaulu, nimikysely tai lehden etusivu on auki – pelin omat painallukset eivät saa mennä läpi. */
  get modalOpen() { return !this.board.hidden || !this.nameDialog.hidden || this.tabloidOpen; }

  get tabloidOpen() { return !this.tabloid.hidden; }

  /** Lehden etusivun napautus (sulkeminen hoidetaan main.js:ssä). */
  onTabloid(fn) { this.tabloid.addEventListener('click', fn); }

  /**
   * Kopioi pelikuvasta "lehtikuvan" etusivulle.
   * @param rect {x, y, w, h} lähdealue canvasin pikseleinä
   */
  capturePhoto(canvas, rect) {
    const p = this.photo;
    // Pidä alue kuvan sisällä: osa selaimista ei piirrä mitään, jos lähde ylittää reunan
    const w = Math.min(rect.w, canvas.width), h = Math.min(rect.h, canvas.height);
    const x = Math.max(0, Math.min(rect.x, canvas.width - w)), y = Math.max(0, Math.min(rect.y, canvas.height - h));
    try {
      p.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, p.width, p.height);
    } catch { /* kuva jää tyhjäksi – etusivu toimii silti */ }
  }

  /** Näyttää Iltapulun etusivun. page = makeTabloid()-olio. */
  showTabloid(page) {
    $('tab-date').textContent = page.date;
    $('tab-kicker').textContent = page.kicker;
    $('tab-who').textContent = page.who;
    $('tab-headline').textContent = page.headline;
    $('tab-caption').textContent = page.caption;
    $('tab-burst').textContent = page.burst;
    $('tab-injuries').replaceChildren(...page.injuries.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
    $('tab-strap').textContent = page.strap;
    $('tab-quote').textContent = page.quote;
    this.tabloid.hidden = false;
    this.fitTabloid();
  }

  /** Skaalaa lehden täyttämään ruudun: isolla näytöllä iso, pienellä puhelimella kokonaan näkyvissä. */
  fitTabloid() {
    if (this.tabloid.hidden) return;
    const paper = this.tabloid.querySelector('.paper');
    paper.style.zoom = 1;
    const cs = getComputedStyle(this.tabloid);
    const availW = this.tabloid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = this.tabloid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 36; // "Napauta jatkaaksesi"
    // 0.96: lehti on hieman vinossa, kulmat tarvitsevat tilaa
    const scale = Math.min(availW / paper.offsetWidth, availH / paper.offsetHeight) * 0.96;
    paper.style.zoom = Math.max(0.5, Math.min(scale, 3));
  }

  hideTabloid() { this.tabloid.hidden = true; }

  /** Näyttää Tulostaulu-painikkeet (vain kun tulostaulu on käytössä). */
  onBoard(fn) {
    for (const id of ['btn-board', 'btn-board-result']) {
      $(id).hidden = false;
      $(id).addEventListener('click', fn);
    }
  }

  /** Kysyy nimen. validate(nimi) palauttaa virhetekstin tai null. Ratkeaa kelvolliseen nimeen. */
  askName(validate, { error = '', value = '' } = {}) {
    const input = $('name-input');
    input.value = value;
    $('name-error').textContent = error;
    this.nameDialog.hidden = false;
    input.focus();
    input.select();
    return new Promise((resolve) => { this.nameAsk = { validate, resolve }; });
  }

  /** Avaa tulostaulun nykyiselle kaudelle. fetchTop(kausi) palauttaa Promisen; kausi puuttuu = nykyinen. */
  showBoard(fetchTop, myName) {
    this.boardView = { fetchTop, myName, season: null, current: null, loading: null };
    $('board-season-name').textContent = '';
    this.board.hidden = false;
    return this.loadBoard();
  }

  /** Hakee ja näyttää yhden kauden tulokset. */
  async loadBoard(season) {
    const view = this.boardView;
    const { myName } = view;
    const list = $('board-list');
    const status = $('board-status');
    const prev = $('btn-season-prev'), next = $('btn-season-next');
    const load = (view.loading = {}); // vain viimeisin haku saa päivittää näkymän
    const stale = () => view.loading !== load || this.boardView !== view;
    list.replaceChildren();
    status.textContent = 'Haetaan…';
    prev.disabled = next.disabled = true;
    let data;
    try {
      data = await view.fetchTop(season);
    } catch {
      if (stale()) return;
      status.textContent = 'Tulostaulua ei saatu haettua. Tarkista yhteys.';
      if (view.season) { prev.disabled = view.season <= 1; next.disabled = view.season >= view.current; }
      return;
    }
    if (stale()) return;
    const { top } = data;
    view.season = data.season;
    view.current = data.currentSeason;
    $('board-season-name').textContent = `Kausi ${data.season}: ${data.seasonName}`;
    prev.disabled = data.season <= 1;
    next.disabled = data.season >= data.currentSeason;
    status.textContent = top.length ? ''
      : data.season === data.currentSeason ? 'Ei vielä tuloksia – hyppää ensimmäinen!' : 'Ei tuloksia tältä kaudelta.';
    const cell = (cls, text) => {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = text;
      return el;
    };
    list.replaceChildren(...top.map((e, i) => {
      const li = document.createElement('li');
      if (e.name === myName) li.className = 'me';
      li.append(cell('rank', `${i + 1}.`), cell('name', e.name), cell('dist', `${fmt(e.distance)} m`), cell('pts', fmt(e.total)));
      return li;
    }));
    list.querySelector('.me')?.scrollIntoView({ block: 'nearest' });
  }

  /** Tulospaneelin rivi tulostaulun tilasta. Tyhjä teksti piilottaa rivin. */
  setOnline(text, good = false) {
    const el = $('res-online');
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('good', good);
  }

  onGauges(fn) { $('btn-gauges').addEventListener('click', fn); }
  setGauges(mode) { $('btn-gauges').textContent = `Mittarit: ${GAUGE_LABEL[mode]}`; }

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
    this.tabloid.hidden = true;
    this.title.hidden = true;
    this.result.hidden = true;
    this.controls.hidden = false;
  }

  get resultVisible() { return !this.result.hidden; }

  showResult(r, record) {
    $('res-outcome').textContent = r.crash === 'inrun' ? 'Kaatuminen vauhtimäessä'
      : r.crash === 'flight' ? 'Kaatuminen ilmassa' : OUTCOME_TEXT[r.outcome];
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
    const lean = jump.phase === Phase.INRUN || (jump.phase === Phase.FLIGHT && !jump.landPrep);
    if (lean !== this.lastLean) {
      this.btnFwd.disabled = this.btnBack.disabled = !lean;
      this.lastLean = lean;
    }
  }
}
