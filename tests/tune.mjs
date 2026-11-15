// Viritysapu: tulostaa taulukon hyppyjen pituuksista eri tilanteissa.
//   node tests/tune.mjs
import { HILLS } from '../js/config.js';
import { createHill } from '../js/hill.js';
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
for (const w of [-3, -1.5, 0, 1.5, 3]) {
  console.log(`\nTuuli ${w} m/s`);
  for (const [name, opts] of cases) {
    const { jump, result, maxHeight, flightTime } = runJump(hill, fixedWind(w), opts);
    console.log(
      `  ${name.padEnd(24)} ${result.distance.toFixed(1).padStart(6)} m  ${result.outcome.padEnd(8)} tyyli ${result.style.toFixed(1).padStart(4)}  yht ${result.total.toFixed(1).padStart(6)}` +
      `  v0=${(jump.takeoffSpeed * 3.6).toFixed(1)} km/h  isku=${jump.touchdown.impact.toFixed(1)}  korkeus=${maxHeight.toFixed(1)}  lento=${flightTime.toFixed(1)} s`);
  }
}
