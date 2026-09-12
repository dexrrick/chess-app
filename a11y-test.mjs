/**
 * a11y-test.mjs — accessibility checks for the board, the evaluation meter, the
 * dialogs and the skip link.
 *
 * These are behavioural: they read Chrome's real accessibility tree and drive
 * real keyboard events, rather than inspecting the source. Requires a server
 * (the runner provides one via TEST_URL).
 */

import puppeteer from 'puppeteer';

const URL = process.env.TEST_URL || 'http://localhost:8899/index.html';
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll('.square').length === 64, { timeout: 30000 });

const client = await page.createCDPSession();
await client.send('Accessibility.enable');

const roleOf = (node) => node?.role?.value;
const nameOf = (node) => node?.name?.value;

/** The current accessibility tree, as a navigable node list. */
async function axTree() {
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const children = (node) => (node?.childIds || [])
    .map((id) => byId.get(id))
    .filter((n) => n && !n.ignored);
  return { nodes: nodes.filter((n) => !n.ignored), byId, children };
}

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/* ============================== 1. board grid ============================= */
{
  const { nodes, children } = await axTree();
  const grid = nodes.find((n) => roleOf(n) === 'grid');

  check('the board is exposed as a grid', !!grid, roleOf(grid));
  check('the grid is named "Chess board"', nameOf(grid) === 'Chess board', nameOf(grid));

  const rows = children(grid).filter((n) => roleOf(n) === 'row');
  check('the grid owns 8 rows (not bare gridcells)', rows.length === 8, `rows=${rows.length}`);

  const perRow = rows.map((r) => children(r).filter((n) => roleOf(n) === 'gridcell').length);
  check('every row owns exactly 8 gridcells', perRow.every((c) => c === 8), perRow.join(','));

  const names = rows.flatMap((r) => children(r)
    .filter((n) => roleOf(n) === 'gridcell')
    .map(nameOf));
  check('all 64 gridcells are named',
    names.length === 64 && names.every((n) => typeof n === 'string' && n.length >= 2),
    `${names.length} names`);

  const expected = [];
  for (const rank of ['8', '7', '6', '5', '4', '3', '2', '1']) {
    for (const file of 'abcdefgh') expected.push(file + rank);
  }
  // A cell's name is its full description ("Black rook, a8"), so pull the square
  // coordinate out of it and check the cells are in visual order.
  const squareOf = (name) => (String(name).match(/\b[a-h][1-8]\b/) || [])[0];
  check('the gridcells are the 64 squares, in visual order',
    names.map(squareOf).join(',') === expected.join(','),
    `${names.map(squareOf).slice(0, 4).join(',')} … ${names.map(squareOf).slice(-4).join(',')}`);
}

/* ============================ 2. evaluation meter ========================= */
{
  const { nodes } = await axTree();
  const names = nodes.map(nameOf).filter(Boolean);

  check('the evaluation is no longer aria-hidden',
    (await page.$eval('.eval-meter', (e) => e.getAttribute('aria-hidden'))) === null);
  check('the evaluation is exposed as a named group',
    names.includes('Position evaluation'),
    names.filter((n) => /evalu/i.test(n)).join(' | ') || 'not found');

  const label = await page.$eval('#eval-label', (e) => e.textContent.trim());
  check('the evaluation text itself reaches assistive tech',
    names.some((n) => n.includes(label)), `"${label}"`);

  check('the decorative bar alone stays hidden',
    (await page.$eval('.eval-track', (e) => e.getAttribute('aria-hidden'))) === 'true');
}

