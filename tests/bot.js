// Testibotti: ajaa hypyn ilman selainta. Sama idea kelpaa vaiheessa 2
// tietokonevastustajien pohjaksi.

import { STEP, FLIGHT, DEG } from '../js/config.js';
import { Jump, Phase } from '../js/jump.js';
import { makeRng } from '../js/util.js';

/** Vakiotuuli testejä varten. */
export const fixedWind = (value) => ({ value, history: [], update() {}, reset() {} });

/**
 * @param opts.takeoffAt  ponnistuskohta metreinä ennen nokkaa (null = ei ponnistusta)
 * @param opts.balance    true = pitää kyykkyasennon kaistalla vauhtimäessä
 * @param opts.steer      true = pitää kohtauskulman optimissa
 * @param opts.landLead   alastulonapin painallus näin monta sekuntia ennen maata (null = ei paineta)
 */
export function runJump(hill, wind, opts = {}, seed = 1) {
  const { takeoffAt = 0.4, steer = true, landLead = 0.3, balance = true } = opts;
  const jump = new Jump(hill, wind, makeRng(seed));
  let started = false, landed = false, maxHeight = 0, flightTime = 0;

  for (let i = 0; i < 120 * 90 && jump.phase !== Phase.DONE; i++) {
    const input = { action: false, lean: 0 };
    if (jump.phase === Phase.READY && !started) { input.action = true; started = true; }
    else if (jump.phase === Phase.INRUN) {
      if (balance) input.lean = Math.max(-1, Math.min(1, (jump.balance + 0.15 * jump.balanceVel) / 0.05));
      if (takeoffAt !== null && !jump.takeoff.pressed && jump.d - jump.speed * STEP * 0.5 <= takeoffAt) input.action = true;
    } else if (jump.phase === Phase.FLIGHT) {
      flightTime = jump.t;
      maxHeight = Math.max(maxHeight, jump.height);
      if (steer) input.lean = Math.max(-1, Math.min(1, (jump.aoa - FLIGHT.aoaOpt - jump.bandCenter) / (4 * DEG)));
      if (landLead !== null && !landed && jump.t > FLIGHT.landArmTime) {
        // arvio ajasta maahan: korkeus / lähestymisnopeus rinnettä kohti
        const slope = hill.slopeAtX(jump.x);
        const closing = -(jump.vx * Math.sin(slope) + jump.vy * Math.cos(slope));
        if (closing > 0 && jump.height / closing < landLead) { input.action = true; landed = true; }
      }
    }
    jump.step(STEP, input);
  }
  return { jump, result: jump.result, maxHeight, flightTime };
}
