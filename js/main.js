// Käynnistys ja pelisilmukka. Kokoaa moduulit yhteen.

import { HILLS, STEP } from './config.js';
import { createHill } from './hill.js';
import { Wind } from './wind.js';
import { Jump, Phase } from './jump.js';
import { Input } from './input.js';
import { Scene } from './render/scene.js';
import { Hud, GAUGE_MODES } from './render/hud.js';
import { Ui } from './ui.js';
import { getBest, recordJump, getSetting, saveSetting } from './storage.js';
import { makeRng } from './util.js';
import * as lb from './leaderboard.js';
import { makeTabloid } from './tabloid.js';

const RESULT_DELAY = 2.4;   // tulospaneeli näin pian alastulon jälkeen (s)
const FALL_DELAY = 12;      // kaatuessa odotetaan, että lumipallo pysähtyy (enintään näin kauan)
const FALL_SKIP = 1;        // tämän jälkeen painallus ohittaa pyörimisen (s)
const CRASH_DELAY = 16;     // vauhtimäessä tai ilmassa kaatunut kierii alas enintään näin kauan (s)
const CRASH_SKIP = 2;       // tämän jälkeen painallus ohittaa kierimisen (s)
const AGAIN_GUARD = 0.7;    // estää vahinkopainalluksen ohittamasta tuloksia (s)
const TABLOID_GUARD = 1.2;  // Iltapulun etusivun saa suljettua vasta tämän jälkeen (s)

const canvas = document.getElementById('game');
const hill = createHill(HILLS.tuulivaara);
const rng = makeRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
const wind = new Wind(rng);
const jump = new Jump(hill, wind, rng);
const input = new Input();
const scene = new Scene(canvas, hill);
const hud = new Hud(scene.ctx);
const ui = new Ui();

const view = { W: 0, H: 0, top: 0, resultOpen: false };
let mode = 'title';      // 'title' | 'play' | 'result'
let resultShownAt = 0;
let acc = 0;
let last = 0;
let nameProblem = null;   // virheteksti, jos palvelin hylkäsi nimen – kysytään uusi ennen seuraavaa lähetystä

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.W = w; view.H = h;
  view.top = parseFloat(getComputedStyle(document.getElementById('safe-probe')).paddingTop) || 0;
  scene.resize(w, h, dpr);
}

function newJump() {
  jump.reset();
  scene.reset(jump);
  input.clear();
  acc = 0;
  mode = 'play';
  ui.showGame();
}

function finishJump(now) {
  const record = recordJump(hill.def.id, jump.result);
  ui.showResult(jump.result, record);
  if (jump.result.outcome === 'fall') {
    // Kaatumisesta kertoo ensin Iltapulun etusivu; tulokset odottavat sen alla
    if (!scene.photoTaken) takePhoto();
    ui.showTabloid(makeTabloid({
      kind: jump.crash ?? 'landing',
      kmh: jump.result.takeoffSpeed * 3.6,
      hits: jump.crashHits,
      name: lb.playerName(),
    }));
  }
  mode = 'result';
  resultShownAt = now;
  input.clear();
  submitOnline(jump.result);
}

/** Kopioi pelikuvasta lehtikuvan etusivulle. */
function takePhoto() {
  ui.capturePhoto(canvas, scene.photoRect(jump, ui.photo.width / ui.photo.height));
}

/** Sulkee lehden etusivun, jolloin tulospaneeli tulee esiin. */
function closeTabloid(now) {
  if (!ui.tabloidOpen || now - resultShownAt < TABLOID_GUARD) return;
  ui.hideTabloid();
  resultShownAt = now; // sama painallus ei saa aloittaa uutta hyppyä
  input.clear();
}

/** Alkuruudun Aloita: nimi kysytään kerran ennen ensimmäistä hyppyä. */
async function start() {
  if (mode !== 'title' || ui.modalOpen) return;
  if (lb.enabled && !lb.playerName()) lb.setPlayerName(await ui.askName(lb.nameError));
  newJump();
}

