// Fysiikan ja pisteytyksen testit ilman selainta.
//   node tests/sim.test.mjs

import assert from 'node:assert/strict';
import { HILLS, WIND, STEP, BAND, DEG, INRUN, FLIGHT, CRASH } from '../js/config.js';
import { Phase } from '../js/jump.js';
import { guidance } from '../js/guidance.js';
import { createHill } from '../js/hill.js';
import { Wind } from '../js/wind.js';
import { distancePoints, scoreJump } from '../js/scoring.js';
import { posturePerf, inrunAccel } from '../js/physics.js';
import { makeRng } from '../js/util.js';
import { runJump, fixedWind } from './bot.js';

const hill = createHill(HILLS.tuulivaara);
const dist = (wind, opts) => runJump(hill, fixedWind(wind), opts).result.distance;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

test('mäen geometria: K-piste on 120 m rinnettä pitkin ja profiili on järkevä', () => {
  const k = hill.landingPos(hill.k);
  assert.ok(Math.abs(hill.distAtX(k.x) - 120) < 0.01);
  const ratio = -k.y / k.x;
  assert.ok(ratio > 0.52 && ratio < 0.62, `h/n = ${ratio}`);
  assert.ok(Math.abs(hill.groundY(k.x) - k.y) < 0.01);
  assert.equal(hill.inrunPos(0).x, 0);
});

test('täydellinen hyppy tyynessä on K-pisteen tuntumassa ja telemark', () => {
  const { result, jump, maxHeight } = runJump(hill, fixedWind(0));
  assert.ok(result.distance >= 118 && result.distance <= 132, `pituus ${result.distance}`);
  assert.equal(result.outcome, 'telemark');
  assert.equal(result.style, 60);
  assert.ok(jump.takeoffSpeed * 3.6 > 84 && jump.takeoffSpeed * 3.6 < 92, 'nopeus nokalla ~88 km/h');
  assert.ok(maxHeight > 3 && maxHeight < 8, `lentokorkeus ${maxHeight}`);
});

test('vastatuuli kantaa, myötätuuli lyhentää', () => {
  const [tail, calm, head] = [dist(-3), dist(0), dist(3)];
  assert.ok(tail < calm - 8, `myötä ${tail} vs tyyni ${calm}`);
  assert.ok(head > calm + 3, `vasta ${head} vs tyyni ${calm}`);
  assert.ok(head < hill.hs + 6, 'ei karkaa mäestä yli');
});

test('ponnistuksen ajoitus ratkaisee', () => {
  const perfect = dist(0), early = dist(0, { takeoffAt: 3.4 }), veryEarly = dist(0, { takeoffAt: 6.4 }), none = dist(0, { takeoffAt: null });
  assert.ok(perfect > early && early > veryEarly && veryEarly > none, `${perfect} > ${early} > ${veryEarly} > ${none}`);
  assert.ok(perfect - early > 4 && perfect - early < 15);
});

test('vauhtimäki: kyykyn pitäminen kaistalla antaa täyden vauhdin, huono asento hidastaa', () => {
  assert.ok(inrunAccel(24, 0.5, 0, 1) < inrunAccel(24, 0.5, 0, 0));
  for (let seed = 1; seed <= 5; seed++) {
    // Huono kyykky: osoitin punaisella, mutta ei kaatumisalueella asti
    const good = runJump(hill, fixedWind(0), {}, seed), poor = runJump(hill, fixedWind(0), { balance: 0.6 }, seed);
    const perfect = runJump(hill, fixedWind(0), {}, 1).jump.takeoffSpeed;
    assert.ok(Math.abs(good.jump.takeoffSpeed - perfect) < 0.01, 'hyvä botti ei menetä vauhtia');
    assert.equal(poor.jump.crash, null, 'punaisella käyminen ei vielä kaada');
    const lost = (good.jump.takeoffSpeed - poor.jump.takeoffSpeed) * 3.6;
    assert.ok(lost > 0.5 && lost < 2, `huonolla kyykyllä menettää ${lost.toFixed(2)} km/h`);
    assert.ok(good.result.distance - poor.result.distance > 3);
  }
});

