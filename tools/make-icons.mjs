// Tekee PNG-kuvakkeet tiedostosta icons/icon.svg headless-selaimella.
//   node tools/make-icons.mjs

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/cdp.mjs';

const icons = join(fileURLToPath(import.meta.url), '..', '..', 'icons');
const page = await launch({ port: 8124, debugPort: 9334 });
try {
  for (const [name, size] of [['icon-180', 180], ['icon-192', 192], ['icon-512', 512], ['icon-maskable-512', 512]]) {
    await page.viewport(size, size, false);
    await page.goto(`${page.url}icons/icon.svg`);
    await page.screenshot(join(icons, `${name}.png`), { x: 0, y: 0, width: size, height: size });
    console.log(`${name}.png`);
  }
} finally {
  await page.close();
}
