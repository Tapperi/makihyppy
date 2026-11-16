// Fysiikan ja pisteytyksen testit ilman selainta.
//   node tests/sim.test.mjs

import assert from 'node:assert/strict';
import { HILLS, WIND, STEP, BAND, DEG, INRUN, FLIGHT, CRASH, SEASON, GATE_TIME, SPLITS } from '../js/config.js';
import { analyzeJump } from '../js/analysis.js';
import { distanceFor, findRivals, hillTargets, rivalGap, TARGET_JUDGE } from '../js/targets.js';
import { Phase } from '../js/jump.js';
import { guidance } from '../js/guidance.js';
import { createHill } from '../js/hill.js';
import { Wind, seasonSeed, seasonPattern, makePattern, patternAt } from '../js/wind.js';
import { distancePoints, scoreJump } from '../js/scoring.js';
import { posturePerf, inrunAccel } from '../js/physics.js';
import { makeRng } from '../js/util.js';
import { runJump, fixedWind } from './bot.js';
import { GHOST, validTrack, sampleTrack } from '../js/ghost.js';
import { cleanGhost } from '../worker/src/ghost.js';

const hill = createHill(HILLS.tuulivaara);
const SEED = seasonSeed(SEASON, hill.def.id);
const PATTERN = seasonPattern(SEASON, hill.def.id); // nykyisen kauden tuulikuvio
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
  const a = runJump(hill, new Wind(makeRng(5), PATTERN), {}, 9).result;
  const b = runJump(hill, new Wind(makeRng(5), PATTERN), {}, 9).result;
  assert.deepEqual(a, b);
  // Myös kaatuminen pomppuineen toistuu samanlaisena
  const c = runJump(hill, new Wind(makeRng(5), PATTERN), { balance: false }, 3).jump;
  const d = runJump(hill, new Wind(makeRng(5), PATTERN), { balance: false }, 3).jump;
  assert.deepEqual([c.crash, c.x, c.crashHits, c.roll], [d.crash, d.x, d.crashHits, d.roll]);
});

test('tuuli elää ja voi tyyntyä, mutta suunta ei käänny kesken kauden', () => {
  let head = 0;
  for (let season = 1; season <= 30; season++) {
    const pattern = makePattern(seasonSeed(season, 'tuulivaara'));
    const wind = new Wind(makeRng(season), pattern);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 120 * 40; i++) {
      wind.update(STEP);
      lo = Math.min(lo, wind.value * pattern.dir); hi = Math.max(hi, wind.value * pattern.dir);
    }
    assert.ok(lo >= 0, `kausi ${season}: suunta ei käänny (${lo})`);
    assert.ok(hi <= WIND.max && hi - lo > 1.5, `kausi ${season}: tuuli elää (${lo.toFixed(1)}..${hi.toFixed(1)})`);
    if (pattern.dir > 0) head++;
  }
  assert.ok(head > 10 && head < 28, `vastatuulikausia ${head}/30`);
});

test('nykyinen kausi: kova vastatuuli, joka välillä hellittää mutta ei käänny myötäiseksi', () => {
  assert.equal(PATTERN.dir, 1);
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const wind = new Wind(makeRng(seed), PATTERN);
    for (let i = 0; i < 120 * 40; i++) {
      wind.update(STEP);
      lo = Math.min(lo, wind.value); hi = Math.max(hi, wind.value); sum += wind.value; n++;
    }
  }
  console.log(`      tuuli ${lo.toFixed(1)}..${hi.toFixed(1)} m/s, keskiarvo ${(sum / n).toFixed(2)} m/s`);
  assert.ok(lo >= 0, 'ei koskaan myötätuulta');
  assert.ok(lo < 1.2, `välillä hellittää (${lo})`);
  assert.ok(hi > 3.5 && hi <= WIND.max);
  assert.ok(sum / n > 2.3 && sum / n < 3.3, `keskiarvo ${sum / n}`);
});

