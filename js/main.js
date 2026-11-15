// Käynnistys ja pelisilmukka. Kokoaa moduulit yhteen.

import { HILLS, STEP } from './config.js';
import { createHill } from './hill.js';
import { Wind } from './wind.js';
import { Jump, Phase } from './jump.js';
import { Input } from './input.js';
import { Scene } from './render/scene.js';
import { Hud } from './render/hud.js';
import { Ui } from './ui.js';
import { getBest, recordJump } from './storage.js';
import { makeRng } from './util.js';

const RESULT_DELAY = 2.4;   // tulospaneeli näin pian alastulon jälkeen (s)
const FALL_DELAY = 12;      // kaatuessa odotetaan, että lumipallo pysähtyy (enintään näin kauan)
const FALL_SKIP = 1;        // tämän jälkeen painallus ohittaa pyörimisen (s)
const AGAIN_GUARD = 0.7;    // estää vahinkopainalluksen ohittamasta tuloksia (s)

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
  mode = 'result';
  resultShownAt = now;
  input.clear();
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
    acc += dt;
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
      const landed = jump.phase === Phase.DONE
        || (sliding && jump.t > (fell ? FALL_DELAY : RESULT_DELAY))
        || (sliding && fell && pressed && jump.t > FALL_SKIP);
      if (landed) finishJump(now);
    } else if (input.takeAction() && now - resultShownAt > AGAIN_GUARD) {
      newJump();
    }
    ui.sync(jump);
  }

  scene.update(jump, wind, dt);
  scene.draw(jump, wind);
  view.resultOpen = mode === 'result';
  if (mode !== 'title') hud.draw(view, jump, wind);
  requestAnimationFrame(frame);
}

// --- Käynnistys ---
input.attach({ canvas, btnAction: ui.btnAction, btnFwd: ui.btnFwd, btnBack: ui.btnBack });
ui.onStart(newJump);
ui.onAgain(() => { if (performance.now() / 1000 - resultShownAt > 0.25) newJump(); });
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.addEventListener('keydown', (e) => {
  if (mode === 'title' && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); newJump(); }
});

resize();
scene.reset(jump);
ui.showTitle(getBest(hill.def.id));
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Testausta ja vianetsintää varten (ei käytetä pelilogiikassa)
window.__game = { jump, wind, hill, input, get mode() { return mode; } };
