/**
 * preview/render-preview.mjs — serve the repo and screenshot the piece preview.
 *
 *   node preview/render-preview.mjs
 *
 * Starts a tiny static server rooted at the repository (so both /preview/... and
 * /assets/... resolve — the app's own scripts/serve.mjs only serves assets/),
 * renders preview/pieces-preview.html in the same Puppeteer/Chromium the test
 * suite already uses, and writes PNGs into preview/out/.
 *
 * DEV-ONLY: nothing here is uploaded by `wrangler deploy` because it lives
 * outside the assets/ directory.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = Number(process.env.PREVIEW_PORT || 8940);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/** Resolve a URL path to a file inside ROOT, refusing to escape it. */
function resolveFile(urlPath) {
  const [raw] = urlPath.split('?');
  let pathname;
  try {
    pathname = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const candidate = path.resolve(ROOT, '.' + pathname);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
});

fs.mkdirSync(OUT, { recursive: true });

const url = `http://127.0.0.1:${PORT}/preview/pieces-preview.html`;
console.log(`\n  Serving ${ROOT}\n  Preview : ${url}\n`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 120000
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
  });

  await page.setViewport({ width: 1180, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

  /** @type {Array<[string, string]>} [fileSuffix, selector] */
  const shots = [
    ['compare', null],
    ['variant-current', '#variant-current'],
    ['variant-A', '#variant-A'],
    ['variant-B', '#variant-B'],
    ['eink', '#eink']
  ];

  for (const [name, selector] of shots) {
    const target = selector ? await page.$(selector) : page;
    if (!target) {
      console.warn(`  (skipped ${name}: selector ${selector} not found)`);
      continue;
    }
    const file = path.join(OUT, `${name}.png`);
    await target.screenshot({ path: file, fullPage: !selector });
    console.log(`  saved preview/out/${name}.png`);
  }

  if (pageErrors.length) {
    console.warn('\n  Page reported errors:');
    for (const e of pageErrors.slice(0, 10)) console.warn(`    - ${e}`);
  } else {
    console.log('\n  No console or page errors.');
  }
} finally {
  await browser.close();
  server.close();
}

console.log('');
