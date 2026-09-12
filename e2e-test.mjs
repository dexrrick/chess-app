/**
 * e2e-test.mjs — deeper scenario tests for Chess Club.
 *
 * Covers paths the smoke test does not:
 *   - playing a full game to checkmate (Scholar's mate) and the result dialog
 *   - pawn promotion and the promo picker
 *   - 2-player pass & play including auto-flip
 *   - the offline Pocket Bot fallback (CDN + vendor both blocked)
 *   - check/checkmate banner text
 *   - keyboard-only play
 *   - resign
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
  args: ['--no-sandbox'],
  protocolTimeout: 180000
});

async function newPage(opts = {}) {
  const pg = await browser.newPage();
  pg.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));
  if (opts.block) {
    await pg.setRequestInterception(true);
    pg.on('request', (req) => {
      if (opts.block.some((s) => req.url().includes(s))) req.abort();
      else req.continue();
    });
  }
  await pg.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });
  // Start every scenario from a clean slate. Preferences persist in
  // localStorage, which is the right behaviour for real users but would leak
  // state between test cases.
  await pg.evaluate(() => { try { localStorage.clear(); } catch {} });
  await pg.reload({ waitUntil: 'networkidle2' });
  return pg;
}

async function waitEngine(pg) {
  await pg.waitForFunction(
    () => /ready|Pocket Bot/i.test(document.querySelector('#status-text')?.textContent || ''),
    { timeout: 60000 }
  ).catch(() => {});
}

async function closeModals(pg) {
  const any = await pg.evaluate(() => {
    let a = false;
    for (const id of ['#result-dialog', '#promotion-dialog']) {
      const m = document.querySelector(id);
      if (m && !m.hidden) { m.hidden = true; a = true; }
    }
    return a;
  });
  if (any) await new Promise((r) => setTimeout(r, 100));
}

/** Play a sequence of moves by clicking, driving whichever side is to move. */
async function playMoves(pg, moves, { asWhite = true, delay = 300 } = {}) {
  for (const [from, to] of moves) {
    // Wait until it is the human's turn in 2-player, or the player colour in
    // vs-computer.
    await pg.waitForFunction(
      (f) => {
        const s = window.__chessClub.state;
        if (s.gameOver) return true;
        return s.chess.turn() === s.playerColor && s.chess.get(f)?.color === s.chess.turn();
      },
      { timeout: 25000 },
      from
    ).catch(() => {});
    await closeModals(pg);
    await pg.click(`.square[data-square="${from}"]`).catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    await pg.click(`.square[data-square="${to}"]`).catch(() => {});
    await new Promise((r) => setTimeout(r, delay));
  }
}

/* ==========================================================================
   1. Scholar's mate → checkmate + result dialog
   ========================================================================== */