test('vauhtimäki: ohjaamatta osoitin jää kaatumisalueelle ja hyppääjä kaatuu ilman tulosta', () => {
  let crashed = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { jump, result } = runJump(hill, fixedWind(0), { balance: false }, seed);
    if (jump.crash !== 'inrun') continue;
    crashed++;
    assert.equal(jump.phase, 'done', 'kieriminen päättyy');
    assert.equal(result.outcome, 'fall');
    assert.equal(result.crash, 'inrun');
    assert.equal(result.distance, 0);
    assert.equal(result.total, 0);
    assert.equal(jump.touchdown, null, 'ei alastulomerkkiä');
    assert.ok(jump.crashHits >= 3, `iskuja ${jump.crashHits}`);
    assert.ok(jump.x > 0 && jump.x < hill.endX, `kierii nokan yli rinteeseen (x = ${jump.x.toFixed(0)})`);
  }
  assert.ok(crashed >= 16, `kaatui ${crashed}/20`);
});

test('lento: liian kauan kaatumisalueella = hallinta menee ja hyppääjä putoaa rinteeseen', () => {
  const good = runJump(hill, fixedWind(0)).result;
  for (const lean of [-1, 1]) { // kärjet liian ylhäällä / sukellus
    const { jump, result } = runJump(hill, fixedWind(0), { steer: lean, landLead: null });
    assert.equal(jump.crash, 'flight', `nojaus ${lean}`);
    assert.equal(jump.phase, 'done');
    assert.equal(result.outcome, 'fall');
    assert.equal(result.crash, 'flight');
    assert.ok(result.distance > 20 && result.distance < good.distance - 15, `pituus ${result.distance}`);
    assert.equal(result.distance, jump.touchdown.distance);
    assert.ok(result.deductions.some((d) => d.label === 'Hallinnan menetys ilmassa'));
    assert.ok(result.style < 36, 'huonompi tyyli kuin tavallisessa kaatumisessa');
    assert.ok(jump.crashHits >= 3 && jump.touchdown.impact > 3, `isku ${jump.touchdown.impact.toFixed(1)} m/s`);
  }
  // Pelkkä ohjaamatta jättäminen tyynessä ei kaada: osoitin jää keltaiselle
  assert.equal(runJump(hill, fixedWind(0), { steer: false }).jump.crash, null);
});

test('asennon säätö kannattaa', () => {
  assert.ok(dist(0) - dist(0, { steer: false }) > 15);
});

test('asentokäyrä: tasainen kaistan sisällä, paras etureunalla, romahtaa reunan yli', () => {
  const half = 5 * DEG, perf = (deg) => posturePerf(deg * DEG, half);
  assert.equal(perf(0), 1);
  assert.equal(perf(4), 1);
  assert.ok(Math.abs(perf(-5) - (1 + BAND.edgeBonus)) < 1e-9, 'huippu etureunalla');
  assert.ok(perf(-4.5) > 1 && perf(-4.5) < perf(-5), 'herkkukaista nousee reunaa kohti');
  assert.ok(perf(-6.5) < 1, 'reunan yli mennään nopeasti kaistan tason alle');
  assert.ok(1 - perf(-7) > 3 * (1 - perf(7)), 'etureunan yli putoaa jyrkemmin kuin takareunan yli');
  assert.ok(perf(-40) >= BAND.diveMin && perf(40) >= BAND.backMin);
});

test('alastulo: ilman painallusta kaatuu, liian aikainen lyhentää hyppyä', () => {
  const noLand = runJump(hill, fixedWind(0), { landLead: null }).result;
  assert.equal(noLand.outcome, 'fall');
  assert.ok(noLand.style <= 36);
  assert.ok(dist(0, { landLead: 1.0 }) < dist(0));
  const late = runJump(hill, fixedWind(0), { landLead: 0.05 }).result;
  assert.equal(late.outcome, 'twofoot');
  assert.ok(late.style < 60);
});

test('pisteytys', () => {
  assert.equal(distancePoints(hill, 120), 60);
  assert.equal(distancePoints(hill, 125), 69);
  assert.equal(distancePoints(hill, 20), 0);
  const r = scoreJump(hill, { distance: 120, outcome: 'telemark', avgAoaError: 0, prepTime: 0.3, impact: 4 });
  assert.equal(r.total, 120);
  assert.equal(r.judge % 0.5, 0);
});

