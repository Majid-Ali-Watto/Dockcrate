#!/usr/bin/env node
// Regenerates every logo, icon and social image from the one mark defined below.
// Needs Chrome or Chromium (set CHROME_PATH if it is not on your PATH):  npm run icons
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLUE = '#2563eb';
const DARK = '#0e1116';

// The mark: a stack of containers on a hull, drawn on a 64x64 grid.
const GLYPH =
  '<rect x="12" y="15" width="12" height="10" rx="2"/><rect x="26" y="15" width="12" height="10" rx="2"/><rect x="40" y="15" width="12" height="10" rx="2"/>' +
  '<rect x="19" y="27" width="12" height="10" rx="2"/><rect x="33" y="27" width="12" height="10" rx="2"/>' +
  '<path d="M9 39h46l-5 9c-1.6 2.8-4.4 4-7.6 4H21.6c-3.2 0-6-1.2-7.6-4z"/>';
const GRADIENT = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>`;
const svg = (inner, size = 64) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${inner}</svg>`;

// Rounded tile (browser tabs, "any" icons), full-bleed tile (iOS and maskable icons crop it themselves), plain glyph.
const tile = svg(`${GRADIENT}<rect width="64" height="64" rx="14" fill="url(#g)"/><g fill="#fff">${GLYPH}</g>`);
const fullBleed = (scale) =>
  svg(`${GRADIENT}<rect width="64" height="64" fill="url(#g)"/><g fill="#fff" transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})">${GLYPH}</g>`);
const pinned = svg(`<g fill="#000">${GLYPH}</g>`);

const social = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:radial-gradient(circle at 85% 10%,#1e3a8a 0,${DARK} 55%);color:#e6edf3;
font-family:system-ui,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px}
.row{display:flex;align-items:center;gap:36px}h1{font-size:112px;margin:0;letter-spacing:-2px}
p{font-size:42px;line-height:1.3;margin:34px 0 0;color:#a5b4c8;max-width:900px}
.chips{display:flex;gap:14px;margin-top:44px}.chips span{border:2px solid #334155;border-radius:99px;padding:8px 22px;font-size:28px;color:#cbd5e1}
</style><div class="row">${svg(`${GRADIENT}<rect width="64" height="64" rx="14" fill="url(#g)"/><g fill="#fff">${GLYPH}</g>`, 150)}<h1>Shipkit</h1></div>
<p>Dockerfile, Compose, CI/CD and deployment config for any project.</p>
<div class="chips"><span>Docker</span><span>GitHub Actions</span><span>GitLab CI</span><span>Kubernetes</span><span>Cloud Run</span></div>`;

const chrome =
  process.env.CHROME_PATH ||
  ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((c) => spawnSync(c, ['--version']).status === 0);
if (!chrome) throw new Error('Chrome or Chromium is needed to render the icons: set CHROME_PATH');

const work = mkdtempSync(join(tmpdir(), 'shipkit-icons-'));
const file = (...parts) => join(ROOT, ...parts);
const put = (path, data) => (mkdirSync(join(path, '..'), { recursive: true }), writeFileSync(path, data));

/** Renders `html` in headless Chrome at exactly width x height and returns the PNG bytes (transparent background). */
function shot(html, width, height) {
  const page = join(work, `${width}x${height}-${Math.random().toString(36).slice(2)}.html`);
  const out = page.replace('.html', '.png');
  writeFileSync(page, html.startsWith('<!doctype') ? html : `<!doctype html><body style="margin:0">${html}`);
  const run = spawnSync(
    chrome,
    ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`],
    { stdio: 'ignore' },
  );
  if (run.status !== 0) throw new Error(`Chrome failed to render ${width}x${height}`);
  const png = readFileSync(out);
  if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(`unexpected PNG size for ${width}x${height}`);
  return png;
}

/** A .ico that embeds PNGs (supported everywhere since Vista). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    head[at] = size % 256; // 0 means 256
    head[at + 1] = size % 256;
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

const render = (markup, size) => shot(markup.replace(/width="64" height="64"/, `width="${size}" height="${size}"`), size, size);

put(file('app/icon.svg'), tile + '\n');
put(file('public/logo.svg'), tile + '\n');
put(file('public/safari-pinned-tab.svg'), pinned + '\n');
put(file('app/favicon.ico'), ico([16, 32, 48].map((size) => ({ size, png: render(tile, size) }))));
put(file('app/apple-icon.png'), render(fullBleed(0.74), 180));
put(file('public/icons/icon-192.png'), render(tile, 192));
put(file('public/icons/icon-512.png'), render(tile, 512));
put(file('public/icons/maskable-512.png'), render(fullBleed(0.6), 512)); // glyph inside the 80% safe zone
put(file('public/og-image.png'), shot(social, 1200, 630)); // Open Graph and Twitter card (metadata in app/layout.jsx)

rmSync(work, { recursive: true, force: true });
console.log('icons written: app/{icon.svg,favicon.ico,apple-icon.png}, public/{logo.svg,og-image.png,safari-pinned-tab.svg,icons/*}');
