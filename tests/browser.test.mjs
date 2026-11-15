// Selaintesti: pelaa pelin läpi headless-selaimessa näppäimillä ja kosketuksella.
//   node tests/browser.test.mjs [kuvakaappauskansio]
// Tarkistaa, ettei konsoliin tule virheitä, että hyppy etenee vaiheesta toiseen
// ja että PWA-osat (manifest, service worker, offline) toimivat.

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const page = await launch();
const snap = async (name) => { if (shots) await page.screenshot(join(shots, `${name}.png`)); };
const G = 'window.__game';
const log = (...a) => console.log('  ', ...a);

/** Kaatumisen jälkeen: Iltapulun etusivu on tulosten päällä, kunnes sitä napautetaan. */
async function readTabloid(name) {
  const text = (id) => page.eval(`document.getElementById('${id}').textContent`);
  assert.equal(await page.eval(`document.getElementById('tabloid').hidden`), false, 'Iltapulun etusivu näkyy');
  assert.ok((await text('tab-headline')).length > 5, 'otsikko');
  const injuries = await page.eval(`[...document.querySelectorAll('#tab-injuries li')].map((li) => li.textContent)`);
  assert.ok(injuries.length >= 5 && injuries.some((t) => /hammas|hampaat/i.test(t)), `vammalista: ${injuries.join('; ')}`);
  assert.match(await text('tab-burst'), /^\d+ luuta poikki!$/);
  assert.ok((await text('tab-quote')).length > 5, 'lainaus');
  // Lehtikuva on kopioitu pelistä: ei pelkkää tyhjää
  assert.ok(await page.eval(`(() => { const c = document.getElementById('tab-photo');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4000) if (d[i]) return true; return false; })()`), 'lehtikuva');
  await page.touch(195, 400); // liian aikainen napautus ei sulje
  assert.equal(await page.eval(`document.getElementById('tabloid').hidden`), false);
  await sleep(1300);
  await snap(name);
  log(`Iltapulu: ${await text('tab-headline')} – ${injuries.length} vammaa – ”${await text('tab-quote')}”`);
  await page.touch(195, 400);
  await page.until(`document.getElementById('tabloid').hidden`, 2000);
  assert.equal(await page.eval(`${G}.mode`), 'result', 'napautus sulki vain lehden');
  await sleep(800);
}

/** Ajaa vauhtimäkeä kyykky kaistalla (nuolinäppäimillä), kunnes ehto täyttyy tai vauhtimäki loppuu. */
async function rideInrun(until = 'false') {
  await page.until(`${G}.jump.phase !== 'ready'`); // lähtöpainallus ehtii perille
  let held = null;
  for (;;) {
    const s = await page.eval(`(() => { const j = ${G}.jump;
      return { inrun: j.phase === 'inrun', b: j.balance + 0.15 * j.balanceVel, done: !!(${until}) }; })()`);
    if (s.done || !s.inrun) break;
    const want = s.b > 0.08 ? 'ArrowDown' : s.b < -0.08 ? 'ArrowUp' : null;
    if (want !== held) {
      if (held) await page.key(held, 'up');
      if (want) await page.key(want, 'down');
      held = want;
    }
    await sleep(4);
  }
  if (held) await page.key(held, 'up');
}

/** Pitää lennossa kohtauskulman kaistalla, kunnes lento loppuu. Ei paina alastuloa. */
async function steerFlight() {
  let down = false;
  for (;;) {
    const s = await page.eval(`(() => { const j = ${G}.jump;
      return { flight: j.phase === 'flight', err: (j.aoa - 24 * Math.PI / 180 - j.bandCenter) * 180 / Math.PI }; })()`);
    if (!s.flight) break;
    const want = s.err > 1;
    if (want !== down) { await page.key('ArrowDown', want ? 'down' : 'up'); down = want; }
    await sleep(8);
  }
  if (down) await page.key('ArrowDown', 'up');
}