test('sama siemen antaa saman hypyn', () => {
  const a = runJump(hill, new Wind(makeRng(5)), {}, 9).result;
  const b = runJump(hill, new Wind(makeRng(5)), {}, 9).result;
  assert.deepEqual(a, b);
  // Myös kaatuminen pomppuineen toistuu samanlaisena
  const c = runJump(hill, new Wind(makeRng(5)), { balance: false }, 3).jump;
  const d = runJump(hill, new Wind(makeRng(5)), { balance: false }, 3).jump;
  assert.deepEqual([c.crash, c.x, c.crashHits, c.roll], [d.crash, d.x, d.crashHits, d.roll]);
});

test('tuuli vaihtelee mutta pysyy rajoissa', () => {
  const wind = new Wind(makeRng(3));
  let min = Infinity, max = -Infinity;
  for (let n = 0; n < 40; n++) {
    wind.reset();
    for (let i = 0; i < 120 * 25; i++) {
      wind.update(STEP);
      min = Math.min(min, wind.value); max = Math.max(max, wind.value);
    }
  }
  assert.ok(min >= -WIND.max && max <= WIND.max);
  assert.ok(min < -1.5 && max > 1.5, `vaihteluväli ${min.toFixed(1)}..${max.toFixed(1)}`);
});

test('vaihtelevassa tuulessa hyvä botti hyppää uskottavia pituuksia', () => {
  const ds = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { jump, result } = runJump(hill, new Wind(makeRng(seed)), {}, seed);
    assert.equal(jump.crash, null, 'hyvä botti ei kaadu');
    ds.push(result.distance);
  }
  const min = Math.min(...ds), max = Math.max(...ds);
  console.log(`      pituudet ${min}–${max} m, keskiarvo ${(ds.reduce((a, b) => a + b) / ds.length).toFixed(1)} m`);
  assert.ok(min > 95 && max < 142, `${min}..${max}`);
});

test('ohjaussignaali: suunta, tila ja vakavuus vastaavat mittaria', () => {
  const HALF = INRUN.balanceHalf;
  const inrun = (balance) => guidance({
    phase: Phase.INRUN, takeoff: { pressed: false }, balance,
    balanceError: Math.min(1, Math.max(0, (Math.abs(balance) - HALF) / INRUN.balanceErrFull)),
  });
  assert.equal(inrun(0).state, 'good');
  assert.equal(inrun(0).lean, 0);
  assert.ok(inrun(0.15).lean > 0 && inrun(-0.15).lean < 0, 'suunta näkyy jo kaistan sisällä');
  assert.equal(inrun(0.15).state, 'good');
  assert.equal(inrun(HALF + 0.1).state, 'warn');
  assert.equal(inrun(-(HALF + 0.3)).state, 'bad');
  const limit = HALF + CRASH.inrunError * INRUN.balanceErrFull;
  assert.ok(Math.abs(inrun(limit).lean - 1) < 1e-9 && Math.abs(inrun(-limit).lean + 1) < 1e-9, 'kaatumisrajalla täysi asento');
  let prev = -2;
  for (let b = -1; b <= 1; b += 0.05) { const l = inrun(b).lean; assert.ok(l >= prev, 'asento muuttuu tasaisesti'); prev = l; }

  const half = 4 * DEG;
  const flight = (e, extra = {}) => guidance({
    phase: Phase.FLIGHT, landPrep: false, posture: 1, bandCenter: 0, bandHalf: half, aoaOpt: FLIGHT.aoaOpt, aoa: FLIGHT.aoaOpt + e, ...extra,
  });
  assert.equal(flight(0).state, 'good');
  assert.equal(flight(-half + 0.5 * DEG).state, 'sweet', 'herkkukaista etureunassa');
  assert.ok(flight(half + 2 * DEG).lean > 0, 'kärjet liian ylhäällä -> nojaa eteen');
  assert.ok(flight(-half - 1 * DEG).lean < 0, 'kärjet liian alhaalla -> nojaa taakse');
  // Etureunan alla kaatumisraja on lähempänä: sama ylitys on siellä vakavampi
  assert.ok(flight(-half - 2 * DEG).severity > flight(half + 2 * DEG).severity);
  assert.equal(flight(-half - 2 * DEG).state, 'bad');
  assert.equal(flight(half + 2 * DEG).state, 'warn');
  assert.equal(flight(half + 2 * DEG, { posture: 0 }).lean, 0, 'ei signaalia ennen lentoasentoa');
  assert.equal(flight(0, { landPrep: true }).active, false, 'alastuloon valmistautuessa ei signaalia');
  assert.equal(guidance({ phase: Phase.SLIDE }).active, false);
});

console.log(`${passed} testiä OK`);
