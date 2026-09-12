/**
 * preview/measure-latency.mjs — where does the time between a human move and
 * the computer's reply actually go?
 *
 *   node preview/measure-latency.mjs [beginner|casual|challenger]
 *
 * DEV-ONLY diagnostics. Instruments the real app in a headless browser:
 *  - wraps Engine.evaluate / bestMove / rankedMoves to time each engine call
 *  - watches the DOM for the coach bubble, the eval meter and the move list
 *  - prints a timeline of everything, in order, with millisecond offsets
 *
 * Used to justify (and later confirm) the P1-6 latency work. Nothing here ships.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PREVIEW_PORT || 8942);
const DIFFICULTY = process.argv[2] || 'beginner';

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
  if (/_?headers$/i.test(path.basename(candidate))) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  if (!file) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const url = `http://127.0.0.1:${PORT}/assets/index.html`;
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 120000
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__chessClub?.state?.engine?.kind !== 'none',
    { timeout: 45000 });
  await page.waitForFunction(
    () => /ready|Pocket/i.test(document.querySelector('#status-text')?.textContent || ''),
    { timeout: 45000 }).catch(() => {});

  await page.evaluate((difficulty) => {
    const s = window.__chessClub.state;
    const diff = document.querySelector(`input[name="difficulty"][value="${difficulty}"]`);
    if (diff) { diff.checked = true; diff.dispatchEvent(new Event('change', { bubbles: true })); }

    const t0 = performance.now();
    const tl = [];
    const now = () => Math.round(performance.now() - t0);
    const log = (ev, extra = '') => tl.push(`${String(now()).padStart(6)}ms  ${ev}${extra ? '  ' + extra : ''}`);
    window.__tl = tl;
    window.__t0 = t0;
    log('instrumented', `engine=${s.engine.kind}`);

    // --- time every engine call ---
    for (const name of ['evaluate', 'bestMove', 'rankedMoves']) {
      const orig = s.engine[name].bind(s.engine);
      s.engine[name] = async (...args) => {
        const started = now();
        log(`ENGINE ${name} START`);
        const result = await orig(...args);
        const dur = now() - started;
        log(`ENGINE ${name} END`, `(${dur}ms)`);
        return result;
      };
    }

    // --- watch the DOM ---
    let bubbles = document.querySelectorAll('#coach-feed .bubble').length;
    let moves = s.history.length;
    let busy = s.busy;
    let evalLabel = document.querySelector('#eval-label')?.textContent || '';
    const tick = () => {
      const b = document.querySelectorAll('#coach-feed .bubble').length;
      const m = s.history.length;
      const lbl = document.querySelector('#eval-label')?.textContent || '';
      if (b !== bubbles) { bubbles = b; log('coach bubble added', `total=${b}`); }
      if (m !== moves) { moves = m; log('board move applied', `history=${m} ${s.chess.fen().split(' ')[0]}`); }
      if (s.busy !== busy) { busy = s.busy; log(s.busy ? 'busy ON' : 'busy OFF'); }
      if (lbl !== evalLabel) { evalLabel = lbl; log('eval meter updated', lbl); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, DIFFICULTY);

  // Play e2-e4 as the human.
  await page.click('.square[data-square="e2"]');
  await new Promise((r) => setTimeout(r, 120));
  await page.click('.square[data-square="e4"]');

  await new Promise((r) => setTimeout(r, 6000));

  // Then a second human move: this is the steady state, where the "before"
  // evaluation is already cached and the coach needs only one search.
  await page.evaluate(() => window.__tl.push('        --  second human move  --'));
  await page.click('.square[data-square="g1"]');
  await new Promise((r) => setTimeout(r, 120));
  await page.click('.square[data-square="f3"]');

  await new Promise((r) => setTimeout(r, 9000));

  const { timeline, kind, difficulty } = await page.evaluate(() => ({
    timeline: window.__tl,
    kind: window.__chessClub.state.engine.kind,
    difficulty: window.__chessClub.state.difficulty
  }));

  console.log(`\n=== human move → computer reply (${difficulty}, engine=${kind}) ===\n`);
  const base = await page.evaluate(() => window.__t0);
  void base;
  for (const line of timeline) console.log('  ' + line);
  console.log('');
} finally {
  await browser.close();
  server.close();
}