/* ================================ 3. dialogs ============================== */
/*
 * A modal has to trap Tab, close on Escape, take the rest of the page out of
 * play, and hand focus back when it closes.
 */
{
  // Put a pawn one step from promotion so the promotion dialog can be opened.
  await page.evaluate(() => {
    const s = window.__chessClub.state;
    s.mode = 'human';
    s.chess.load('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    s.lastMove = null;
    s.selected = null;
    s.legalTargets = [];
  });
  await page.click('.square[data-square="a7"]');
  await settle(150);
  await page.click('.square[data-square="a8"]');
  await settle(300);

  const read = () => page.evaluate(() => ({
    open: !document.querySelector('#promotion-dialog').hidden,
    resultOpen: !document.querySelector('#result-dialog').hidden,
    inert: document.querySelector('main').hasAttribute('inert'),
    // A board square reports its coordinate; dialog controls report their id or
    // accessible name.
    active: document.activeElement?.dataset?.square
      || document.activeElement?.id
      || document.activeElement?.getAttribute?.('aria-label')
      || document.activeElement?.tagName
  }));

  let st = await read();
  check('the promotion dialog opens', st.open);
  check('the background is inert while a dialog is open', st.inert, String(st.inert));
  check('focus moves into the dialog', /Promote to/.test(st.active || ''), String(st.active));

  // Tab from the last control must wrap to the first, not escape the dialog.
  await page.evaluate(() => {
    const dialog = document.querySelector('#promotion-dialog');
    const buttons = [...dialog.querySelectorAll('button')];
    buttons[buttons.length - 1].focus();
  });
  await page.keyboard.press('Tab');
  st = await read();
  check('Tab stays inside the dialog', /Promote to/.test(st.active || ''), String(st.active));
  check('Tab wraps from the last control to the first',
    /Promote to queen/.test(st.active || ''), String(st.active));

  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  st = await read();
  check('Shift+Tab wraps back to the last control', st.active === 'promo-cancel',
    String(st.active));

  await page.keyboard.press('Escape');
  await settle(150);
  st = await read();
  check('Escape closes the promotion dialog', !st.open);
  check('the background is interactive again', !st.inert, String(st.inert));
  check('focus returns to the board', /^[a-h][1-8]$/.test(st.active || ''), String(st.active));

  /* -- the result dialog behaves the same way -- */
  await page.click('#btn-resign');
  await settle(250);
  st = await read();
  check('the result dialog opens', st.resultOpen);
  check('the background is inert for the result dialog too', st.inert, String(st.inert));
  check('focus lands on the primary action', st.active === 'result-again', String(st.active));

  await page.keyboard.press('Escape');
  await settle(150);
  st = await read();
  check('Escape closes the result dialog', !st.resultOpen);
  check('closing it does not un-end the game',
    await page.evaluate(() => window.__chessClub.state.gameOver));
  check('the background is interactive again', !st.inert, String(st.inert));
  check('focus returns to the board', /^[a-h][1-8]$/.test(st.active || ''), String(st.active));
}

/* ============================== 4. skip link ============================== */
{
  const href = await page.$eval('.skip-link', (e) => e.getAttribute('href'));
  check('the skip link targets the board itself, not a plain section',
    href === '#board', String(href));

  await page.focus('.skip-link');
  await page.keyboard.press('Enter');
  await settle(250);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    active: document.activeElement?.id
      || document.activeElement?.getAttribute?.('aria-label')
      || document.activeElement?.tagName
  }));
  check('activating the skip link moves focus to the board',
    after.active === 'board', `hash=${after.hash} active=${after.active}`);
}

/* =========================== 5. keyboard still works ====================== */
{
  await page.evaluate(() => window.__chessClub.state.cursor = 'e2');
  await page.evaluate(() => {
    const el = document.querySelector('.square[data-square="e2"]');
    if (el) el.focus();
  });
  await page.keyboard.press('ArrowRight');
  await settle(100);
  const cursor = await page.evaluate(() => window.__chessClub.state.cursor);
  check('the board is still operable from the keyboard', cursor === 'f2', String(cursor));
}

