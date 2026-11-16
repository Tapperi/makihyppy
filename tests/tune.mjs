// Viritysapu: tulostaa taulukon hyppyjen pituuksista eri tilanteissa.
//   node tests/tune.mjs
import { HILLS, WIND, SEASON } from '../js/config.js';
import { createHill } from '../js/hill.js';
import { Wind, seasonPattern, patternAt } from '../js/wind.js';
import { makeRng } from '../js/util.js';
import { runJump, fixedWind } from './bot.js';

const hill = createHill(HILLS.tuulivaara);
const k = hill.landingPos(hill.k), top = hill.inrunPos(hill.inrunLength);
console.log(`K-piste: n=${k.x.toFixed(1)} h=${(-k.y).toFixed(1)} h/n=${(-k.y / k.x).toFixed(3)}  puomi: x=${top.x.toFixed(1)} y=${top.y.toFixed(1)}`);

const cases = [
  ['täydellinen', {}],
  ['ponnistus 3 m aikaisin', { takeoffAt: 3.4 }],
  ['ponnistus 6 m aikaisin', { takeoffAt: 6.4 }],
  ['ei ponnistusta', { takeoffAt: null }],
  ['ei asennon säätöä', { steer: false }],
  ['alastulo 1 s etuajassa', { landLead: 1.0 }],
  ['ei alastuloa', { landLead: null }],
];
// Kauden tuulikuvio: tuuli silmukan eri kohdissa ja hyvän botin pituus, kun puomilta lähtee siinä kohdassa.
//   node tests/tune.mjs [kausi]
const season = Number(process.argv[2]) || SEASON;
const pattern = seasonPattern(season, hill.def.id);
console.log(`\nKausi ${season}: ${pattern.dir > 0 ? 'vastatuuli' : 'myötätuuli'} ${pattern.strength.toFixed(2)} m/s, puuskat ` +
  pattern.bursts.map((b) => `${b.at.toFixed(1)} s ${b.amp > 0 ? '+' : ''}${b.amp.toFixed(1)} (${b.dur.toFixed(1)} s)`).join(', '));
for (let pos = 0; pos < WIND.loop; pos += 0.5) {
  const w = patternAt(pattern, pos).wind;
  const ds = [];
  for (let s = 1; s <= 6; s++) {
    const wind = new Wind(makeRng(s), pattern);
    const reset = wind.reset.bind(wind);
    wind.reset = () => reset(pos);
    ds.push(runJump(hill, wind, {}, s).result.distance);
  }
  const col = Math.round((w + WIND.max) * 3);
  const bar = Array.from({ length: WIND.max * 6 + 1 }, (_, i) => (i === col ? '●' : i === WIND.max * 3 ? '|' : ' ')).join('');
  console.log(`  ${pos.toFixed(1).padStart(4)} s ${w.toFixed(1).padStart(5)} m/s  ${bar}  lähtö tästä: ${Math.min(...ds).toFixed(1)}–${Math.max(...ds).toFixed(1)} m`);
}

for (const w of [-3, -1.5, 0, 1.5, 3]) {
  console.log(`\nTuuli ${w} m/s`);
  for (const [name, opts] of cases) {
    const { jump, result, maxHeight, flightTime } = runJump(hill, fixedWind(w), opts);
    console.log(
      `  ${name.padEnd(24)} ${result.distance.toFixed(1).padStart(6)} m  ${result.outcome.padEnd(8)} tyyli ${result.style.toFixed(1).padStart(4)}  yht ${result.total.toFixed(1).padStart(6)}` +
      `  v0=${(jump.takeoffSpeed * 3.6).toFixed(1)} km/h  isku=${jump.touchdown.impact.toFixed(1)}  korkeus=${maxHeight.toFixed(1)}  lento=${flightTime.toFixed(1)} s`);
  }
}
