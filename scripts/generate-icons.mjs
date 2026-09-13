/**
 * scripts/generate-icons.mjs — rasterises assets/favicon.svg into the PNG icons
 * the PWA needs:
 *
 *   - assets/apple-touch-icon.png   180x180  (iOS home screen)
 *   - assets/icon-192.png           192x192  (manifest)
 *   - assets/icon-512.png           512x512  (manifest)
 *
 * Run:  npm run icons
 *
 * The PNGs are committed, so this is only needed when the favicon artwork
 * changes. Requires the bundled Puppeteer (already a dev dependency) — no other
 * tooling is involved.
 */

import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'favicon.svg');
const OUT = path.join(ROOT, 'assets');

const SIZES = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512]
];

/** Pixel width/height straight out of the PNG IHDR chunk. */
function pngDimensions(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

if (!fs.existsSync(SRC)) {
  console.error(`  Could not find ${SRC}`);
  process.exit(1);
}

const svgSource = fs.readFileSync(SRC, 'utf8');
const browser = await puppeteer.launch({ headless: true });

try {
  for (const [name, size] of SIZES) {
    const body = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style>` +
      // Absolute width/height keep the SVG at exactly `size` px regardless of how
      // the browser would treat the missing width/height attributes.
      svgSource.replace('<svg', `<svg width="${size}" height="${size}"`);
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size });
    await page.setContent(body, { waitUntil: 'networkidle0' });

    const target = path.join(OUT, name);
    await page.screenshot({
      path: target,
      type: 'png',
      clip: { x: 0, y: 0, width: size, height: size },
      omitBackground: false
    });
    await page.close();

    const dims = pngDimensions(fs.readFileSync(target));
    if (dims.width !== size || dims.height !== size) {
      throw new Error(`${target} rendered at ${dims.width}x${dims.height}, wanted ${size}x${size}`);
    }
    console.log(`  ${name}  ${dims.width}x${dims.height}  (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
  }
} finally {
  await browser.close();
}