test('kauden tuulikuvio: sama siemen = sama kuvio, eri kausi = eri kuvio, silmukka on saumaton', () => {
  assert.ok(WIND.loop < GATE_TIME, 'puomilta ehtii mihin tahansa kohtaan kuviota');
  const a = makePattern(SEED), b = makePattern(SEED), other = makePattern(seasonSeed(SEASON + 1, 'tuulivaara'));
  assert.deepEqual(seasonPattern(SEASON, hill.def.id), makePattern(SEED, WIND.seasons[SEASON]));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, other);
  assert.ok(Math.abs(patternAt(a, 0).wind - patternAt(a, WIND.loop - 1e-6).wind) < 1e-3, 'ei hyppäystä saumassa');
  assert.equal(patternAt(a, 3).wind, patternAt(a, 3 + WIND.loop).wind);
  for (const s of a.bursts) assert.ok(s.at >= 0 && s.at + WIND.burstLead + s.dur < WIND.loop, 'puuska mahtuu silmukkaan');
  for (let i = 1; i < a.bursts.length; i++) {
    const prev = a.bursts[i - 1];
    assert.ok(a.bursts[i].at - (prev.at + WIND.burstLead + prev.dur) >= WIND.burstMinGap - 1e-9, 'puuskien välissä on tauko');
  }
});

test('kauden tuuli on kaikille sama: hyppyjen ero samassa kohdassa kuviota on pieni', () => {
  // Kaksi eri hyppyä (eri rng) samasta kohdasta: ero on vain kohinaa ja puuskien heiluntaa
  const run = (seedA, seedB, patternB = PATTERN) => {
    const a = new Wind(makeRng(seedA), PATTERN), b = new Wind(makeRng(seedB), patternB);
    let sum = 0, n = 0, burstDiff = 0;
    for (let pos = 0; pos < WIND.loop; pos += 3.1) {
      a.reset(pos); b.reset(pos);
      for (let i = 0; i < 120 * 30; i++) {
        a.update(STEP); b.update(STEP);
        sum += Math.abs(a.value - b.value); n++;
      }
      burstDiff = Math.max(burstDiff, ...a.jitter.map((j, k) => Math.abs(j.amp - b.jitter[k].amp) * Math.abs(a.pattern.bursts[k].amp)));
    }
    return { mean: sum / n, burstDiff };
  };
  const same = run(1, 2), otherSeason = run(1, 2, seasonPattern(SEASON + 1, 'tuulivaara'));
  console.log(`      keskimääräinen ero: sama kausi ${same.mean.toFixed(2)} m/s, eri kausi ${otherSeason.mean.toFixed(2)} m/s`);
  assert.ok(same.mean < 0.3, `sama kausi ${same.mean}`);
  assert.ok(same.burstDiff < 0.5, `puuskan huipun ero ${same.burstDiff}`);
  assert.ok(otherSeason.mean > 3 * same.mean, 'eri kaudella on selvästi eri tuuli');
});

test('kauden tuuli: samalla lähtöhetkellä hyvä botti hyppää lähes saman pituuden', () => {
  let worst = 0;
  for (const pos of [0, 4, 8, 12, 16]) {
    const ds = [];
    for (let seed = 1; seed <= 12; seed++) {
      const wind = new Wind(makeRng(seed), PATTERN);
      const reset = wind.reset.bind(wind);
      wind.reset = () => reset(pos);   // jokainen hyppy alkaa samasta kohdasta kuviota
      ds.push(runJump(hill, wind, {}, seed).result.distance);
    }
    worst = Math.max(worst, Math.max(...ds) - Math.min(...ds));
  }
  console.log(`      suurin hajonta samalla lähtöhetkellä ${worst} m`);
  assert.ok(worst <= 6, `hajonta ${worst} m`);
});

