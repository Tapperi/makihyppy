// Näppäimistö- ja kosketusohjaus yhdeksi syötteeksi:
//   action = kertapainallus (lähtö / ponnistus / alastulo)
//   lean   = -1..1, + = nojaa eteen (suksien kärjet alas)

const ACTION_KEYS = new Set(['Space', 'Enter']);
const FWD_KEYS = new Set(['ArrowDown', 'ArrowRight', 'KeyS', 'KeyD']);
const BACK_KEYS = new Set(['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA']);

export class Input {
  constructor() {
    this.actionQueued = false;
    this.fwd = new Set();   // aktiiviset "eteen"-lähteet (näppäin tai osoitin)
    this.back = new Set();
    this.enabled = true;
  }

  /** Palauttaa syötteen yhdelle fysiikka-askeleelle. action kuluu lukiessa. */
  poll() {
    const action = this.actionQueued;
    this.actionQueued = false;
    return { action, lean: (this.fwd.size ? 1 : 0) - (this.back.size ? 1 : 0) };
  }

  /** Lukee ja nollaa painalluksen ilman fysiikka-askelta (valikoita varten). */
  takeAction() {
    const a = this.actionQueued;
    this.actionQueued = false;
    return a;
  }

  clear() {
    this.actionQueued = false;
    this.fwd.clear();
    this.back.clear();
  }

  attach({ canvas, btnAction, btnFwd, btnBack }) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLButtonElement && ACTION_KEYS.has(e.code)) return; // anna painikkeen hoitaa
      if (ACTION_KEYS.has(e.code)) { if (!e.repeat) this.actionQueued = true; }
      else if (FWD_KEYS.has(e.code)) this.fwd.add(e.code);
      else if (BACK_KEYS.has(e.code)) this.back.add(e.code);
      else return;
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.fwd.delete(e.code);
      this.back.delete(e.code);
    });
    window.addEventListener('blur', () => this.clear());

    const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(e); });
    press(canvas, () => { this.actionQueued = true; });
    press(btnAction, () => { this.actionQueued = true; });

    const hold = (el, set) => {
      press(el, (e) => {
        set.add('p' + e.pointerId);
        try { el.setPointerCapture(e.pointerId); } catch { /* ei tuettu */ }
        el.classList.add('down');
      });
      const release = (e) => {
        set.delete('p' + e.pointerId);
        if (![...set].some((k) => k[0] === 'p')) el.classList.remove('down');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    };
    hold(btnFwd, this.fwd);
    hold(btnBack, this.back);

    // Estä pitkän painalluksen valikot ja kaksoisnapautuszoomi
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
