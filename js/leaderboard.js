// Globaali tulostaulu: yhteys Cloudflare Workeriin (worker/).
// Peli toimii täysin ilman tätä – verkkovirheet eivät koskaan estä pelaamista.

import { LEADERBOARD, SEASON } from './config.js';
import { getPlayer, savePlayer, getOnlineBest, saveOnlineBest } from './storage.js';

const TIMEOUT = 8000;

/** Sama sääntö kuin palvelimella: 3–16 merkkiä, kirjaimia, numeroita, välejä ja . _ - */
const NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._-]*[\p{L}\p{N}])?$/u;

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
// Kehityskoneella tulostaulu on pois päältä, ellei osoitetta anneta: ?api=http://localhost:8787
const API = (local ? new URLSearchParams(location.search).get('api') : LEADERBOARD.url)?.replace(/\/+$/, '') || '';

export const enabled = !!API;

export function cleanName(raw) {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Palauttaa virhetekstin tai null, jos nimi kelpaa. */
export function nameError(raw) {
  const name = cleanName(raw);
  const length = [...name].length;
  if (length < 3) return 'Nimessä pitää olla vähintään 3 merkkiä.';
  if (length > 16) return 'Nimessä saa olla enintään 16 merkkiä.';
  if (!NAME_RE.test(name)) return 'Käytä vain kirjaimia, numeroita, välejä ja merkkejä . _ -';
  return null;
}

function newDeviceId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // randomUUID puuttuu ilman HTTPS:ää (esim. puhelin kehityspalvelimella)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function playerName() {
  return getPlayer()?.name ?? null;
}

/** Tallentaa nimen; laitetunnus arvotaan ensimmäisellä kerralla ja pysyy samana. */
export function setPlayerName(raw) {
  const prev = getPlayer();
  savePlayer({ name: cleanName(raw), deviceId: prev?.deviceId ?? newDeviceId() });
}

async function request(path, options) {
  const res = await fetch(API + path, { ...options, signal: AbortSignal.timeout(TIMEOUT) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Kannattaako tulos lähettää: vain jos se parantaa palvelimella olevaa parasta. */
export function shouldSubmit(hillId, result) {
  if (!enabled || !getPlayer()) return false;
  const best = getOnlineBest(hillId);
  return !best || best.name !== getPlayer().name || result.total > best.total;
}

/**
 * Lähettää tuloksen. Palauttaa
 *   {ok: true, rank, improved, best}
 *   | {ok: false, reason: 'name_taken' | 'bad_name' | 'rate_limited' | 'season' | 'offline' | 'error'}
 */
export async function submitScore(hillId, result) {
  const player = getPlayer();
  try {
    const { status, body } = await request('/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: player.name,
        deviceId: player.deviceId,
        hill: hillId,
        season: SEASON,
        distance: result.distance,
        style: result.style,
      }),
    });
    if (status === 200) {
      saveOnlineBest(hillId, { name: player.name, total: body.best.total });
      return { ok: true, rank: body.rank, improved: body.improved, best: body.best };
    }
    if (status === 409) return { ok: false, reason: 'name_taken' };
    if (status === 429) return { ok: false, reason: 'rate_limited' };
    if (body.error === 'bad_name') return { ok: false, reason: 'bad_name' };
    if (body.error === 'season_mismatch') return { ok: false, reason: 'season' };
    return { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

/**
 * Kauden 50 parasta: {season, seasonName, currentSeason, top: [{name, distance, style, total, at}]}.
 * season puuttuu = nykyinen kausi. Heittää virheen, jos haku ei onnistu.
 */
export async function fetchTop(hillId, season) {
  const q = `/top?hill=${encodeURIComponent(hillId)}` + (season ? `&season=${season}` : '');
  const { status, body } = await request(q);
  if (status !== 200) throw new Error(body.error || `HTTP ${status}`);
  return body;
}