test('vaihtelevassa tuulessa hyvä botti hyppää uskottavia pituuksia', () => {
  const ds = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { jump, result } = runJump(hill, new Wind(makeRng(seed), PATTERN), {}, seed);
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

test('jälkianalyysi: virheiden hinta metreinä vastaa hyppyjen todellista eroa', () => {
  const run = (opts) => runJump(hill, fixedWind(1), opts);
  const clean = run({}), cleanCost = analyzeJump(hill, clean.jump);
  assert.equal(cleanCost.takeoff, 0);
  assert.equal(cleanCost.speed, 0);
  assert.ok(Math.abs(cleanCost.flight) <= 1.5, `siisti liito ${cleanCost.flight}`);

  const early = run({ takeoffAt: 3.4 }), earlyCost = analyzeJump(hill, early.jump);
  const realLoss = clean.result.distance - early.result.distance;
  assert.ok(Math.abs(earlyCost.takeoff - realLoss) <= 2, `ponnistus ${earlyCost.takeoff} vs todellinen ${realLoss}`);
  assert.equal(earlyCost.speed, 0);

  const poor = run({ balance: 0.6 }), poorCost = analyzeJump(hill, poor.jump);
  const speedLoss = clean.result.distance - poor.result.distance;
  assert.ok(Math.abs(poorCost.speed - speedLoss) <= 2, `kyykky ${poorCost.speed} vs todellinen ${speedLoss}`);
  assert.ok(Math.abs(poorCost.kmh - (clean.jump.takeoffSpeed - poor.jump.takeoffSpeed) * 3.6) < 0.15, `km/h ${poorCost.kmh}`);

  const lazy = run({ steer: false }), lazyCost = analyzeJump(hill, lazy.jump);
  assert.ok(lazyCost.flight > 10, `ohjaamaton liito ${lazyCost.flight}`);
  assert.equal(analyzeJump(hill, runJump(hill, fixedWind(0), { balance: false }, 1).jump), null, 'vauhtimäessä kaatunut');
});

test('väliajat: lentokorkeus tallentuu väliaikapisteissä', () => {
  const { jump } = runJump(hill, fixedWind(0));
  assert.equal(jump.splits.length, SPLITS.length);
  for (const s of jump.splits) assert.ok(s.height > 1 && s.height < 9 && s.t > 0, `korkeus ${s.height}`);
  assert.ok(jump.splits[1].t > jump.splits[0].t);
  assert.equal(runJump(hill, fixedWind(0), { steer: 1, landLead: null }).jump.splits.length < SPLITS.length, true, 'lyhyt hyppy ei yllä kaikkiin');
});

test('haamu: hypyn rata nauhoittuu ja toistuu samana', () => {
  const { jump } = runJump(hill, fixedWind(0));
  const track = JSON.parse(JSON.stringify(jump.track)); // sama muoto kuin tallennuksesta luettuna
  assert.ok(validTrack(track));
  assert.ok(!validTrack(null) && !validTrack({ dt: 1 / 30, x: [1], y: [1], a: [0], p: [0] }), 'tyhjä tai katkennut nauha');
  assert.ok(JSON.stringify(track).length < 12000, `nauhan koko ${JSON.stringify(track).length}`);
  // Alku puomilla kyykyssä, loppu rinteessä hieman alastulon jälkeen
  const gate = hill.inrunPos(hill.inrunLength), start = sampleTrack(track, 0);
  assert.ok(Math.hypot(start.x - gate.x, start.y - gate.y) < 0.05 && start.pose === 'crouch');
  const n = track.x.length, end = (n - 1) * track.dt;
  assert.ok(track.x[n - 1] > jump.touchdown.x && track.x[n - 1] < jump.touchdown.x + 60, 'nauha päättyy alastulon jälkeen');
  assert.equal(sampleTrack(track, end), null);
  assert.equal(sampleTrack(track, -0.1), null);
  // Haamu on alastulohetkellä alastulopaikassa ja häipyy nauhan lopussa
  const flightStart = track.p.indexOf(2) * track.dt;
  const landT = track.p.findIndex((p) => p === 4 || p === 5) * track.dt;
  assert.ok(flightStart > 3 && landT > flightStart + 2, `lento ${flightStart}..${landT}`);
  const land = sampleTrack(track, landT);
  assert.ok(Math.abs(land.x - jump.touchdown.x) < 1.5, `alastulo ${land.x} vs ${jump.touchdown.x}`);
  assert.equal(sampleTrack(track, landT - 1).pose, 'flight');
  assert.equal(sampleTrack(track, landT - 1).alpha, 1);
  assert.ok(sampleTrack(track, end - GHOST.fade / 2).alpha < 0.6);
  // Kello käy alastulon jälkeenkin, jotta haamu ehtii perille vaikka pelaaja jäisi lyhyeksi
  assert.ok(jump.runT > end);
  // Kaatuneen hypyn nauha päättyy kaatumiseen
  const crashed = runJump(hill, fixedWind(0), { balance: false }, 1).jump;
  assert.ok(crashed.track.x.length * crashed.track.dt < crashed.runT - 1);
});

test('haamu: palvelin hyväksyy pelin nauhan ja hylkää rikkinäisen', () => {
  const { jump } = runJump(hill, fixedWind(2));
  const stored = cleanGhost(JSON.parse(JSON.stringify(jump.track)));
  assert.ok(stored && stored.length < 24 * 1024 - 300, `tallennettu koko ${stored?.length}`);
  assert.deepEqual(JSON.parse(stored), jump.track, 'rata säilyy muuttumattomana');
  assert.ok(validTrack(JSON.parse(stored)));
  const broken = (change) => { const t = JSON.parse(stored); change(t); return cleanGhost(t); };
  assert.equal(cleanGhost(null), null);
  assert.equal(cleanGhost('x'), null);
  assert.equal(broken((t) => { t.dt = 5; }), null, 'aika-askel');
  assert.equal(broken((t) => { t.x.pop(); }), null, 'eripituiset sarjat');
  assert.equal(broken((t) => { t.y[3] = null; }), null, 'puuttuva arvo');
  assert.equal(broken((t) => { t.y[3] = '1'; }), null, 'teksti');
  assert.equal(broken((t) => { t.x[5] = 1e9; }), null, 'mäen ulkopuolella');
  assert.equal(broken((t) => { t.p[0] = 99; }), null, 'tuntematon asento');
  assert.equal(broken((t) => { t.x[40] = t.x[39] - 5; }), null, 'taaksepäin');
  assert.equal(broken((t) => { for (const k of 'xyap') t[k].length = 10; }), null, 'liian lyhyt');
  assert.equal(broken((t) => { for (const k of 'xyap') t[k] = Array(2000).fill(t[k][0]); }), null, 'liian pitkä');
});

test('tavoitteet: viivat ja erot lasketaan tulostaulusta', () => {
  const top = [{ name: 'Aino', total: 150 }, { name: 'Minä', total: 131 }, { name: 'Pena', total: 140.2 }, { name: 'Ville', total: 120 }];
  top.sort((a, b) => b.total - a.total);
  // Viivan pituudella ja oletustyylillä pisteet ylittävät tavoitteen, puoli metriä lyhyemmällä eivät
  for (const total of [120, 131.3, 140.2]) {
    const d = distanceFor(hill, total), pts = (dd) => distancePoints(hill, dd) + TARGET_JUDGE * 3;
    assert.ok(pts(d) > total && pts(d - 0.5) <= total, `tavoite ${total}: ${d} m`);
  }
  const { leader, next } = findRivals(top, 'Minä', 131);
  assert.deepEqual([leader.name, leader.rank, next.name, next.rank], ['Aino', 1, 'Pena', 2]);
  const lines = hillTargets(hill, { distance: 124.5, total: 131 }, top, 'Minä');
  assert.deepEqual(lines.map((l) => l.kind), ['own', 'next', 'leader']);
  assert.equal(lines[0].d, 124.5);
  assert.ok(lines[1].d < lines[2].d && lines[2].d <= hill.hs + 16);
  assert.match(rivalGap(top, 'Minä', 131), /^Sijaan 2 \(Pena\) on matkaa 9,2 p\.$/);
  assert.match(rivalGap(top, 'Minä', 141), /^Kärkeen \(Aino\) on matkaa 9,0 p\.$/);
  assert.equal(rivalGap(top, 'Aino', 150), 'Johdat tulostaulua.');
  // Vanhentunut taulu (oma parannus ei vielä näy siinä) ei riitä johtamisen väittämiseen
  assert.equal(rivalGap(top, 'Minä', 151), '');
  assert.equal(rivalGap(null, 'Minä', 100), '');
  // Ilman tulostaulua jää vain oma ennätys, ilman ennätystä ei mitään
  assert.deepEqual(hillTargets(hill, { distance: 110, total: 90 }, null, null).map((l) => l.kind), ['own']);
  assert.deepEqual(hillTargets(hill, null, null, null), []);
  // Kärjessä olevalle ei piirretä kilpailijoita
  assert.deepEqual(hillTargets(hill, { distance: 135, total: 151 }, top, 'Minä').map((l) => l.kind), ['own']);
});

console.log(`${passed} testiä OK`);