/* ========================= 6. forced-colours support ====================== */
{
  // Puppeteer's emulateMediaFeatures() whitelist has no forced-colors, so drive
  // the emulation through CDP directly.
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }]
  });
  await settle(150);

  const adjust = await page.$eval('.board-frame', (e) => getComputedStyle(e).forcedColorAdjust);
  check('the board opts out of forced-colour recolouring', adjust === 'none', String(adjust));

  const squares = await page.evaluate(() => ({
    light: getComputedStyle(document.querySelector('.square:not(.dark)')).backgroundColor,
    dark: getComputedStyle(document.querySelector('.square.dark')).backgroundColor
  }));
  check('light and dark squares stay distinguishable',
    squares.light !== squares.dark, `${squares.light} vs ${squares.dark}`);

  await client.send('Emulation.setEmulatedMedia', { features: [] });
}

/* ============================ 6. flipping the board ======================= */
{
  // The rows are real structural elements, so a flip has to re-order the DOM —
  // reordering visually with CSS alone would leave the accessibility tree
  // describing a different board from the one on screen.
  const readBoard = async () => {
    const { nodes, children } = await axTree();
    const grid = nodes.find((n) => roleOf(n) === 'grid');
    const rows = children(grid).filter((n) => roleOf(n) === 'row');
    const cellsIn = (row) => children(row).filter((n) => roleOf(n) === 'gridcell');
    const squareOf = (name) => (String(name).match(/\b[a-h][1-8]\b/) || [])[0];
    return {
      rows,
      squares: rows.flatMap((row) => cellsIn(row).map(nameOf)).map(squareOf),
      perRow: rows.map((row) => cellsIn(row).length)
    };
  };

  await page.click('#btn-flip');
  await settle(250);
  let state = await readBoard();
  check('after a flip the structure starts from h1 (black at home)',
    state.squares.slice(0, 8).join(',') === 'h1,g1,f1,e1,d1,c1,b1,a1',
    state.squares.slice(0, 8).join(','));
  check('a flip keeps 8 rows of 8 gridcells',
    state.rows.length === 8 && state.perRow.every((c) => c === 8), state.perRow.join(','));

  // Re-appending the squares must not drop focus, or a flip would silently end
  // keyboard play (the board only handles keys while focus is on a square).
  // Flipping programmatically mirrors what auto-flip does, since a real button
  // click would move focus to the button instead.
  await page.evaluate(() => document.querySelector('.square[data-square="e2"]').focus());
  await page.evaluate(() => document.getElementById('btn-flip').click());
  await settle(250);
  const stillFocused = await page.evaluate(() => document.activeElement?.dataset?.square
    || document.activeElement?.id);
  check('focus survives a flip', stillFocused === 'e2', String(stillFocused));

  // That second flip returns the board to its original orientation.
  state = await readBoard();
  check('flipping back restores the original orientation',
    state.squares.slice(0, 8).join(',') === 'a8,b8,c8,d8,e8,f8,g8,h8',
    state.squares.slice(0, 8).join(','));
  check('flipping lists all 64 squares exactly once',
    new Set(state.squares).size === 64, `${new Set(state.squares).size} unique`);
  check('the flip state matches the structure',
    (await page.evaluate(() => window.__chessClub.state.flipped)) === false);
}

/* ========================= 2b. decorative overlay ======================== */
{
  const arrowHidden = await page.$eval('#move-arrow', (e) => e.getAttribute('aria-hidden'));
  check('the last-move arrow is hidden from assistive tech',
    arrowHidden === 'true', String(arrowHidden));

  // Decoration must not add nodes: nothing in the tree should be a bare graphic.
  const { nodes } = await axTree();
  const graphics = nodes.filter((n) =>
    ['img', 'graphics-document', 'graphics-symbol'].includes(roleOf(n)));
  check('no decorative graphics leak into the accessibility tree',
    graphics.length === 0, graphics.map(roleOf).join(',') || 'none');
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL A11Y TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
await browser.close();
process.exit(failures ? 1 : 0);