console.log('\n--- 1. Play to checkmate (2-player so both sides are scripted) ---');
{
  const pg = await newPage();
  await waitEngine(pg);
  await pg.evaluate(() => {
    const el = document.querySelector('input[name="mode"][value="human"]');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));
  // Turn off auto-flip so the coordinates stay stable while scripting.
  await pg.evaluate(() => {
    const t = document.querySelector('#opt-autoplay');
    t.checked = false;
    t.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await playMoves(pg, [
    ['e2', 'e4'], ['e7', 'e5'],
    ['d1', 'h5'], ['b8', 'c6'],
    ['f1', 'c4'], ['g8', 'f6'],
    ['h5', 'f7']   // Qxf7#
  ], { delay: 400 });

  await new Promise((r) => setTimeout(r, 1200));
  const st = await pg.evaluate(() => {
    const s = window.__chessClub.state;
    return {
      checkmate: s.chess.isCheckmate(),
      gameOver: s.gameOver,
      dialog: !document.querySelector('#result-dialog').hidden,
      title: document.querySelector('#result-title').textContent,
      banner: document.querySelector('#alert-banner').textContent
    };
  });
  check('scholar\'s mate is checkmate', st.checkmate, st.title);
  check('game marked over', st.gameOver);
  check('result dialog shown', st.dialog, st.title);
  check('result title mentions checkmate/win', /checkmate|wins/i.test(st.title), st.title);
  check('banner announces the result', st.banner.length > 5, st.banner);
  await pg.close();
}

/* ==========================================================================
   2. Promotion picker
   ========================================================================== */
console.log('\n--- 2. Pawn promotion ---');
{
  const pg = await newPage();
  await waitEngine(pg);
  // Force a promotion-ready position via the debug surface.
  await pg.evaluate(() => {
    const s = window.__chessClub.state;
    s.mode = 'human';
    s.chess.load('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    s.playerColor = 'w';
    window.__chessClub.state.selected = null;
  });
  await pg.evaluate(() => {
    // Re-render with the new position.
    const s = window.__chessClub.state;
    s.lastMove = null;
    document.querySelector('#board').dispatchEvent(new Event('chessclub:rerender'));
  });
  // Trigger a render through a normal click path.
  await pg.click('.square[data-square="a7"]');
  await new Promise((r) => setTimeout(r, 200));
  const legal = await pg.$$eval('.square.legal', (e) => e.map((x) => x.dataset.square));
  check('promotion pawn shows legal squares', legal.includes('a8'), legal.join(','));

  await pg.click('.square[data-square="a8"]');
  await new Promise((r) => setTimeout(r, 400));

  const promo = await pg.evaluate(() => ({
    dialogOpen: !document.querySelector('#promotion-dialog').hidden,
    choices: document.querySelectorAll('#promo-choices button').length
  }));
  check('promotion dialog opens', promo.dialogOpen);
  check('promotion offers 4 pieces', promo.choices === 4, String(promo.choices));

  // Choose the knight (3rd button).
  const btns = await pg.$$('#promo-choices button');
  await btns[3].click();
  await new Promise((r) => setTimeout(r, 500));

  const promoted = await pg.evaluate(() => {
    const s = window.__chessClub.state;
    const hist = s.chess.history({ verbose: true });
    const last = hist[hist.length - 1];
    return {
      san: last?.san,
      piece: last?.promotion,
      onBoard: s.chess.get('a8')?.type,
      dialogClosed: document.querySelector('#promotion-dialog').hidden
    };
  });
  check('promotion to knight applied', promoted.onBoard === 'n', `piece=${promoted.onBoard} san=${promoted.san}`);
  check('promotion dialog closed after choice', promoted.dialogClosed);
  await pg.close();
}

/* ==========================================================================
   3. 2-player pass & play + auto-flip
   ========================================================================== */
console.log('\n--- 3. 2-player pass & play with auto-flip ---');
{
  const pg = await newPage();
  await waitEngine(pg);
  await pg.evaluate(() => {
    const el = document.querySelector('input[name="mode"][value="human"]');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const t = document.querySelector('#opt-autoplay');
    t.checked = true;
    t.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));

  const beforeFlip = await pg.evaluate(() => window.__chessClub.state.flipped);
  await pg.click('.square[data-square="e2"]');
  await new Promise((r) => setTimeout(r, 150));
  await pg.click('.square[data-square="e4"]');
  await new Promise((r) => setTimeout(r, 700));

  const afterState = await pg.evaluate(() => {
    const s = window.__chessClub.state;
    return { flipped: s.flipped, turn: s.chess.turn(), history: s.history.length };
  });
  check('2-player move accepted in pass & play', afterState.history === 1, JSON.stringify(afterState));
  check('board auto-flips to Black after White moves',
    afterState.flipped !== beforeFlip, `before=${beforeFlip} after=${afterState.flipped}`);

  // Black should now be at the bottom and able to move.
  await pg.click('.square[data-square="e7"]');
  await new Promise((r) => setTimeout(r, 150));
  const blackLegal = await pg.$$eval('.square.legal', (e) => e.length);
  check('Black can select and move after flip', blackLegal === 2, `legal=${blackLegal}`);

  // Manual flip button still works.
  const preManual = await pg.evaluate(() => window.__chessClub.state.flipped);
  await pg.click('#btn-flip');
  await new Promise((r) => setTimeout(r, 400));
  const postManual = await pg.evaluate(() => window.__chessClub.state.flipped);
  check('manual Flip button toggles the board', preManual !== postManual,
    `${preManual} -> ${postManual}`);
  await pg.close();
}

/* ==========================================================================
   4. Offline fallback: block the vendor + CDN engine
   ========================================================================== */
console.log('\n--- 4. Offline Pocket Bot fallback ---');
{
  const pg = await newPage({ block: ['stockfish'] });
  // Preferences persist in localStorage across pages in this browser profile,
  // so make the mode explicit rather than assuming the default.
  await pg.waitForFunction(
    () => !!window.__chessClub?.state,
    { timeout: 30000 }
  ).catch(() => {});
  await pg.evaluate(() => {
    const el = document.querySelector('input[name="mode"][value="computer"]');
    if (el && !el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await pg.waitForFunction(
    () => /Pocket Bot/i.test(document.querySelector('#status-text')?.textContent || ''),
    { timeout: 90000 }
  ).catch(() => {});

  const st = await pg.evaluate(() => ({
    kind: window.__chessClub.state.engine.kind,
    status: document.querySelector('#status-text').textContent
  }));
  check('falls back to Pocket Bot when engine unavailable', st.kind === 'pocket', st.kind);
  check('status explains the fallback', /Pocket Bot/i.test(st.status), st.status);

  // It must still play a legal reply.
  await pg.waitForFunction(
    () => window.__chessClub.state.engine.kind === 'pocket',
    { timeout: 90000 }
  ).catch(() => {});
  await pg.click('.square[data-square="e2"]');
  await new Promise((r) => setTimeout(r, 300));
  const selState = await pg.evaluate(() => ({
    selected: window.__chessClub.state.selected,
    legal: window.__chessClub.state.legalTargets.map((t) => t.to)
  }));
  check('pawn selectable offline', selState.selected === 'e2', JSON.stringify(selState));

  await pg.click('.square[data-square="e4"]');
  // Give the fallback bot a moment; it also runs the coach evaluation.
  await new Promise((r) => setTimeout(r, 2500));
  await pg.waitForFunction(
    () => window.__chessClub.state.history.some((h) => h.color === 'b'),
    { timeout: 40000 }
  ).catch(() => {});
  const hp = await pg.evaluate(() => window.__chessClub.state.history.map((h) => h.san));
  const diag = await pg.evaluate(() => {
    const s = window.__chessClub.state;
    return {
      hist: s.history.map((h) => h.color + ':' + h.san),
      turn: s.chess.turn(),
      playerColor: s.playerColor,
      mode: s.mode,
      busy: s.busy,
      kind: s.engine.kind,
      gameOver: s.gameOver
    };
  });
  check('Pocket Bot still replies with a legal move', hp.length >= 2,
    `${hp.join(' ')} | ${JSON.stringify(diag)}`);

  // And the coach still evaluates (heuristic path).
  const ev = await pg.evaluate(() => window.__chessClub.state.evalCp);
  check('coach evaluation works offline', typeof ev === 'number', String(ev));
  await pg.close();
}

/* ==========================================================================
   5. Keyboard-only play
   ========================================================================== */
console.log('\n--- 5. Keyboard play ---');
{
  const pg = await newPage();
  await waitEngine(pg);
  // Put the cursor on e2 and play e2-e4 with the keyboard only.
  await pg.evaluate(() => {
    const s = window.__chessClub.state;
    s.mode = 'human';           // avoid engine interference
    s.cursor = 'e2';
  });
  await pg.focus('#board');
  await pg.keyboard.press('Enter');        // pick up the pawn
  await new Promise((r) => setTimeout(r, 200));
  const legalKb = await pg.$$eval('.square.legal', (e) => e.length);
  check('Enter selects a piece via keyboard', legalKb > 0, `legal=${legalKb}`);

  await pg.keyboard.press('ArrowUp');      // e3
  await pg.keyboard.press('ArrowUp');      // e4
  await new Promise((r) => setTimeout(r, 200));
  const cursor = await pg.evaluate(() => window.__chessClub.state.cursor);
  check('arrow keys move the cursor', cursor === 'e4', cursor);

  await pg.keyboard.press('Enter');        // drop on e4
  await new Promise((r) => setTimeout(r, 500));
  const played = await pg.evaluate(() => window.__chessClub.state.chess.history());
  check('keyboard move e2-e4 played', played[0] === 'e4', played.join(' '));

  // H for hint. Wait for the hint to actually arrive rather than guessing a
  // delay: it runs behind the coach's evaluations on the single engine, so its
  // latency depends on how long those take on this machine.
  await pg.keyboard.press('h');
  await pg.waitForFunction(
    () => window.__chessClub.state.hint !== null,
    { timeout: 25000 }
  ).catch(() => {});
  const hintState = await pg.evaluate(() => window.__chessClub.state.hint);
  check('H key requests a hint', hintState !== null, JSON.stringify(hintState));
  await pg.close();
}

/* ==========================================================================
   6. Resign
   ========================================================================== */
console.log('\n--- 6. Resign ---');
{
  const pg = await newPage();
  await waitEngine(pg);
  await pg.click('#btn-resign');
  await new Promise((r) => setTimeout(r, 500));
  const st = await pg.evaluate(() => ({
    over: window.__chessClub.state.gameOver,
    dialog: !document.querySelector('#result-dialog').hidden,
    title: document.querySelector('#result-title').textContent
  }));
  check('resign ends the game', st.over);
  check('resign shows the result dialog', st.dialog, st.title);
  check('resign title is sensible', /resignation|wins/i.test(st.title), st.title);
  await pg.close();
}

/* ==========================================================================
   7. Check banner + coach reaction to a blunder
   ========================================================================== */
console.log('\n--- 7. Check banner ---');
{
  const pg = await newPage();
  await waitEngine(pg);
  // Black king on e8, White rook on a1, White king tucked on h1, e-file
  // empty: Ra1-e1 gives check straight down the e-file.
  await pg.evaluate(() => {
    const s = window.__chessClub.state;
    s.mode = 'human';
    s.chess.load('4k3/8/8/8/8/8/8/R6K w - - 0 1');
    s.lastMove = null;
    s.selected = null;
    s.legalTargets = [];
  });
  await pg.click('.square[data-square="a1"]');
  await new Promise((r) => setTimeout(r, 250));
  const rookLegal = await pg.$$eval('.square.legal', (e) => e.map((x) => x.dataset.square));
  check('rook shows legal squares', rookLegal.includes('e1'), rookLegal.join(','));

  await pg.click('.square[data-square="e1"]');
  await new Promise((r) => setTimeout(r, 900));

  const banner = await pg.evaluate(() => {
    const s = window.__chessClub.state;
    return {
      hidden: document.querySelector('#alert-banner').hidden,
      text: document.querySelector('#alert-banner').textContent,
      cls: document.querySelector('#alert-banner').className,
      inCheck: s.chess.isCheck(),
      checkSquare: document.querySelectorAll('.square.in-check').length
    };
  });
  check('position is check after Re1', banner.inCheck, `check=${banner.inCheck}`);
  check('check banner appears', !banner.hidden && /check/i.test(banner.text), banner.text);
  check('checked king square is highlighted', banner.checkSquare >= 1, `squares=${banner.checkSquare}`);
  await pg.close();
}

/* ==========================================================================
   8. New Game while the engine is thinking (stale-reply guard)
   ========================================================================== */
console.log('\n--- 8. New Game during the engine search ---');
{
  const pg = await newPage();
  await waitEngine(pg);

  // Challenger searches the longest (depth 12 / 1600 ms), and turning the coach
  // off skips the evaluation phase so we reach the search immediately.
  await pg.evaluate(() => {
    const diff = document.querySelector('input[name="difficulty"][value="challenger"]');
    diff.checked = true;
    diff.dispatchEvent(new Event('change', { bubbles: true }));
    const coach = document.querySelector('#opt-coach');
    coach.checked = false;
    coach.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));

  await playMoves(pg, [['e2', 'e4']]);

  // Wait until the engine is genuinely mid-search, otherwise the test would
  // pass vacuously.
  const started = await pg.waitForFunction(
    () => window.__chessClub.state.busy === true,
    { timeout: 20000 }
  ).catch(() => null);

  // Interrupt with a brand-new game, then give any in-flight reply time to land.
  await pg.click('#btn-new');
  await new Promise((r) => setTimeout(r, 3000));

  const after = await pg.evaluate(() => ({
    gameOver: window.__chessClub.state.gameOver,
    fen: window.__chessClub.state.chess.fen(),
    historyLen: window.__chessClub.state.history.length,
    resultShown: !document.querySelector('#result-dialog').hidden,
    pieces: document.querySelectorAll('.square .piece').length
  }));

  check('the engine really was thinking', !!started);
  check('a stale reply does not end the new game', !after.gameOver);
  check('the new game is still in the starting position',
    after.fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'),
    after.fen.split(' ')[0]);
  check('no moves were replayed onto the new game', after.historyLen === 0,
    `history=${after.historyLen}`);
  check('32 pieces still on the board', after.pieces === 32, `count=${after.pieces}`);
  check('no result dialog appeared', !after.resultShown);

  await pg.close();
}

/* ==========================================================================
   9. Coach review and the reply run concurrently (P1-6)
   ========================================================================== */
console.log('\n--- 9. Concurrent coach review and computer reply ---');
{
  const pg = await newPage();
  await waitEngine(pg);

  // Instrument the page: record the order of engine calls, and of the two
  // user-visible events (the coach bubble and the reply landing). The engine
  // methods can be replaced so the two analyses finish in a chosen order.
  await pg.evaluate(() => {
    const s = window.__chessClub.state;
    const log = [];
    const marks = [];
    let t0 = 0;
    window.__p16 = {
      log,
      marks,
      reset() { log.length = 0; marks.length = 0; t0 = performance.now(); },
      mark(name) { marks.push({ name, t: Math.round(performance.now() - t0) }); },
      patch(opts) {
        s.engine.evaluate = async () => {
          log.push('evaluate:start');
          await new Promise((r) => setTimeout(r, opts.evaluateMs ?? 20));
          log.push('evaluate:end');
          if (opts.failEvaluate) throw new Error('evaluate failed');
          return 30;
        };
        s.engine.bestMove = async () => {
          log.push('bestMove:start');
          await new Promise((r) => setTimeout(r, opts.bestMoveMs ?? 20));
          log.push('bestMove:end');
          if (opts.failBestMove) throw new Error('bestMove failed');
          return { from: 'e7', to: 'e5' };
        };
      },
      restore() { delete s.engine.evaluate; delete s.engine.bestMove; }
    };
    let bubbles = document.querySelectorAll('#coach-feed .bubble').length;
    let moves = s.history.length;
    const tick = () => {
      const b = document.querySelectorAll('#coach-feed .bubble').length;
      const m = s.history.length;
      if (b !== bubbles) { bubbles = b; window.__p16.mark('bubble'); }
      if (m !== moves) {
        moves = m;
        // history 1 is the human's own move; only the computer's reply (2)
        // matters for the ordering assertions below.
        if (m >= 2) window.__p16.mark('move');
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const snap = () => pg.evaluate(() => ({
    log: [...window.__p16.log],
    marks: [...window.__p16.marks],
    history: window.__chessClub.state.history.length,
    gameOver: window.__chessClub.state.gameOver,
    fen: window.__chessClub.state.chess.fen(),
    pieces: document.querySelectorAll('.square .piece').length,
    resultShown: !document.querySelector('#result-dialog').hidden
  }));
  const at = (marks, name) => marks.findIndex((m) => m.name === name);
  const before = (marks, a, b) => at(marks, a) !== -1 && at(marks, a) < at(marks, b);
  const playE4 = async () => {
    await pg.click('.square[data-square="e2"]');
    await new Promise((r) => setTimeout(r, 120));
    await pg.click('.square[data-square="e4"]');
  };
  const freshGame = async () => {
    await pg.click('#btn-new');
    await new Promise((r) => setTimeout(r, 250));
  };
  let st;

  /* -- 9a. the normal path, with the real engine -- */
  await pg.evaluate(() => window.__p16.reset());
  await playE4();
  await new Promise((r) => setTimeout(r, 3500));
  st = await snap();
  check('9a normal: the coach gives feedback', at(st.marks, 'bubble') !== -1,
    JSON.stringify(st.marks));
  check('9a normal: the computer replies', st.history === 2, `history=${st.history}`);
  check('9a normal: feedback lands before the reply', before(st.marks, 'bubble', 'move'),
    JSON.stringify(st.marks));

  /* -- 9b. the coach is slower than the reply -- */
  await freshGame();
  await pg.evaluate(() => {
    window.__p16.reset();
    window.__p16.patch({ evaluateMs: 400, bestMoveMs: 20 });
  });
  await playE4();
  await new Promise((r) => setTimeout(r, 1500));
  st = await snap();
  check('9b coach slower: both analyses are in flight at once',
    st.log.indexOf('bestMove:start') !== -1
    && st.log.indexOf('bestMove:start') < st.log.indexOf('evaluate:end'),
    st.log.join(' '));
  check('9b coach slower: the bubble precedes the reply', before(st.marks, 'bubble', 'move'),
    JSON.stringify(st.marks));
  check('9b coach slower: the reply still lands', st.history === 2, `history=${st.history}`);

  /* -- 9c. the reply is faster than the coach -- */
  await freshGame();
  await pg.evaluate(() => {
    window.__p16.reset();
    window.__p16.patch({ evaluateMs: 500, bestMoveMs: 10 });
  });
  await playE4();
  await new Promise((r) => setTimeout(r, 1700));
  st = await snap();
  check('9c reply faster: the reply finished analysing first',
    st.log.indexOf('bestMove:end') < st.log.indexOf('evaluate:end'), st.log.join(' '));
  check('9c reply faster: the bubble STILL precedes the board change',
    before(st.marks, 'bubble', 'move'), JSON.stringify(st.marks));
  check('9c reply faster: the reply lands', st.history === 2, `history=${st.history}`);

  /* -- 9d. a new game while both analyses are running -- */
  await pg.evaluate(() => {
    window.__p16.reset();
    window.__p16.patch({ evaluateMs: 1200, bestMoveMs: 900 });
  });
  await playE4();
  await new Promise((r) => setTimeout(r, 200));
  await pg.click('#btn-new');
  await new Promise((r) => setTimeout(r, 2500));
  st = await snap();
  check('9d new game mid-analysis: the new game is still live', !st.gameOver);
  check('9d new game mid-analysis: still the starting position',
    st.fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'),
    st.fen.split(' ')[0]);
  check('9d new game mid-analysis: no move was replayed', st.history === 0,
    `history=${st.history}`);
  check('9d new game mid-analysis: 32 pieces', st.pieces === 32, `pieces=${st.pieces}`);
  check('9d new game mid-analysis: no result dialog', !st.resultShown);

  /* -- 9e. the coach's evaluation fails -- */
  await freshGame();
  await pg.evaluate(() => {
    window.__p16.reset();
    window.__p16.patch({ evaluateMs: 20, bestMoveMs: 20, failEvaluate: true });
  });
  await playE4();
  await new Promise((r) => setTimeout(r, 1200));
  st = await snap();
  check('9e coach fails: the game carries on (reply applied)', st.history === 2,
    `history=${st.history}`);
  check('9e coach fails: the game is not over', !st.gameOver);
  check('9e coach fails: no result dialog', !st.resultShown);

  /* -- 9f. the reply search fails -- */
  await freshGame();
  await pg.evaluate(() => {
    window.__p16.reset();
    window.__p16.patch({ evaluateMs: 20, bestMoveMs: 20, failBestMove: true });
  });
  await playE4();
  await new Promise((r) => setTimeout(r, 1200));
  st = await snap();
  check('9f reply fails: a legal move is still played', st.history === 2,
    `history=${st.history}`);
  check('9f reply fails: the game is not over', !st.gameOver);

  await pg.evaluate(() => window.__p16.restore());
  await pg.close();
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL SCENARIO TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');

await browser.close();
process.exit(failures ? 1 : 0);
