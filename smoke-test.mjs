/**
 * smoke-test.mjs — automated browser test for Chess Club.
 *
 * Run:  node smoke-test.mjs
 * Requires a local static server on http://localhost:8899 serving assets/.
 *
 * Checks:
 *   1. Page loads with no console errors / failed requests
 *   2. chess.js loads, board renders 64 squares, 32 pieces
 *   3. Each difficulty tier is selectable and the engine loads
 *   4. A human move is accepted and the computer replies
 *   5. The coach produces at least one explanation bubble
 *   6. Hint highlights squares
 *   7. Undo works
 *   8. Layout: squares are >= 48px at iPad and phone widths
 *   9. Animations default OFF
 */

import puppeteer from 'puppeteer';

const URL = process.env.TEST_URL || 'http://localhost:8899/index.html';
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? '  -> ' + detail : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000
});

const page = await browser.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));

await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

console.log(`\n== Loading ${URL} ==\n`);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

/* ---------------------------------------------------------------- 1. basics */
const sqCount = await page.$$eval('.square', (els) => els.length);
check('board renders 64 squares', sqCount === 64, `count=${sqCount}`);

const pieceCount = await page.$$eval('.square .piece', (els) => els.length);
check('32 pieces on the board', pieceCount === 32, `count=${pieceCount}`);

/* Every piece is drawn in two layers: a silhouette (.piece-body) plus internal
   detail lines (.piece-detail). Without the detail layer a black piece
   (black fill + black stroke) would render as a featureless blob, so guard it. */
const pieceLayers = await page.evaluate(() => {
  const at = (sq) => document.querySelector(`.square[data-square="${sq}"] .piece`);
  const w = at('e1');   // white king
  const b = at('e8');   // black king
  return {
    whiteBody: !!w && w.querySelectorAll('.piece-body').length > 0,
    blackBody: !!b && b.querySelectorAll('.piece-body').length > 0,
    blackDetail: !!b && b.querySelectorAll('.piece-detail').length > 0
  };
});
check('pieces render a silhouette layer', pieceLayers.whiteBody && pieceLayers.blackBody);
check('black pieces keep detail lines (not solid blobs)', pieceLayers.blackDetail);

const hasChessJs = await page.evaluate(() => !!window.__chessClub?.state?.Chess);
check('chess.js loaded', hasChessJs);

