// Tuulimäen globaali tulostaulu: Cloudflare Worker + D1.
//   POST /score  {name, deviceId, hill, season, distance, style, ghost?}
//   GET  /top?hill=tuulivaara&season=2   50 parasta, paras tulos per pelaaja (oletus: nykyinen kausi)
//   GET  /ghost?hill=tuulivaara          haamuhyppääjä: nykyisen kauden parhaan tuloksen rata
//
// Palvelin laskee kokonaispisteet itse pituudesta ja tyylipisteistä, joten
// asiakkaan ilmoittamaan summaan ei luoteta.

import { cleanGhost } from './ghost.js';

/** Mäet: pidä samana kuin pelin js/config.js. maxDistance = pisin uskottava hyppy. */
const HILLS = {
  tuulivaara: { k: 120, pointsPerMeter: 1.8, maxDistance: 155 },
};

/**
 * Kaudet. Kausi vaihtuu, kun pelin fysiikka muuttuu niin, etteivät vanhat tulokset ole
 * vertailukelpoisia: kasvata SEASON-arvoa täällä ja pelin js/config.js:ssä. Uusi kausi
 * alkaa tyhjältä taululta, vanhat kaudet jäävät näkyviin. Nimet otetaan järjestyksessä.
 */
const SEASON = 4;
const SEASON_NAMES = [
  'Murtumaraja',
  'Kriittinen Piste',
  'Nivelsiteiden Syksy',
  'Pehmeä Lasku',
  'Vastatuuleen',
  'Ristiside',
  'Viimeinen Telemark',
  'Pakkasen Kynsissä',
  'Kaatumisen Taito',
  'Kolmas Tuomio',
];
const seasonName = (n) => SEASON_NAMES[n - 1] ?? `Kausi ${n}`;

const TOP_LIMIT = 50;
const NAME_MIN = 3;
const NAME_MAX = 16;
const MAX_STYLE = 60;        // 3 × 20
const STYLE_STEP = 1.5;      // 3 × puolen pisteen portaat
const DISTANCE_STEP = 0.5;
const DEVICE_COOLDOWN_MS = 5000;   // yksi hyppy kestää pidempään kuin tämä
const MAX_BODY = 24 * 1024;   // haamun rata on noin 10 kt

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._-]*[\p{L}\p{N}])?$/u;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = origin === env.ALLOWED_ORIGIN;
    const cors = allowed
      ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
      : { 'Vary': 'Origin' };
    const json = (status, body, extra) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra },
    });

    try {
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      // Vieraalta sivulta tulevat selainpyynnöt torjutaan kokonaan
      if (origin && !allowed) return json(403, { error: 'origin_not_allowed' });

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

      if (route === 'GET /top') {
        if (!(await env.RL_GET.limit({ key: ip })).success) return tooMany(json, 60);
        return await getTop(url, env, json);
      }
      if (route === 'GET /ghost') {
        if (!(await env.RL_GET.limit({ key: ip })).success) return tooMany(json, 60);
        return await getGhost(url, env, json);
      }
      if (route === 'POST /score') {
        // Tuloksia saa lähettää vain pelisivulta
        if (!allowed) return json(403, { error: 'origin_not_allowed' });
        if (!(await env.RL_POST.limit({ key: ip })).success) return tooMany(json, 60);
        return await postScore(request, env, json);
      }
      return json(404, { error: 'not_found' });
    } catch (err) {
      console.error(err);
      return json(500, { error: 'server_error' });
    }
  },
};

const tooMany = (json, seconds) => json(429, { error: 'rate_limited' }, { 'Retry-After': String(seconds) });

async function getTop(url, env, json) {
  const hill = url.searchParams.get('hill') || 'tuulivaara';
  if (!Object.hasOwn(HILLS, hill)) return json(400, { error: 'unknown_hill' });
  const raw = url.searchParams.get('season');
  const season = raw === null ? SEASON : Number(raw);
  if (!Number.isInteger(season) || season < 1 || season > SEASON) return json(400, { error: 'unknown_season' });
  const { results } = await env.DB.prepare(
    `SELECT p.name, s.distance, s.style, s.total, s.achieved_at AS at, s.ghost IS NOT NULL AS ghost
       FROM scores s JOIN players p ON p.device_hash = s.device_hash
      WHERE s.season = ? AND s.hill = ?
      ORDER BY s.total DESC, s.distance DESC, s.achieved_at ASC
      LIMIT ?`,
  ).bind(season, hill, TOP_LIMIT).all();
  return json(200, { hill, season, seasonName: seasonName(season), currentSeason: SEASON, top: results }, { 'Cache-Control': 'public, max-age=20' });
}

/**
 * Haamuhyppääjä: nykyisen kauden paras tulos, jolla on rata. Yleensä tulostaulun kärki –
 * jos kärjen tulos on ajalta ennen haamuja tai päättyi kaatumiseen, seuraava jolla rata on.
 */
