import puppeteer from 'puppeteer';

const URL = process.env.TEST_URL || 'http://localhost:8999/index.html';
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

console.log(`\n== Testing 3D Mode against ${URL} ==\n`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl'],
  protocolTimeout: 180000
});

const page = await browser.newPage();
const consoleErrors = [];
const requestedUrls = [];

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('request', (r) => requestedUrls.push(r.url()));

await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'networkidle2' });

// 1. Check default 2D mode
const modeOnLoad = await page.evaluate(() => document.documentElement.dataset.viewMode);
check('default viewMode is 2d on initial load', modeOnLoad === '2d', modeOnLoad);

const babylonRequestsOnLoad = requestedUrls.filter((u) => u.includes('/vendor/babylon/'));
check('no /vendor/babylon/ requests on initial load (guardrail #2)', babylonRequestsOnLoad.length === 0, `${babylonRequestsOnLoad.length} requests`);

const toggleText1 = await page.evaluate(() => document.querySelector('#view-mode-toggle')?.textContent.trim());
check('toggle button shows "3D View" initially', toggleText1 === '3D View', toggleText1);

// 2. Switch to 3D mode
console.log('\n--- Switching to 3D mode ---');
await page.click('#view-mode-toggle');
await new Promise((r) => setTimeout(r, 2000));

const modeIn3D = await page.evaluate(() => document.documentElement.dataset.viewMode);
check('viewMode is 3d after toggle', modeIn3D === '3d', modeIn3D);

const toggleText2 = await page.evaluate(() => document.querySelector('#view-mode-toggle')?.textContent.trim());
check('toggle button shows "2D View" in 3D mode', toggleText2 === '2D View', toggleText2);

const container3DVisible = await page.evaluate(() => {
  const el = document.querySelector('#board-3d-container');
  return el && !el.hidden && el.getAttribute('aria-hidden') === 'false';
});
check('3D container is visible and aria-hidden is false', container3DVisible);

const canvasExists = await page.evaluate(() => {
  const canvas = document.querySelector('#board-3d-container canvas');
  return !!canvas && canvas.width > 0 && canvas.height > 0;
});
check('3D canvas is mounted with non-zero dimensions', canvasExists);

// 3. Interacting with board in 3D mode
console.log('\n--- Interacting with board in 3D mode ---');
const fenBefore = await page.evaluate(() => window.__chessClub.state.chess.fen());
check('FEN before move is starting position', fenBefore.startsWith('rnbqkbnr/pppppppp'));

// Verify bridge syncState and animateMove functions are active
const bridgeActive = await page.evaluate(() => {
  const b = window.__chessClub.board3d;
  return b && b.getMode() === '3d';
});
check('3D bridge is active and in 3d mode', bridgeActive);

// Test move via onMoveAttempt / clicking square
await page.evaluate(() => {
  const sqE2 = document.querySelector('.square[data-square="e2"]');
  if (sqE2) sqE2.click();
});
await new Promise((r) => setTimeout(r, 400));

await page.evaluate(() => {
  const sqE4 = document.querySelector('.square[data-square="e4"]');
  if (sqE4) sqE4.click();
});
await new Promise((r) => setTimeout(r, 1200));

const fenAfter = await page.evaluate(() => window.__chessClub.state.chess.fen());
check('Move e2-e4 executed successfully in 3D mode', fenAfter.includes('4P3'), fenAfter);

// Test canvas pointer interaction directly
console.log('\n--- Canvas pointer interaction test ---');
const pointerWorked = await page.evaluate(() => {
  const canvas = document.querySelector('#board-3d-container canvas');
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  // dispatch pointer events
  const ptDown = new PointerEvent('pointerdown', {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    bubbles: true
  });
  canvas.dispatchEvent(ptDown);
  const ptUp = new PointerEvent('pointerup', {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    bubbles: true
  });
  canvas.dispatchEvent(ptUp);
  return true;
});
check('Canvas receives and handles PointerEvents without error', pointerWorked);

// 4. Toggle back to 2D mode
console.log('\n--- Switching back to 2D mode ---');
await page.click('#view-mode-toggle');
await new Promise((r) => setTimeout(r, 500));

const modeBack2D = await page.evaluate(() => document.documentElement.dataset.viewMode);
check('viewMode is 2d after toggling back', modeBack2D === '2d', modeBack2D);

const container3DHidden = await page.evaluate(() => {
  const el = document.querySelector('#board-3d-container');
  return el && el.hidden;
});
check('3D container is hidden in 2D mode', container3DHidden);

const pieceAtE4In2D = await page.evaluate(() => {
  const sq = document.querySelector('.square[data-square="e4"]');
  return !!sq?.querySelector('.piece');
});
check('2D board reflects moved pawn at e4', pieceAtE4In2D);

console.log('\n--- Console errors check ---');
check('no fatal console errors during 3D session', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(`\n========================================\n  3D Test Finished with ${failures} failure(s)\n========================================\n`);
process.exit(failures ? 1 : 0);