try {
  // ---------- Puhelin, pystyasento ----------
  await page.viewport(390, 844, true);
  await page.goto(page.url);
  assert.equal(await page.eval(`${G}.mode`), 'title', 'alkuruutu näkyy');
  await snap('01-alkuruutu');

  // --- Hyppy 1: näppäimistö, hyvä suoritus ---
  await page.key('Space');
  await page.until(`${G}.mode === 'play' && ${G}.jump.phase === 'ready'`);
  await sleep(600);
  await snap('02-puomilla');
  const gate0 = await page.eval(`${G}.jump.gateLeft`);
  assert.ok(gate0 < 20 && gate0 > 15, 'lähtöaika juoksee');

  await page.key('Space');
  await page.until(`${G}.jump.phase === 'inrun'`);
  await rideInrun(`${G}.jump.d < 45`);
  await snap('03-vauhtimaki');
  await rideInrun(`${G}.jump.d < 1.6`);
  await page.key('Space');
  await page.until(`${G}.jump.phase === 'flight'`);
  assert.equal(await page.eval(`${G}.jump.crash`), null, 'kyykky kaistalla: ei kaatumista');
  const q =await page.eval(`${G}.jump.takeoff.quality`);
  log(`ponnistus: ${(q * 100).toFixed(0)} % (painettu ${(await page.eval(`${G}.jump.takeoff.at`)).toFixed(2)} m ennen nokkaa)`);
  assert.ok(q > 0.5, 'ponnistus rekisteröityi');
  await snap('04-ponnistus');

  // Liito: pidä kohtauskulma optimissa nuolinäppäimillä, paina alastulo ajoissa
  let down = false, shotFlight = false;
  for (;;) {
    const s = await page.eval(`(() => { const j = ${G}.jump; const sl = j.hill.slopeAtX(j.x);
      const closing = -(j.vx * Math.sin(sl) + j.vy * Math.cos(sl));
      return { phase: j.phase, t: j.t, err: (j.aoa - 24 * Math.PI / 180 - j.bandCenter) * 180 / Math.PI, ttg: closing > 0.1 ? j.height / closing : 99, prep: j.landPrep }; })()`);
    if (s.phase !== 'flight') break;
    const want = s.err > 1;
    if (want !== down) { await page.key('ArrowDown', want ? 'down' : 'up'); down = want; }
    if (!shotFlight && s.t > 2.2) { await snap('05-liito'); shotFlight = true; }
    if (!s.prep && s.t > 1 && s.ttg < 0.4) { await page.key('Space'); await snap('06-alastulovalmius'); }
    await sleep(8);
  }
  if (down) await page.key('ArrowDown', 'up');
  await sleep(350);
  await snap('07-alastulo');
  const r1 = await page.eval(`${G}.jump.result`);
  const td = await page.eval(`({ impact: ${G}.jump.touchdown.impact, prepT: ${G}.jump.landPrepT, wind: ${G}.wind.value })`);
  log(`hyppy 1: ${r1.distance} m, ${r1.outcome}, tyyli ${r1.style}, yht ${r1.total} (isku ${td.impact.toFixed(1)} m/s, tuuli ${td.wind.toFixed(1)})`);
  assert.ok(r1.distance > 95 && r1.distance < 145, `uskottava pituus (${r1.distance})`);
  // Hyvin pitkä hyppy tulee alas niin kovaa, ettei telemark onnistu – silloin tasajalka on oikea tulos
  assert.equal(r1.outcome, td.impact > 7.0 ? 'twofoot' : 'telemark', `alastulo (isku ${td.impact.toFixed(1)} m/s)`);

  await page.until(`${G}.mode === 'result'`);
  await sleep(300);
  await snap('08-tulos');
  assert.match(await page.eval(`document.getElementById('res-distance').textContent`), /\d+,\d m/);
  assert.equal(await page.eval(`document.getElementById('result').hidden`), false);

  // --- Hyppy 2: kosketus. Lähtö napauttamalla ruutua, ei ponnistusta, nojaus painikkeella, ei alastuloa ---
  await sleep(500);
  await page.touch(...(await page.center('btn-again')));
  await page.until(`${G}.mode === 'play' && ${G}.jump.phase === 'ready'`);
  await page.until(`document.getElementById('btn-action').textContent === 'LÄHTÖ'`, 2000);
  await page.touch(195, 300); // napautus pelialueelle
  await page.until(`${G}.jump.phase === 'inrun'`);
  await page.until(`document.getElementById('btn-action').textContent === 'PONNISTA'`, 2000);
  await rideInrun();
  await page.until(`${G}.jump.phase === 'flight'`);
  assert.equal(await page.eval(`${G}.jump.takeoff.pressed`), false);
  await sleep(450);
  const pitch0 = await page.eval(`${G}.jump.pitch`);
  await page.touch(...(await page.center('btn-fwd')), 'down');
  await sleep(250);
  const lean = await page.eval(`${G}.input.poll().lean`);
  await snap('09-kosketus-nojaus');
  await page.touch(0, 0, 'up');
  assert.equal(lean, 1, 'eteen-painike pohjassa antaa nojauksen');
  assert.ok(await page.eval(`${G}.jump.pitch`) < pitch0, 'sukset kääntyivät alaspäin');
  await steerFlight(); // asento kaistalla, jottei hallinta mene ilmassa
  await page.until(`${G}.jump.phase !== 'flight'`);
  await sleep(500);
  await snap('10-kaatuminen');
  const r2 = await page.eval(`${G}.jump.result`);
  log(`hyppy 2: ${r2.distance} m, ${r2.outcome}, yht ${r2.total}`);
  assert.equal(r2.outcome, 'fall', 'ilman alastulopainallusta kaatuu');
  assert.ok(r2.distance < r1.distance, 'huono hyppy jää lyhyemmäksi');
  // Kaatunut hyppääjä pyörii alas ja kasvaa lumipalloksi; tulos näytetään vasta pallon pysähdyttyä
  await page.until(`${G}.jump.snow > 0.5`);
  await snap('10b-lumipallo');
  assert.equal(await page.eval(`${G}.mode`), 'play', 'tulos odottaa lumipallon pysähtymistä');
  await page.until(`${G}.mode === 'result'`);
  assert.ok(await page.eval(`${G}.jump.ballRadius`) > 2, 'alhaalla on iso lumipallo');
  await sleep(300);
  await readTabloid('11-iltapulu-lumipallo');
  await snap('11-tulos-kaatuminen');

  // --- Hyppy 3: alastulo kosketuspainikkeella, lähtö ajan loppumisella ---
  await page.touch(...(await page.center('btn-again')));
  await page.until(`${G}.jump.phase === 'ready'`);
  await page.eval(`${G}.jump.gateLeft = 0.3`);
  await page.until(`${G}.jump.phase === 'inrun'`);
  log('lähtöajan loppuminen käynnistää hypyn');
  await rideInrun(`${G}.jump.d < 1.6`);
  await page.touch(...(await page.center('btn-action')));
  await page.until(`${G}.jump.phase === 'flight' && ${G}.jump.t > 1.2`);
  await page.touch(...(await page.center('btn-action')));
  assert.equal(await page.eval(`${G}.jump.landPrep`), true, 'alastulopainike toimii kosketuksella');
  await page.until(`${G}.mode === 'result'`);
  const r3 = await page.eval(`${G}.jump.result`);
  log(`hyppy 3: ${r3.distance} m, ${r3.outcome}`);
  assert.notEqual(r3.outcome, 'fall');

  // Ennätys tallentui
  // Kausi 1 on tallennuksen juuritasolla, myöhemmät seasons-kentässä (ks. js/storage.js)
  const stored = await page.eval(`import('./js/config.js').then(({ SEASON }) => {
    const d = JSON.parse(localStorage.getItem('tuulimaki.v1'));
    return (SEASON === 1 ? d : d.seasons[SEASON]).best.tuulivaara; })`);
  assert.equal(stored.distance, Math.max(r1.distance, r3.distance), 'ennätys tallessa');

  // --- Hyppy 4: kyykky pettää siirtymäkaaressa -> kaatuu vauhtimäessä, kierii nokan yli ---
  /** Kuvasarja kaatumisesta: n kuvaa noin 60 ms välein. */
  const burst = async (name, n) => { for (let i = 1; i <= n; i++) { await snap(`${name}-${i}`); await sleep(40); } };
  await sleep(800);
  await page.touch(...(await page.center('btn-again')));
  await page.until(`${G}.mode === 'play' && ${G}.jump.phase === 'ready'`);
  await page.touch(195, 300); // napautus pelialueelle: lähtö
  await rideInrun(`${G}.jump.d < 42`);
  await page.key('ArrowUp', 'down'); // nojaa taakse kaaressa: osoitin karkaa kaatumisalueelle
  await page.until(`${G}.jump.danger > 0.5`);
  await snap('14-kaatumisvaara');
  await page.until(`${G}.jump.phase === 'crash'`);
  await page.key('ArrowUp', 'up');
  const c4 = await page.eval(`({ crash: ${G}.jump.crash, d: ${G}.jump.d, kmh: ${G}.jump.result.takeoffSpeed * 3.6, total: ${G}.jump.result.total })`);
  log(`hyppy 4: kaatui vauhtimäessä ${c4.d.toFixed(0)} m ennen nokkaa, ${c4.kmh.toFixed(0)} km/h`);
  assert.equal(c4.crash, 'inrun');
  assert.equal(c4.total, 0, 'vauhtimäessä kaatunut ei saa pisteitä');
  await burst('15-kaatuminen-vauhtimaki', 6);
  assert.equal(await page.eval(`document.getElementById('btn-action').disabled`), true, 'painike pois käytöstä kaatuessa');
  await page.until(`${G}.jump.x > 2`);
  await burst('16-nokan-yli', 8);
  assert.equal(await page.eval(`${G}.mode`), 'play', 'tulos odottaa kierimisen loppua');
  await page.until(`${G}.jump.t > 2.1 && ${G}.jump.x > 30`);
  await burst('17-kierii-rinteessa', 4);
  await page.touch(195, 300); // painallus ohittaa kierimisen
  await page.until(`${G}.mode === 'result'`, 3000);
  assert.equal(await page.eval(`document.getElementById('res-outcome').textContent`), 'Kaatuminen vauhtimäessä');
  assert.equal(await page.eval(`document.getElementById('res-total').textContent`), '0,0');
  await readTabloid('18-iltapulu-vauhtimaki');
  await snap('18-tulos-kaatuminen-vauhtimaki');

  // --- Hyppy 5: kärjet liian ylhäällä liian kauan -> hallinta menee ilmassa ---
  await sleep(800);
  await page.touch(...(await page.center('btn-again')));
  await page.until(`${G}.mode === 'play' && ${G}.jump.phase === 'ready'`);
  await page.touch(195, 300);
  await rideInrun(`${G}.jump.d < 1.6`);
  await page.touch(195, 300); // ponnistus
  await page.until(`${G}.jump.phase === 'flight' && ${G}.jump.t > 0.6`);
  await page.key('ArrowUp', 'down');
  await page.until(`${G}.jump.danger > 0.5 || ${G}.jump.phase !== 'flight'`);
  await snap('19-kaatumisvaara-ilmassa');
  await page.until(`${G}.jump.phase !== 'flight'`);
  await page.key('ArrowUp', 'up');
  assert.equal(await page.eval(`${G}.jump.crash`), 'flight', 'hallinta meni ilmassa');
  await burst('20-kaatuminen-ilmassa', 5);
  await page.until(`${G}.jump.crashHits > 0`);
  await burst('21-isku-rinteeseen', 8);
  await page.until(`${G}.mode === 'result' || ${G}.jump.t > 2.5`);
  await burst('22-kierii', 3);
  await page.until(`${G}.jump.phase === 'done'`, 30000);
  await snap('23-makaa-rinteessa');
  await page.until(`${G}.mode === 'result'`);
  const r5 = await page.eval(`${G}.jump.result`);
  log(`hyppy 5: kaatui ilmassa, ${r5.distance} m, tyyli ${r5.style}, yht ${r5.total} (${r5.deductions.map((d) => d.label).join(', ')})`);
  assert.equal(r5.crash, 'flight');
  assert.ok(r5.distance > 0 && r5.distance < r1.distance, 'pituus mitataan putoamiskohdasta');
  assert.equal(await page.eval(`document.getElementById('res-outcome').textContent`), 'Kaatuminen ilmassa');
  await readTabloid('24-iltapulu-ilmassa');
  await snap('24-tulos-kaatuminen-ilmassa');

  // ---------- PWA ----------
  const manifest = await page.eval(`fetch('manifest.webmanifest').then(r => r.json())`);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.equal(await page.eval(`fetch('${icon.src}').then(r => r.status)`), 200, icon.src);
  }
  await page.until(`navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))`, 10000, 100);
  const cached = await page.eval(`caches.keys().then(k => caches.open(k[0])).then(c => c.keys()).then(k => k.length)`);
  log(`service worker aktiivinen, välimuistissa ${cached} tiedostoa`);
  await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.goto(page.url);
  assert.equal(await page.eval(`${G}?.mode`), 'title', 'peli käynnistyy ilman verkkoa');
  assert.match(await page.eval(`document.getElementById('title-best').textContent`), /Mäkiennätyksesi/);
  await snap('12-offline-alkuruutu');
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ---------- Työpöytä ----------
  await page.viewport(1280, 720, false);
  await page.goto(page.url);
  await page.key('Space');
  await page.until(`${G}.jump.phase === 'ready'`);
  await page.key('Space');
  await rideInrun(`${G}.jump.d < 1.6`);
  await page.key('Space');
  await page.until(`${G}.jump.phase === 'flight' && ${G}.jump.t > 1.5`);
  await snap('13-tyopoyta-liito');

  assert.deepEqual(page.errors, [], 'ei konsolivirheitä');
  console.log('Selaintesti OK');
} catch (err) {
  await snap('99-virhe').catch(() => {});
  if (page.errors.length) console.error('Konsolivirheet:', page.errors);
  throw err;
} finally {
  await page.close();
}
