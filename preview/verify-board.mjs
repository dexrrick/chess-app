/**
 * preview/verify-board.mjs — check the REAL app's board rendering.
 *
 *   node preview/verify-board.mjs
 *
 * Loads assets/index.html, asserts that the two-layer piece markup is present
 * AND that the stylesheet actually colours it (a black piece must get white
 * detail strokes), then writes a screenshot of the board to preview/out/.
 *
 * This exists because the full browser suites take minutes; this is a fast,
 * targeted check of the thing the piece change touches.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = Number(process.env.PREVIEW_PORT || 8941);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function resolveFile(urlPath) {
  const [raw] = urlPath.split('?');
  let pathname;
  try { pathname = decodeURIComponent(raw); } catch { return null; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const candidate = path.resolve(ROOT, '.' + pathname);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
});

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

// Default: the checked-in static server. Set VERIFY_URL to point at something
// else — e.g. `wrangler dev` — to check the app under the REAL edge headers
// (CSP included), which the plain static server does not send.
const url = process.env.VERIFY_URL
  || `http://127.0.0.1:${PORT}/assets/index.html`;
console.log(`  Verifying ${url}`);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 120000
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The board renders before the engine finishes loading, so this stays quick.
  await page.waitForFunction(
    () => document.querySelectorAll('.square .piece').length === 32,
    { timeout: 30000 }
  );

  const data = await page.evaluate(() => {
    const style = (el) => {
      const cs = getComputedStyle(el);
      return { fill: cs.fill, stroke: cs.stroke, strokeWidth: cs.strokeWidth };
    };
    const svgOf = (sq) => document.querySelector(`.square[data-square="${sq}"] .piece`);
    const bKing = svgOf('e8');   // black king
    const wKing = svgOf('e1');   // white king
    const bKnight = svgOf('b8'); // black knight
    return {
      squares: document.querySelectorAll('.square').length,
      pieces: document.querySelectorAll('.square .piece').length,
      bodyTags: document.querySelectorAll('.square .piece .piece-body').length,
      detailTags: document.querySelectorAll('.square .piece .piece-detail').length,
      piecesMissingALayer: [...document.querySelectorAll('.square .piece')]
        .filter((svg) => !svg.querySelector('.piece-body') || !svg.querySelector('.piece-detail')).length,
      piecesOutsideBoard: document.querySelectorAll('.piece:not(.square .piece)').length,
      blackBody: style(bKing.querySelector('.piece-body')),
      blackDetail: style(bKing.querySelector('.piece-detail')),
      whiteBody: style(wKing.querySelector('.piece-body')),
      whiteDetail: style(wKing.querySelector('.piece-detail')),
      knightDetailCount: bKnight.querySelectorAll('.piece-detail').length
    };
  });

  check('64 squares rendered', data.squares === 64, `count=${data.squares}`);
  check('32 pieces rendered', data.pieces === 32, `count=${data.pieces}`);
  check('every board piece has both layers',
    data.piecesMissingALayer === 0, `missing=${data.piecesMissingALayer}`);
  check('board pieces expose silhouette + detail paths',
    data.bodyTags >= 32 && data.detailTags >= 32,
    `bodies=${data.bodyTags} details=${data.detailTags}`);
  check('no stray pieces off the board', data.piecesOutsideBoard === 0,
    `outside=${data.piecesOutsideBoard}`);
  check('black piece body is black-filled',
    data.blackBody.fill === 'rgb(0, 0, 0)', data.blackBody.fill);
  check('black piece DETAIL is stroked white (visible on black)',
    data.blackDetail.stroke === 'rgb(255, 255, 255)', data.blackDetail.stroke);
  check('white piece body is white-filled',
    data.whiteBody.fill === 'rgb(255, 255, 255)', data.whiteBody.fill);
  check('white piece DETAIL is stroked black (visible on white)',
    data.whiteDetail.stroke === 'rgb(0, 0, 0)', data.whiteDetail.stroke);
  check('black knight carries its detail lines', data.knightDetailCount > 0,
    `count=${data.knightDetailCount}`);

  // The favicon is a real file now (assets/favicon.svg), not an inline data URI.
  const icon = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return { href: null, status: 0, type: '' };
    const res = await fetch(link.href);
    return {
      href: link.getAttribute('href'),
      status: res.status,
      type: res.headers.get('content-type') || ''
    };
  });
  check('favicon is a real SVG file', icon.status === 200 && /svg/.test(icon.type),
    `${icon.href} -> ${icon.status} ${icon.type}`);

  // Captured pieces live in the player bar, OUTSIDE .square, so the square
  // sizing rule never applied to them. Measure one to make sure it is not
  // falling back to the UA default replaced-element size.
  const captureSize = await page.evaluate(() => {
    const span = document.querySelector('#player-bottom-captures');
    span.innerHTML = '<svg class="piece piece-b" viewBox="0 0 45 45">'
      + '<path class="piece-body" d="M11.9 36.4h21.2a0.9 0.9 0 0 1 .9.9v1.8a0.9 0.9 0 0 1-.9.9H11.9a0.9 0.9 0 0 1-.9-.9v-1.8a0.9 0.9 0 0 1 .9-.9z"/></svg>';
    const r = span.querySelector('svg').getBoundingClientRect();
    const out = { w: Math.round(r.width), h: Math.round(r.height) };
    span.innerHTML = '';
    return out;
  });
  check('captured pieces are sized sanely in the player bar',
    captureSize.w > 0 && captureSize.w <= 48 && captureSize.h <= 48,
    `${captureSize.w}x${captureSize.h}`);

  fs.mkdirSync(OUT, { recursive: true });
  const frame = await page.$('.board-frame');
  await frame.screenshot({ path: path.join(OUT, 'app-board.png') });
  console.log('  saved preview/out/app-board.png');

  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  check('no page/console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\n  BOARD VERIFICATION PASSED\n' : `\n  ${failures} CHECK(S) FAILED\n`);
process.exit(failures ? 1 : 0);
