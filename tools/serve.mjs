// Pieni staattinen kehityspalvelin ilman riippuvuuksia.
//   node tools/serve.mjs [portti]
// Avaa http://localhost:8080 – samassa verkossa oleva puhelin pääsee osoitteeseen
// http://<koneen-ip>:8080 (PWA-asennus vaatii kuitenkin HTTPS:n tai localhostin).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const port = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) throw Object.assign(new Error('forbidden'), { code: 403 });
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 403 ? 403 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err.code === 403 ? 'Kielletty' : 'Ei löydy');
  }
}).listen(port, () => {
  console.log(`Tuulimäki: http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log(`  verkossa:  http://${ni.address}:${port}`);
    }
  }
});