const startFen = await page.evaluate(() => window.__chessClub.state.chess.fen());
check('starting position correct', startFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'), startFen);

/* --------------------------------------------------- 2. animations default */
const animOff = await page.evaluate(() => !document.body.classList.contains('animations-enabled'));
check('animations default OFF (e-ink friendly)', animOff);

const animVar = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--anim-speed').trim());
check('animation duration var is 0ms', animVar === '0ms', `--anim-speed=${animVar}`);

/* -------------------------------------------------------- 3. engine status */
// Wait for the engine to report ready (or fall back to the pocket bot).
await page.waitForFunction(
  () => {
    const t = document.querySelector('#status-text')?.textContent || '';
    return /ready|Pocket Bot|failed/i.test(t);
  },
  { timeout: 45000 }
).catch(() => {});

const engineKind = await page.evaluate(() => window.__chessClub.state.engine.kind);
check('engine initialised', ['wasm', 'asm', 'pocket'].includes(engineKind), `kind=${engineKind}`);
check('engine is native stockfish', engineKind === 'wasm' || engineKind === 'asm', `kind=${engineKind}`);

/* --------------------------------------------------------- 4. coach bubble */
const coachBubbles = await page.$$eval('#coach-feed .bubble', (els) => els.length);
check('coach shows welcome message', coachBubbles >= 1, `bubbles=${coachBubbles}`);

/* ------------------------------------------------- 5. play a human move: e2e4 */
async function clickSquare(name) {
  const sel = `.square[data-square="${name}"]`;
  await page.waitForSelector(sel, { timeout: 5000 });
  // A lingering dialog would intercept the click, so close it first.
  await closeModals();
  await page.click(sel);
}

/** Result/promotion dialogs are modal; dismiss them before other clicks. */
async function closeModals() {
  const wasOpen = await page.evaluate(() => {
    let any = false;
    for (const id of ['#result-dialog', '#promotion-dialog']) {
      const m = document.querySelector(id);
      if (m && !m.hidden) { m.hidden = true; any = true; }
    }
    return any;
  });
  if (wasOpen) await new Promise((r) => setTimeout(r, 150));
  return wasOpen;
}

async function clickButton(sel) {
  await closeModals();
  await page.click(sel);
}

await clickSquare('e2');
const legalHighlights = await page.$$eval('.square.legal', (els) => els.length);
check('selecting a pawn shows legal moves', legalHighlights === 2, `legal=${legalHighlights}`);

await clickSquare('e4');
await new Promise((r) => setTimeout(r, 400));

const afterHumanFen = await page.evaluate(() => window.__chessClub.state.chess.fen());
check('e2e4 accepted', afterHumanFen.includes('4P3'), afterHumanFen.split(' ')[0]);

// The last-move highlight must track the most recent move. (The engine can
// already have replied by now, so we compare against state.lastMove rather
// than assuming the human's move is still the latest.)
await page.waitForFunction(
  () => {
    const s = window.__chessClub.state;
    if (!s.lastMove) return false;
    const onBoard = [...document.querySelectorAll('.square.last-move')].map((e) => e.dataset.square);
    return onBoard.length === 2;
  },
  { timeout: 30000 }
).catch(() => {});
const lastMoveAfter = await page.evaluate(() => {
  const s = window.__chessClub.state;
  const h = document.querySelectorAll('.square.last-move');
  return {
    squares: [...h].map((e) => e.dataset.square).sort(),
    expect: s.lastMove ? [s.lastMove.from, s.lastMove.to].sort() : []
  };
});
check('last-move highlight follows newest move',
  JSON.stringify(lastMoveAfter.squares) === JSON.stringify(lastMoveAfter.expect),
  `board=${lastMoveAfter.squares} expected=${lastMoveAfter.expect}`);

// The coach must produce a verdict for the human move quickly.
await page.waitForFunction(
  () => document.querySelectorAll('#coach-feed .bubble').length >= 2,
  { timeout: 20000 }
).catch(() => {});
const verdict = await page.$$eval('#coach-feed .bubble', (els) =>
  els.map((e) => e.className).join(' '));
check('coach verdict arrives promptly', /tier-/.test(verdict), verdict.slice(0, 120));

/* ------------------------------------------- 6. computer replies automatically */
await page.waitForFunction(
  () => window.__chessClub.state.history.some((h) => h.color === 'b'),
  { timeout: 30000 }
).catch(() => {});

const histAfterReply = await page.evaluate(() =>
  window.__chessClub.state.history.map((h) => h.color + ':' + h.san));
check('computer replied as Black', histAfterReply.some((h) => h.startsWith('b:')),
  histAfterReply.join(' '));

/* ------------------------------------------------------- 7. coach explained */
await page.waitForFunction(
  () => document.querySelectorAll('#coach-feed .bubble').length >= 3,
  { timeout: 30000 }
).catch(() => {});

const bubbles = await page.$$eval('#coach-feed .bubble', (els) =>
  els.map((e) => ({ cls: e.className, text: e.textContent.trim() })));
check('coach explained the move', bubbles.length >= 3, `${bubbles.length} bubbles`);

const tiered = bubbles.some((b) => /tier-(brilliant|good|inaccuracy|mistake|blunder)/.test(b.cls));
check('coach produced a tiered verdict', tiered);

const readable = bubbles.some((b) => b.text.length > 30);
check('coach text is a real sentence', readable,
  bubbles.map((b) => b.text.slice(0, 40)).join(' | ').slice(0, 160));

/* ------------------------------------------------------------ 8. eval meter */
const evalLabel = await page.$eval('#eval-label', (e) => e.textContent);
check('eval meter has a label', evalLabel.length > 3, evalLabel);

/* --------------------------------------------------------------- 9. hint */
await clickButton('#btn-hint');
await page.waitForFunction(
  () => window.__chessClub.state.hint !== null,
  { timeout: 30000 }
).catch(() => {});
const hintTxt = await page.$eval('#coach-feed', (e) => e.textContent);
check('hint gives advice', /Hint/i.test(hintTxt));
const hintSquares = await page.evaluate(() =>
  [...document.querySelectorAll('.square.hint-from, .square.hint-to')].map((e) => e.dataset.square));
check('hint highlights squares on the board', hintSquares.length >= 1, hintSquares.join(','));

/* --------------------------------------------------------------- 10. undo */
const before = await page.evaluate(() => window.__chessClub.state.history.length);
await clickButton('#btn-undo');
await new Promise((r) => setTimeout(r, 1500));
const after = await page.evaluate(() => window.__chessClub.state.history.length);
check('undo removes moves', after < before, `${before} -> ${after}`);

/* --------------------------------------------- 11. difficulty + mode select */
for (const diff of ['casual', 'challenger', 'beginner']) {
  await page.evaluate((d) => {
    const el = document.querySelector(`input[name="difficulty"][value="${d}"]`);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, diff);
  await new Promise((r) => setTimeout(r, 120));
  const cur = await page.evaluate(() => window.__chessClub.state.difficulty);
  check(`difficulty switch -> ${diff}`, cur === diff, cur);
}

await page.evaluate(() => {
  const el = document.querySelector('input[name="mode"][value="human"]');
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
const mode = await page.evaluate(() => window.__chessClub.state.mode);
check('2-player mode selectable', mode === 'human', mode);
const diffHidden = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#difficulty-group')).display);
check('difficulty hidden in 2-player mode', diffHidden === 'none', diffHidden);

/* Back to computer mode */
await page.evaluate(() => {
  const el = document.querySelector('input[name="mode"][value="computer"]');
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));

/* --------------------------------------------------------- 12. new game */
await clickButton('#btn-new');
await new Promise((r) => setTimeout(r, 300));
const freshFen = await page.evaluate(() => window.__chessClub.state.chess.fen());
check('new game resets position', freshFen.startsWith('rnbqkbnr'), freshFen.split(' ')[0]);

/* --------------------------------------------------- 13. touch target size */
async function measureSquares(width, height, label) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 450));
  const box = await page.$eval('.square', (e) => {
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check(`squares >= 48px @ ${label} (${width}x${height})`,
    box.w >= 48 && box.h >= 48, `${box.w.toFixed(1)}x${box.h.toFixed(1)}`);
}

await measureSquares(820, 1180, 'iPad portrait');
await measureSquares(1180, 820, 'iPad landscape');
await measureSquares(390, 844, 'iPhone portrait');

/* ------------------------------------------------------- 14. responsive */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 400));
const coachVisible = await page.evaluate(() => {
  const el = document.querySelector('.coach-card');
  const r = el.getBoundingClientRect();
  return r.width > 100 && r.height > 40;
});
check('coach panel visible on phone', coachVisible);

const noHScroll = await page.evaluate(() =>
  document.documentElement.scrollWidth <= window.innerWidth + 2);
check('no horizontal overflow on phone', noHScroll);

// The board may scroll horizontally on very narrow screens, but only inside
// its own container — the page itself must stay put.
const contained = await page.evaluate(() => {
  const wrap = document.querySelector('.board-wrap');
  return getComputedStyle(wrap).overflowX === 'auto';
});
check('board overflow is contained in its own scroller', contained);

/* ------------------------------------------------------------ 15. console */
const realErrors = consoleErrors.filter((e) =>
  !/favicon|Failed to load resource.*favicon/i.test(e));
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

const realFailed = failedRequests.filter((u) => !/favicon/i.test(u));
check('no failed network requests', realFailed.length === 0, realFailed.slice(0, 3).join(' | '));

/* --------------------------------------------------------------- summary */
console.log('\n========================================');
console.log(`  ${results.length - failures}/${results.length} checks passed`);
console.log('========================================\n');

if (consoleErrors.length) {
  console.log('Console errors:\n' + consoleErrors.slice(0, 10).map((e) => '  - ' + e).join('\n') + '\n');
}

await browser.close();
process.exit(failures ? 1 : 0);
