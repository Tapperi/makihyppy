// Fysiikan ja pisteytyksen testit ilman selainta.
//   node tests/sim.test.mjs

import assert from 'node:assert/strict';
import { HILLS, WIND, STEP } from '../js/config.js';
import { createHill } from '../js/hill.js';
import { Wind } from '../js/wind.js';
import { distancePoints, scoreJump } from '../js/scoring.js';
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

test('asennon säätö kannattaa', () => {
  assert.ok(dist(0) - dist(0, { steer: false }) > 15);
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
  for (let seed = 1; seed <= 40; seed++) ds.push(runJump(hill, new Wind(makeRng(seed)), {}, seed).result.distance);
  const min = Math.min(...ds), max = Math.max(...ds);
  console.log(`      pituudet ${min}–${max} m, keskiarvo ${(ds.reduce((a, b) => a + b) / ds.length).toFixed(1)} m`);
  assert.ok(min > 95 && max < 142, `${min}..${max}`);
});

console.log(`${passed} testiä OK`);