/** Lähettää tuloksen tulostauluun ja kertoo sijoituksen tulospaneelissa. */
async function submitOnline(result) {
  const showing = () => mode === 'result' && jump.result === result;
  ui.setOnline('');
  if (!lb.enabled || !lb.playerName() || result.total <= 0) return; // nollatulosta ei lähetetä
  for (;;) {
    if (nameProblem) {
      if (!showing()) return;
      lb.setPlayerName(await ui.askName(lb.nameError, { error: nameProblem, value: lb.playerName() }));
      nameProblem = null;
    }
    if (!lb.shouldSubmit(hill.def.id, result)) return;
    ui.setOnline('Lähetetään tulosta…');
    const res = await lb.submitScore(hill.def.id, result);
    if (res.reason === 'name_taken' || res.reason === 'bad_name') {
      nameProblem = res.reason === 'name_taken'
        ? 'Nimi on jo jonkun toisen käytössä. Valitse toinen.'
        : 'Nimi ei kelpaa. Valitse toinen.';
      continue;
    }
    if (!showing()) return;
    if (res.ok) ui.setOnline(res.improved ? `Tulostaulussa sijalla ${res.rank}.` : `Sijasi tulostaulussa: ${res.rank}.`, res.improved);
    else if (res.reason === 'offline') ui.setOnline('Ei yhteyttä – tulosta ei lähetetty tulostauluun.');
    else if (res.reason === 'season') ui.setOnline('Peli on päivittynyt – lataa sivu uudelleen, niin tulokset tallentuvat.');
    else if (res.reason === 'rate_limited') ui.setOnline('Liian monta lähetystä – tulosta ei tallennettu tulostauluun.');
    else ui.setOnline('Tulostaulu ei vastaa juuri nyt.');
    return;
  }
}

function frame(ts) {
  const now = ts / 1000;
  const dt = Math.min(0.05, now - last || 0);
  last = now;

  if (mode === 'title') {
    // Alkuruudussa vain tuuli ja lumi elävät
    wind.update(dt);
    input.takeAction();
  } else {
    // Kova isku pysäyttää pelin silmänräpäykseksi: tälli tuntuu
    if (scene.hitStop > 0) scene.hitStop -= dt;
    else acc += dt;
    let pressed = false;
    while (acc >= STEP) {
      const inp = mode === 'play' ? input.poll() : { action: false, lean: 0 };
      pressed ||= inp.action;
      jump.step(STEP, inp);
      acc -= STEP;
    }
    if (mode === 'play') {
      const sliding = jump.phase === Phase.SLIDE;
      const fell = jump.outcome === 'fall';
      // Ilmassa kaatuneella ei ole tulosta ennen kuin hän putoaa rinteeseen
      const crashed = jump.phase === Phase.CRASH && !!jump.result;
      const landed = jump.phase === Phase.DONE
        || (sliding && jump.t > (fell ? FALL_DELAY : RESULT_DELAY))
        || (sliding && fell && pressed && jump.t > FALL_SKIP)
        || (crashed && (jump.t > CRASH_DELAY || (pressed && jump.t > CRASH_SKIP)));
      if (landed) finishJump(now);
    } else if (input.takeAction()) {
      if (ui.tabloidOpen) closeTabloid(now);
      else if (!ui.modalOpen && now - resultShownAt > AGAIN_GUARD) newJump();
    }
    ui.sync(jump);
  }

  scene.update(jump, wind, dt);
  scene.draw(jump, wind);
  if (scene.photoDue) {
    // Ennen HUDia, jotta kuvaan tulee vain maisema ja hyppääjä
    scene.photoDue = false;
    takePhoto();
  }
  view.resultOpen = mode === 'result';
  if (mode !== 'title') hud.draw(view, jump, wind);
  requestAnimationFrame(frame);
}

// --- Käynnistys ---
input.attach({ canvas, btnAction: ui.btnAction, btnFwd: ui.btnFwd, btnBack: ui.btnBack });
ui.onStart(start);
// Mittarien koko: hyppääjä näyttää saman tiedon, joten mittarit voi pienentää tai piilottaa
hud.gauges = GAUGE_MODES.includes(getSetting('gauges')) ? getSetting('gauges') : GAUGE_MODES[0];
ui.setGauges(hud.gauges);
ui.onGauges(() => {
  hud.gauges = GAUGE_MODES[(GAUGE_MODES.indexOf(hud.gauges) + 1) % GAUGE_MODES.length];
  saveSetting('gauges', hud.gauges);
  ui.setGauges(hud.gauges);
});
if (lb.enabled) ui.onBoard(() => ui.showBoard((season) => lb.fetchTop(hill.def.id, season), lb.playerName()));
ui.onTabloid(() => closeTabloid(performance.now() / 1000));
ui.onAgain(() => { if (!ui.modalOpen && performance.now() / 1000 - resultShownAt > 0.25) newJump(); });
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
  if (mode === 'title' && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); start(); }
});

resize();
scene.reset(jump);
ui.showTitle(getBest(hill.def.id));
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Testausta ja vianetsintää varten (ei käytetä pelilogiikassa)
window.__game = { jump, wind, hill, input, hud, scene, get mode() { return mode; } };