async function getGhost(url, env, json) {
  const hill = url.searchParams.get('hill') || 'tuulivaara';
  if (!Object.hasOwn(HILLS, hill)) return json(400, { error: 'unknown_hill' });
  const row = await env.DB.prepare(
    `SELECT p.name, s.distance, s.total, s.achieved_at AS at, s.ghost
       FROM scores s JOIN players p ON p.device_hash = s.device_hash
      WHERE s.season = ? AND s.hill = ? AND s.ghost IS NOT NULL
      ORDER BY s.total DESC, s.distance DESC, s.achieved_at ASC
      LIMIT 1`,
  ).bind(SEASON, hill).first();
  const body = row ? { ...row, ghost: JSON.parse(row.ghost) } : { ghost: null };
  return json(200, { hill, season: SEASON, ...body }, { 'Cache-Control': 'public, max-age=20' });
}

async function postScore(request, env, json) {
  const input = await readInput(request);
  if (input.error) return json(400, { error: input.error });
  const { name, nameKey, deviceId, hill, distance, style, ghost } = input;

  const def = HILLS[hill];
  const total = round1(Math.max(0, 60 + (distance - def.k) * def.pointsPerMeter) + style);
  const deviceHash = await sha256(deviceId);
  const now = Date.now();
  const db = env.DB;

  // Nimi kuuluu sille laitteelle, joka otti sen ensin käyttöön
  const owner = await db.prepare('SELECT device_hash FROM players WHERE name_key = ?').bind(nameKey).first();
  if (owner && owner.device_hash !== deviceHash) return json(409, { error: 'name_taken' });

  const player = await db.prepare('SELECT name, last_post_at FROM players WHERE device_hash = ?').bind(deviceHash).first();
  if (player && now - player.last_post_at < DEVICE_COOLDOWN_MS) return tooMany(json, 5);

  try {
    await db.batch([
      // Uusi pelaaja, tai sama laite vaihtaa nimeään
      db.prepare(
        `INSERT INTO players (device_hash, name, name_key, created_at, last_post_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (device_hash) DO UPDATE SET name = ?2, name_key = ?3, last_post_at = ?4`,
      ).bind(deviceHash, name, nameKey, now),
      // Vain parannus korvaa aiemman tuloksen. Rata vaihtuu tuloksen mukana, jotta haamu on aina samasta hypystä.
      db.prepare(
        `INSERT INTO scores (device_hash, hill, season, distance, style, total, achieved_at, ghost)
         VALUES (?1, ?2, ?7, ?3, ?4, ?5, ?6, ?8)
         ON CONFLICT (device_hash, hill, season) DO UPDATE
           SET distance = ?3, style = ?4, total = ?5, achieved_at = ?6, ghost = ?8
         WHERE ?5 > scores.total OR (?5 = scores.total AND ?3 > scores.distance)`,
      ).bind(deviceHash, hill, distance, style, total, now, SEASON, ghost),
    ]);
  } catch (err) {
    // Kaksi laitetta ehti varata saman nimen yhtä aikaa
    if (String(err?.message).includes('UNIQUE')) return json(409, { error: 'name_taken' });
    throw err;
  }

  const best = await db.prepare(
    'SELECT distance, style, total, achieved_at AS at FROM scores WHERE device_hash = ? AND hill = ? AND season = ?',
  ).bind(deviceHash, hill, SEASON).first();
  const ahead = await db.prepare(
    `SELECT COUNT(*) AS n FROM scores
      WHERE season = ?5 AND hill = ?1 AND (total > ?2
         OR (total = ?2 AND distance > ?3)
         OR (total = ?2 AND distance = ?3 AND achieved_at < ?4))`,
  ).bind(hill, best.total, best.distance, best.at, SEASON).first();

  return json(200, { name, hill, season: SEASON, best, rank: ahead.n + 1, improved: best.at === now });
}

/** Lukee ja tarkistaa pyynnön rungon. Palauttaa kentät tai {error}. */
async function readInput(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: 'too_large' };
  let body;
  try { body = JSON.parse(text); } catch { return { error: 'bad_json' }; }
  if (!body || typeof body !== 'object') return { error: 'bad_json' };

  if (typeof body.name !== 'string') return { error: 'bad_name' };
  const name = body.name.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX || !NAME_RE.test(name)) return { error: 'bad_name' };

  if (typeof body.deviceId !== 'string' || !UUID_RE.test(body.deviceId)) return { error: 'bad_device' };
  if (typeof body.hill !== 'string' || !Object.hasOwn(HILLS, body.hill)) return { error: 'unknown_hill' };
  // Vanha pelin versio (eri fysiikka) ei saa lähettää tuloksia nykyiselle kaudelle
  if (body.season !== SEASON) return { error: 'season_mismatch' };

  const { distance, style } = body;
  const onStep = (v, step) => Number.isInteger(Math.round(v / step * 1e6) / 1e6);
  if (!Number.isFinite(distance) || distance < 0 || distance > HILLS[body.hill].maxDistance
    || !onStep(distance, DISTANCE_STEP)) return { error: 'bad_distance' };
  if (!Number.isFinite(style) || style < 0 || style > MAX_STYLE
    || !onStep(style, STYLE_STEP)) return { error: 'bad_style' };

  return {
    name,
    nameKey: name.normalize('NFKC').toLowerCase(),
    deviceId: body.deviceId.toLowerCase(),
    hill: body.hill,
    distance,
    style,
    ghost: cleanGhost(body.ghost), // kelvoton rata ei hylkää tulosta: se jää vain ilman haamua
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
