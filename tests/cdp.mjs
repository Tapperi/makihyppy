// Minimaalinen Chrome DevTools Protocol -ajuri selaintestejä varten (ei riippuvuuksia).
// Käynnistää headless Edgen/Chromen ja kehityspalvelimen.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 8123, debugPort = 9333 } = {}) {
  const root = join(fileURLToPath(import.meta.url), '..', '..');
  const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(port)], { stdio: 'ignore' });

  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error('Selainta ei löytynyt – aseta BROWSER_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'tuulimaki-test-'));
  const browser = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  // Odota, että DevTools vastaa
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(150);
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* ei vielä käynnissä */ }
  }
  if (!target) throw new Error('Selain ei käynnistynyt');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      errors.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable');

  const page = {
    errors,
    send,
    url: `http://localhost:${port}/`,
    async viewport(width, height, mobile = true) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    },
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(900);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async screenshot(file, clip) {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      await writeFile(file, Buffer.from(r.data, 'base64'));
    },
    async key(code, type = 'tap') {
      const key = code === 'Space' ? ' ' : code;
      const vk = { Space: 32, ArrowUp: 38, ArrowDown: 40, Enter: 13, Escape: 27 }[code];
      const base = { code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      if (type !== 'up') await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (type !== 'down') await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async touch(x, y, type = 'tap') {
      if (type !== 'up') await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      if (type !== 'down') await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    /** Elementin keskipiste ruudulla. */
    center(id) {
      return page.eval(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    },
    /** Odottaa, kunnes lauseke on tosi. */
    async until(expression, timeout = 20000, interval = 15) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const v = await page.eval(expression);
        if (v) return v;
        await sleep(interval);
      }
      throw new Error(`Aikakatkaisu: ${expression}`);
    },
    async close() {
      try { await send('Browser.close'); } catch { /* jo kiinni */ }
      ws.close();
      server.kill();
      browser.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* lukittu – jää temp-kansioon */ }
    },
  };
  return page;
}
