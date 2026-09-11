/**
 * app.js — Chess Club main application.
 *
 * Responsibilities:
 *   - load chess.js from CDN (with fallback mirror)
 *   - render an accessible, e-ink friendly 8x8 board
 *   - handle tap/keyboard/mouse input + promotion + undo + resign
 *   - drive the engine (Stockfish or Pocket Bot) for vs-computer play
 *   - run the Coach: evaluate before/after each move and explain it
 */

import { pieceSvg, PIECE_NAMES, PIECE_VALUES } from './src/pieces.js';
import { Engine, DIFFICULTIES, sleep } from './src/engine.js';
import { classify, describeMove, describeHint, openingTip, evalText, phaseOf } from './src/coach.js';

/* ========================================================================== */
/*  Load chess.js                                                             */
/* ========================================================================== */

const CHESSJS_URLS = [
  './vendor/chess.js',
  'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js',
  'https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js'
];

async function loadChessJs() {
  let lastErr;
  for (const url of CHESSJS_URLS) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod && mod.Chess) return mod.Chess;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unable to load chess.js');
}

/* ========================================================================== */
/*  Small helpers                                                             */
/* ========================================================================== */

const $ = (sel) => document.querySelector(sel);
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

function squareName(fileIdx, rankIdx) {
  // rankIdx 0 = rank 8 (top of an un-flipped board)
  return FILES[fileIdx] + RANKS[rankIdx];
}

function otherColor(c) { return c === 'w' ? 'b' : 'w'; }

function colorName(c) { return c === 'w' ? 'White' : 'Black'; }

/* ========================================================================== */
/*  App state                                                                 */
/* ========================================================================== */

const state = {
  Chess: null,
  chess: null,
  engine: null,

  mode: 'computer',          // 'computer' | 'human'
  difficulty: 'beginner',
  playerColor: 'w',          // human colour in vs-computer

  flipped: false,
  autoFlip: true,
  coachOn: true,
  animations: false,
  sound: false,

  selected: null,            // square name of the currently selected piece
  legalTargets: [],          // [{to, capture}]
  lastMove: null,            // {from, to}
  hint: null,                // {from, to}
  cursor: 'e2',              // keyboard cursor square

  busy: false,               // engine thinking / animating
  gameOver: false,
  history: [],               // { san, fenBefore, fenAfter, color, move }
  evalCp: 0,                 // centipawns, white's perspective
  started: false,
  pendingPromotion: null,
  hintCount: 0
};

/* LocalStorage key for remembered preferences */
const PREFS_KEY = 'chessclub.prefs.v1';

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      mode: state.mode,
      difficulty: state.difficulty,
      autoFlip: state.autoFlip,
      coachOn: state.coachOn,
      animations: state.animations,
      sound: state.sound
    }));
  } catch { /* storage may be unavailable; ignore */ }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.mode) state.mode = p.mode;
    if (p.difficulty) state.difficulty = p.difficulty;
    if (typeof p.autoFlip === 'boolean') state.autoFlip = p.autoFlip;
    if (typeof p.coachOn === 'boolean') state.coachOn = p.coachOn;
    if (typeof p.animations === 'boolean') state.animations = p.animations;
    if (typeof p.sound === 'boolean') state.sound = p.sound;
  } catch { /* ignore */ }
}

/* ========================================================================== */
/*  Sound (tiny WebAudio blips — no asset files)                              */
/* ========================================================================== */

let audioCtx = null;
function beep(freq = 440, duration = 0.07, type = 'square') {
  if (!state.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch { /* audio is a nice-to-have */ }
}
const sfx = {
  move: () => beep(520, 0.06),
  capture: () => beep(300, 0.09, 'triangle'),
  check: () => { beep(700, 0.08); setTimeout(() => beep(900, 0.1), 90); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'sine'), i * 130)); },
  lose: () => { [392, 330, 262].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'sine'), i * 150)); }
};

/* ========================================================================== */
/*  DOM references                                                            */
/* ========================================================================== */

const dom = {};

function cacheDom() {
  dom.board = $('#board');
  dom.alert = $('#alert-banner');
  dom.busy = $('#board-busy');
  dom.busyText = $('#busy-text');
  dom.coachFeed = $('#coach-feed');
  dom.evalFill = $('#eval-fill');
  dom.evalLabel = $('#eval-label');
  dom.moveList = $('#move-list');
  dom.moveCount = $('#move-count');
  dom.playerTop = $('#player-top');
  dom.playerBottom = $('#player-bottom');
  dom.playerTopName = $('#player-top-name');
  dom.playerBottomName = $('#player-bottom-name');
  dom.playerTopCaptures = $('#player-top-captures');
  dom.playerBottomCaptures = $('#player-bottom-captures');
  dom.btnNew = $('#btn-new');
  dom.btnUndo = $('#btn-undo');
  dom.btnHint = $('#btn-hint');
  dom.btnFlip = $('#btn-flip');
  dom.btnResign = $('#btn-resign');
  dom.statusLight = $('#status-light');
  dom.statusText = $('#status-text');
  dom.difficultyGroup = $('#difficulty-group');
  dom.promotionDialog = $('#promotion-dialog');
  dom.promoChoices = $('#promo-choices');
  dom.resultDialog = $('#result-dialog');
  dom.resultTitle = $('#result-title');
  dom.resultText = $('#result-text');
}

/* ========================================================================== */
/*  Board rendering                                                           */
/* ========================================================================== */

function buildBoard() {
  dom.board.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = squareName(f, r);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'square';
      btn.dataset.square = sq;
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', sq);
      btn.tabIndex = -1;
      dom.board.appendChild(btn);
    }
  }
}

/** Return the square element for a name, honouring the flip state. */
function squareEl(name) {
  return dom.board.querySelector(`.square[data-square="${name}"]`);
}

/** All square names in visual order (respecting flip). */
function visualOrder() {
  const files = state.flipped ? [...FILES].reverse() : FILES;
  const ranks = state.flipped ? [...RANKS].reverse() : RANKS;
  const out = [];
  for (const rank of ranks) for (const file of files) out.push(file + rank);
  return out;
}

function renderBoard() {
  const order = visualOrder();
  const board = state.chess.board();   // board[0] is rank 8
  const turn = state.chess.turn();
  const checkedKing = state.chess.isCheck() ? findKing(board, turn) : null;
  const hint = state.hint;

  order.forEach((name, idx) => {
    const el = squareEl(name);
    if (!el) return;

    // Reattach in visual order — using CSS `order` keeps DOM stable & cheap.
    el.style.order = String(idx);

    const file = name[0];
    const rank = name[1];
    const fileIdx = FILES.indexOf(file);
    const rankIdx = RANKS.indexOf(rank);

    el.classList.toggle('dark', (fileIdx + rankIdx) % 2 === 1);

    // ----- piece -----
    const piece = board[rankIdx][fileIdx];
    const existing = el.querySelector('.piece');
    const wantedSvg = piece ? pieceSvg(piece.type, piece.color) : '';
    if (existing) {
      const currentKey = existing.dataset.pieceKey;
      const wantedKey = piece ? `${piece.color}${piece.type}` : '';
      if (currentKey !== wantedKey) {
        el.innerHTML = '';
      }
    }
    if (!el.querySelector('.piece') && wantedSvg) {
      el.insertAdjacentHTML('beforeend', wantedSvg);
      const svg = el.querySelector('.piece');
      svg.dataset.pieceKey = `${piece.color}${piece.type}`;
      if (state.animations) {
        svg.animate(
          [{ transform: 'scale(0.82)' }, { transform: 'scale(1)' }],
          { duration: 140, easing: 'ease-out' }
        );
      }
    }

    // ----- labels -----
    const isBottomEdge = idx >= 56;
    const isLeftEdge = idx % 8 === 0;
    el.querySelectorAll('.coord').forEach((c) => c.remove());
    if (state.flipped ? isBottomEdge : isBottomEdge) {
      // show file letter on the bottom rank of the *visual* board
      const span = document.createElement('span');
      span.className = 'coord file';
      span.textContent = file;
      el.appendChild(span);
    }
    if (isLeftEdge) {
      const span = document.createElement('span');
      span.className = 'coord rank';
      span.textContent = rank;
      el.appendChild(span);
    }

    // ----- states -----
    el.classList.toggle('selected', state.selected === name);
    el.classList.toggle('last-move', !!state.lastMove && (state.lastMove.from === name || state.lastMove.to === name));
    el.classList.toggle('in-check', checkedKing === name);
    el.classList.toggle('hint-from', !!hint && hint.from === name);
    el.classList.toggle('hint-to', !!hint && hint.to === name);

    const target = state.legalTargets.find((t) => t.to === name);
    el.classList.toggle('legal', !!target);
    el.classList.toggle('capture', !!target && target.capture);

    // ----- accessibility label -----
    const bits = [];
    bits.push(piece ? `${colorName(piece.color)} ${PIECE_NAMES[piece.type]}` : 'empty square');
    bits.push(name);
    if (target) bits.push(target.capture ? 'capture available' : 'legal move');
    if (checkedKing === name) bits.push('in check');
    el.setAttribute('aria-label', bits.join(', '));

    // Roving tabindex for keyboard users.
    el.tabIndex = state.cursor === name ? 0 : -1;
  });
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (sq && sq.type === 'k' && sq.color === color) return squareName(f, r);
    }
  }
  return null;
}

function renderCaptures() {
  // Chess.history({verbose:true}) gives us captured pieces per move.
  const hist = state.chess.history({ verbose: true });
  const capturedBy = { w: [], b: [] };
  for (const m of hist) {
    if (m.captured) capturedBy[m.color].push(m.captured);
  }
  const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
  const paint = (arr) => arr.sort((a, b) => order[a] - order[b])
    .map((t) => pieceSvg(t, 'b')).join('');

  dom.playerBottomCaptures.innerHTML = paint(capturedBy.w);
  dom.playerTopCaptures.innerHTML = paint(capturedBy.b);

  // Determine who sits at the top.
  let topColor, bottomColor, topName, bottomName;
  if (state.mode === 'human') {
    topColor = state.flipped ? 'w' : 'b';
    bottomColor = otherColor(topColor);
    topName = colorName(topColor);
    bottomName = colorName(bottomColor);
  } else {
    const humanColor = state.playerColor;
    bottomColor = state.flipped ? otherColor(humanColor) : humanColor;
    topColor = otherColor(bottomColor);
    topName = bottomColor === humanColor ? 'You' : `Computer (${DIFFICULTIES[state.difficulty].label})`;
    bottomName = topColor === humanColor ? 'You' : `Computer (${DIFFICULTIES[state.difficulty].label})`;
  }

  dom.playerTopName.textContent = topName;
  dom.playerBottomName.textContent = bottomName;
  dom.playerTop.classList.toggle('is-black', topColor === 'b');
  dom.playerBottom.classList.toggle('is-black', bottomColor === 'b');

  const turn = state.chess.turn();
  dom.playerTop.classList.toggle('active', topColor === turn && !state.gameOver);
  dom.playerBottom.classList.toggle('active', bottomColor === turn && !state.gameOver);

  // Captures belong to the player who made them => show on that player's card.
  const topCaptures = capturedBy[topColor];
  const bottomCaptures = capturedBy[bottomColor];
  dom.playerTopCaptures.innerHTML = topCaptures.sort((a, b) => order[a] - order[b])
    .map((t) => pieceSvg(t, otherColor(topColor))).join('');
  dom.playerBottomCaptures.innerHTML = bottomCaptures.sort((a, b) => order[a] - order[b])
    .map((t) => pieceSvg(t, otherColor(bottomColor))).join('');
}

function renderMoveList() {
  const hist = state.chess.history();
  dom.moveCount.textContent = String(hist.length);
  const rows = [];
  for (let i = 0; i < hist.length; i += 2) {
    const num = i / 2 + 1;
    const white = hist[i] || '';
    const black = hist[i + 1] || '';
    rows.push(`<li>${num}. ${white}${black ? ' ' + black : ''}</li>`);
  }
  dom.moveList.innerHTML = rows.join('');
  const box = $('#move-list-box');
  if (box && box.open) {
    dom.moveList.scrollTop = dom.moveList.scrollHeight;
  }
}

function renderEval() {
  const cp = state.evalCp;
  const clamped = Math.max(-800, Math.min(800, cp));
  const pct = 50 + (clamped / 800) * 50;
  dom.evalFill.style.width = `${pct}%`;
  dom.evalLabel.textContent = `${evalText(cp)} (${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)})`;
}

function renderStatus() {
  const turn = state.chess.turn();
  const check = state.chess.isCheck();
  const over = state.chess.isGameOver();

  if (over) return; // handled by showResult

  if (check) {
    showBanner(`${colorName(turn)} is in CHECK! Move the king or block.`, 'check');
  } else if (state.busy) {
    showBanner('');
  } else {
    showBanner('');
  }
}

function showBanner(text, kind = '') {
  if (!text) {
    dom.alert.hidden = true;
    dom.alert.textContent = '';
    return;
  }
  dom.alert.hidden = false;
  dom.alert.textContent = text;
  dom.alert.className = `alert-banner ${kind ? 'alert-' + kind : ''}`;
}

function setBusy(isBusy, text = 'Thinking…') {
  state.busy = isBusy;
  dom.busy.hidden = !isBusy;
  dom.busyText.textContent = text;
  updateControls();
}

function updateControls() {
  const turn = state.chess.turn();
  const myTurn = state.mode === 'computer'
    ? turn === state.playerColor
    : true;
  dom.btnUndo.disabled = state.history.length === 0 || state.busy;
  dom.btnHint.disabled = state.busy || state.gameOver || !myTurn;
  dom.btnResign.disabled = state.gameOver || state.busy;
  dom.btnNew.disabled = false;
}

function renderAll() {
  renderBoard();
  renderCaptures();
  renderMoveList();
  renderEval();
  renderStatus();
  updateControls();
}

/* ========================================================================== */
/*  Coach feed                                                                */
/* ========================================================================== */

function addBubble({ tier = 'info', title = '', text = '', move = '' }) {
  if (!state.coachOn && tier !== 'info') return;
  const div = document.createElement('div');
  div.className = `bubble tier-${tier}`;
  let html = '';
  if (title) html += `<span class="bubble-title">${escapeHtml(title)}</span>`;
  if (move) html += `<span class="bubble-move">${escapeHtml(move)}</span><br>`;
  html += `<span class="bubble-body">${formatMd(text)}</span>`;
  div.innerHTML = html;
  dom.coachFeed.appendChild(div);
  while (dom.coachFeed.children.length > 40) {
    dom.coachFeed.removeChild(dom.coachFeed.firstChild);
  }
  dom.coachFeed.scrollTop = dom.coachFeed.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatMd(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* ========================================================================== */
/*  Interaction                                                               */
/* ========================================================================== */

function isHumanTurn() {
  if (state.gameOver) return false;
  if (state.mode === 'human') return true;
  return state.chess.turn() === state.playerColor;
}

function onSquareClick(name) {
  state.cursor = name;
  if (!isHumanTurn() || state.busy) return;

  const piece = state.chess.get(name);

  // Second click: complete a move.
  if (state.selected) {
    const target = state.legalTargets.find((t) => t.to === name);
    if (target) {
      attemptMove(state.selected, name);
      return;
    }
    // Clicking your own other piece reselects.
    if (piece && piece.color === state.chess.turn()) {
      selectSquare(name);
      return;
    }
    clearSelection();
    renderBoard();
    return;
  }

  if (piece && piece.color === state.chess.turn()) {
    selectSquare(name);
  } else if (piece) {
    addBubble({ tier: 'info', text: `That is ${colorName(piece.color)}'s piece — it is ${colorName(state.chess.turn())}'s turn.` });
  }
}

function selectSquare(name) {
  const moves = state.chess.moves({ square: name, verbose: true });
  state.selected = name;
  // Use chess.js's own helpers where available; fall back to flags for safety.
  state.legalTargets = moves.map((m) => ({
    to: m.to,
    capture: typeof m.isCapture === 'function' ? m.isCapture() : !!m.captured,
    promotion: typeof m.isPromotion === 'function' ? m.isPromotion() : m.flags.includes('p')
  }));
  state.hint = null;
  renderBoard();
}

function clearSelection() {
  state.selected = null;
  state.legalTargets = [];
}

async function attemptMove(from, to, promotion) {
  const legal = state.chess.moves({ square: from, verbose: true });
  const candidates = legal.filter((m) => m.to === to);

  if (candidates.length === 0) {
    addBubble({ tier: 'info', text: 'That piece cannot go there. Remember: knights jump, bishops go diagonally, rooks go straight!' });
    clearSelection();
    renderBoard();
    return;
  }

  // Promotion?
  if (candidates.some((m) => m.promotion) && !promotion) {
    state.pendingPromotion = { from, to };
    showPromotionDialog(state.chess.turn());
    return;
  }

  const fenBefore = state.chess.fen();
  const evalBefore = state.evalCp;

  let move;
  try {
    move = state.chess.move({ from, to, promotion: promotion || 'q' });
  } catch {
    move = null;
  }
  if (!move) {
    clearSelection();
    renderBoard();
    return;
  }

  state.lastMove = { from: move.from, to: move.to };
  state.hint = null;
  clearSelection();
  state.history.push({ san: move.san, fenBefore, fenAfter: state.chess.fen(), color: move.color, move });

  move.captured ? sfx.capture() : sfx.move();
  renderAll();

  if (state.chess.isCheck() && !state.chess.isGameOver()) {
    setTimeout(() => sfx.check(), 120);
  }

  // ---- post-move work ----
  if (state.chess.isGameOver()) {
    finishGame();
    return;
  }

  // Hand over to the computer if it is its turn.
  if (state.mode === 'computer' && state.chess.turn() !== state.playerColor) {
    // Coach evaluation runs first so the bubble lands before the reply.
    if (state.coachOn) {
      await coachReviewPlayedMove(move, fenBefore, evalBefore);
    }
    await computerMove();
  } else if (state.coachOn) {
    await coachReviewPlayedMove(move, fenBefore, evalBefore);
  } else {
    scheduleEvalRefresh();
  }

  if (state.mode === 'human' && state.autoFlip) {
    // Keep the player who is about to move at the bottom of the board.
    // `flipped === false` puts White at the bottom; `flipped === true` puts
    // Black at the bottom. So flip when it is Black to move.
    const shouldBeFlipped = state.chess.turn() === 'b';
    if (shouldBeFlipped !== state.flipped) {
      state.flipped = shouldBeFlipped;
      renderAll();
    }
  }
}

function scheduleEvalRefresh() {
  if (!state.engine) return;
  state.engine.evaluate(state.chess, { depth: 8, timeoutMs: 1800 })
    .then((cp) => {
      state.evalCp = cp;
      renderEval();
    })
    .catch(() => { /* ignore */ });
}

/* ========================================================================== */
/*  Promotion dialog                                                          */
/* ========================================================================== */

function showPromotionDialog(color) {
  dom.promoChoices.innerHTML = '';
  for (const type of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.innerHTML = pieceSvg(type, color);
    btn.setAttribute('aria-label', `Promote to ${PIECE_NAMES[type]}`);
    btn.addEventListener('click', () => {
      const { from, to } = state.pendingPromotion;
      state.pendingPromotion = null;
      closePromotionDialog();
      attemptMove(from, to, type);
    });
    dom.promoChoices.appendChild(btn);
  }
  dom.promotionDialog.hidden = false;
  const first = dom.promoChoices.querySelector('button');
  if (first) first.focus();
}

function closePromotionDialog() {
  dom.promotionDialog.hidden = true;
  state.pendingPromotion = null;
  dom.board.focus();
}

/* ========================================================================== */
/*  Coach logic                                                               */
/* ========================================================================== */

async function bestMoveLoss(chess, playedMove, fenBefore) {
  // Evaluate the position before, and after, using a shallow search.
  const chessBefore = new state.Chess(fenBefore);
  const before = await state.engine.evaluate(chessBefore, { depth: 8, timeoutMs: 2000 });
  const after = await state.engine.evaluate(chess, { depth: 8, timeoutMs: 2000 });

  // `evaluate` returns White-perspective centipawns.
  const moverIsWhite = playedMove.color === 'w';
  const delta = moverIsWhite ? (after - before) : (before - after);
  const loss = Math.max(0, -delta);
  return { before, after, loss };
}

async function coachReviewPlayedMove(move, fenBefore, evalBefore) {
  try {
    const { loss, after } = await bestMoveLoss(state.chess, move, fenBefore);
    state.evalCp = after;
    renderEval();
    if (!state.coachOn) return;

    const details = collectMoveDetails(move, fenBefore);
    const tier = classify(loss, loss <= 10, details);
    const msg = describeMove({
      tier,
      san: move.san,
      color: move.color,
      details,
      loss
    });
    addBubble({
      tier: TIERS_TO_CLASS(tier),
      title: `${msg.label} — ${colorName(move.color)}`,
      move: move.san,
      text: msg.text
    });
  } catch {
    // Never let coaching break the game.
  }
}

/** Map internal tier keys onto the CSS class names used in style.css. */
function TIERS_TO_CLASS(tier) {
  switch (tier) {
    case 'brilliant':
    case 'best':
      return 'brilliant';
    case 'good':
      return 'good';
    case 'inaccuracy':
      return 'inaccuracy';
    case 'mistake':
      return 'mistake';
    case 'blunder':
      return 'blunder';
    default:
      return 'info';
  }
}

/** Gather simple board facts that make advice concrete. */
function collectMoveDetails(move, fenBefore) {
  const chess = state.chess;
  const details = {
    to: move.to,
    from: move.from,
    wasCapture: !!move.captured,
    capturedPiece: move.captured || null,
    capturedValue: move.captured ? PIECE_VALUES[move.captured] : 0,
    wasCheck: /\+|#/.test(move.san),
    wasCastle: move.flags.includes('k') || move.flags.includes('q'),
    wasPromotion: !!move.promotion,
    isDevelopment: !move.captured && (move.piece === 'n' || move.piece === 'b') &&
      HOME_RANK_FOR(move.color).includes(move.from)
  };

  // Was a piece left hanging? (i.e. opponent can capture for free)
  const probes = chess.moves({ verbose: true });
  const best = probes.sort((a, b) => (a.captured ? PIECE_VALUES[a.captured] : 0) -
    (b.captured ? PIECE_VALUES[b.captured] : 0)).pop();
  if (best && best.captured) {
    details.opponentBestReplyIsCapture = true;
    details.hungPiece = best.captured;
    details.hungSquare = best.to;
  }

  // Are we losing material after the move (a very rough "is it hanging" test)?
  details.losesMaterial = details.opponentBestReplyIsCapture &&
    (PIECE_VALUES[best.captured] || 0) >= 3;

  details.kingExposed = isKingExposed(move.color);
  details.wasFork = move.piece === 'n' && details.wasCheck;

  return details;
}

function HOME_RANK_FOR(color) {
  return color === 'w'
    ? ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']
    : ['a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8'];
}

/** Rough king-safety test: is the king off its back rank with few pawns nearby? */
function isKingExposed(color) {
  const board = state.chess.board();
  const kingSq = findKing(board, color);
  if (!kingSq) return false;
  const fileIdx = FILES.indexOf(kingSq[0]);
  const rankIdx = RANKS.indexOf(kingSq[1]);
  let friends = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let df = -1; df <= 1; df++) {
      if (dr === 0 && df === 0) continue;
      const r = rankIdx + dr;
      const f = fileIdx + df;
      if (r < 0 || r > 7 || f < 0 || f > 7) continue;
      const sq = board[r][f];
      if (sq && sq.color === color && sq.type === 'p') friends++;
    }
  }
  return friends === 0;
}

/* ========================================================================== */
/*  Computer move                                                             */
/* ========================================================================== */

async function computerMove() {
  if (state.gameOver) return;
  if (state.mode !== 'computer') return;
  if (state.chess.turn() === state.playerColor) return;

  setBusy(true, 'Computer is thinking…');
  // Yield a frame so the overlay paints (important on slow e-ink).
  await sleep(40);

  let move = null;
  try {
    move = await state.engine.bestMove(state.chess, { difficulty: state.difficulty });
  } catch {
    move = null;
  }

  if (!move) {
    // Absolute last resort: pick any legal move so we never deadlock.
    const legal = state.chess.moves({ verbose: true });
    if (legal.length) {
      const m = legal[Math.floor(Math.random() * legal.length)];
      move = { from: m.from, to: m.to, promotion: m.promotion };
    }
  }

  setBusy(false);

  if (!move) { finishGame(); return; }

  const fenBefore = state.chess.fen();
  let played;
  try {
    played = state.chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
  } catch {
    played = null;
  }
  if (!played) { finishGame(); return; }

  state.lastMove = { from: played.from, to: played.to };
  clearSelection();
  state.history.push({ san: played.san, fenBefore, fenAfter: state.chess.fen(), color: played.color, move: played });

  played.captured ? sfx.capture() : sfx.move();
  renderAll();

  if (state.chess.isCheck() && !state.chess.isGameOver()) {
    setTimeout(() => sfx.check(), 120);
  }

  if (state.chess.isGameOver()) {
    finishGame();
    return;
  }

  // Refresh the eval for the human's benefit.
  scheduleEvalRefresh();
}

/* ========================================================================== */
/*  Game end                                                                  */
/* ========================================================================== */

function finishGame() {
  state.gameOver = true;
  setBusy(false);
  clearSelection();
  renderAll();

  const chess = state.chess;
  let title = 'Game over';
  let text = '';
  let humanOutcome = 'draw';

  if (chess.isCheckmate()) {
    const winner = otherColor(chess.turn());
    const loser = chess.turn();
    title = `Checkmate! ${colorName(winner)} wins`;
    text = `${colorName(loser)}'s king is trapped and cannot escape. Great game!`;

    if (state.mode === 'computer') {
      humanOutcome = winner === state.playerColor ? 'win' : 'loss';
      text = winner === state.playerColor
        ? 'You trapped the computer\'s king. Brilliant work!'
        : 'The computer got your king this time. Try again — you are learning fast!';
    }
  } else if (chess.isStalemate()) {
    title = 'Stalemate — it\'s a draw';
    text = 'Nobody can move, but nobody is in check. It is a tie!';
  } else if (chess.isInsufficientMaterial()) {
    title = 'Draw — not enough pieces';
    text = 'There are not enough pieces left to checkmate. It is a tie!';
  } else if (chess.isThreefoldRepetition()) {
    title = 'Draw — same position three times';
    text = 'The same position happened three times, so the game is a tie.';
  } else if (chess.isDraw()) {
    title = 'Draw';
    text = 'The game ended in a tie.';
  }

  if (humanOutcome === 'win') sfx.win();
  else if (humanOutcome === 'loss') sfx.lose();

  showBanner(title, 'good');
  addBubble({ tier: 'info', title: 'Game over', text: `${title}. ${text}` });

  dom.resultTitle.textContent = title;
  dom.resultText.textContent = text;
  dom.resultDialog.hidden = false;
  setTimeout(() => $('#result-again')?.focus(), 30);
}

/* ========================================================================== */
/*  New game / undo / resign / hint / flip                                    */
/* ========================================================================== */

function newGame() {
  state.chess = new state.Chess();
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.hint = null;
  state.cursor = 'e2';
  state.gameOver = false;
  state.history = [];
  state.evalCp = 0;
  state.hintCount = 0;
  state.busy = false;
  state.playerColor = 'w';
  state.flipped = false;

  dom.coachFeed.innerHTML = '';
  dom.resultDialog.hidden = true;
  dom.promotionDialog.hidden = true;
  dom.moveList.innerHTML = '';
  dom.moveCount.textContent = '0';
  showBanner('');

  addBubble({
    tier: 'info',
    title: 'New game',
    text: `You are playing ${colorName(state.playerColor)}. ${openingTip()}`
  });

  renderAll();
  updateEngineDifficulty();

  if (state.mode === 'computer' && state.chess.turn() !== state.playerColor) {
    computerMove();
  }
}

function undo() {
  if (state.busy || state.history.length === 0) return;

  // In vs-computer mode, undo the pair so it's the human's turn again.
  const pairs = state.mode === 'computer' && state.history.length >= 2 ? 2 : 1;
  for (let i = 0; i < pairs; i++) {
    state.chess.undo();
    state.history.pop();
  }

  state.gameOver = false;
  state.lastMove = null;
  state.hint = null;
  clearSelection();
  dom.resultDialog.hidden = true;
  showBanner('');

  const last = state.history[state.history.length - 1];
  state.lastMove = last ? { from: last.move.from, to: last.move.to } : null;

  // If after undoing it is still the computer's turn, let it move.
  renderAll();
  addBubble({ tier: 'info', text: 'Undone! Take another look and try a different idea.' });

  if (state.mode === 'computer' && state.chess.turn() !== state.playerColor && !state.gameOver) {
    computerMove();
  } else {
    scheduleEvalRefresh();
  }
}

function resign() {
  if (state.gameOver) return;
  let winner;
  if (state.mode === 'computer') {
    winner = otherColor(state.playerColor);
  } else {
    winner = state.chess.turn();
  }
  state.gameOver = true;
  const title = `${colorName(winner)} wins by resignation`;
  const text = 'Thanks for playing! Starting a new game is easy — just press New Game.';
  showBanner(title, 'good');
  addBubble({ tier: 'info', title: 'Resignation', text });
  dom.resultTitle.textContent = title;
  dom.resultText.textContent = text;
  dom.resultDialog.hidden = false;
}

async function hint() {
  if (!isHumanTurn() || state.busy || state.gameOver) return;
  setBusy(true, 'Looking for a good move…');
  try {
    const moves = await state.engine.rankedMoves(state.chess, { depth: 6, count: 1 });
    if (moves && moves.length) {
      const m = moves[0];
      state.hint = { from: m.from, to: m.to };
      const san = sanFor(m);
      addBubble({
        tier: 'info',
        title: 'Hint',
        move: san,
        text: describeHint({ san, from: m.from, to: m.to, moveNumber: state.history.length + 1 })
      });
    } else {
      addBubble({ tier: 'info', title: 'Hint', text: 'I could not find a good move — try looking for a piece you can protect or a square in the centre.' });
    }
  } catch {
    addBubble({ tier: 'info', title: 'Hint', text: 'Hmm, the engine is busy. Try again in a moment.' });
  }
  setBusy(false);
  renderBoard();
}

function sanFor(uciMove) {
  try {
    const clone = new state.Chess(state.chess.fen());
    const m = clone.move({ from: uciMove.from, to: uciMove.to, promotion: uciMove.promotion || 'q' });
    return m ? m.san : `${uciMove.from}-${uciMove.to}`;
  } catch {
    return `${uciMove.from}-${uciMove.to}`;
  }
}

function flip() {
  state.flipped = !state.flipped;
  renderAll();
}

/* ========================================================================== */
/*  Settings wiring                                                           */
/* ========================================================================== */

function updateEngineDifficulty() {
  if (state.engine) {
    state.engine.setDifficulty(state.difficulty).catch(() => {});
  }
  if (state.mode === 'computer') {
    dom.difficultyGroup.style.display = '';
  } else {
    dom.difficultyGroup.style.display = 'none';
  }
}

function bindSettings() {
  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.checked = el.value === state.mode;
    el.addEventListener('change', () => {
      if (!el.checked) return;
      state.mode = el.value;
      savePrefs();
      newGame();
    });
  });

  document.querySelectorAll('input[name="difficulty"]').forEach((el) => {
    el.checked = el.value === state.difficulty;
    el.addEventListener('change', () => {
      if (!el.checked) return;
      state.difficulty = el.value;
      savePrefs();
      updateEngineDifficulty();
      addBubble({
        tier: 'info',
        title: 'Difficulty',
        text: `Computer set to **${DIFFICULTIES[state.difficulty].label}**. ${state.difficulty === 'challenger' ? 'Good luck — this one is tough!' : state.difficulty === 'beginner' ? 'This one is friendly and makes mistakes.' : 'A fair, solid opponent.'}`
      });
      renderCaptures();
    });
  });

  const coachToggle = $('#opt-coach');
  coachToggle.checked = state.coachOn;
  coachToggle.addEventListener('change', () => {
    state.coachOn = coachToggle.checked;
    savePrefs();
    if (state.coachOn) addBubble({ tier: 'info', text: 'Coach is back on. I will explain each move for you.' });
  });

  const animToggle = $('#opt-animations');
  animToggle.checked = state.animations;
  applyAnimations();
  animToggle.addEventListener('change', () => {
    state.animations = animToggle.checked;
    applyAnimations();
    savePrefs();
  });

  const flipToggle = $('#opt-autoplay');
  flipToggle.checked = state.autoFlip;
  flipToggle.addEventListener('change', () => {
    state.autoFlip = flipToggle.checked;
    savePrefs();
  });

  const soundToggle = $('#opt-sound');
  soundToggle.checked = state.sound;
  soundToggle.addEventListener('change', () => {
    state.sound = soundToggle.checked;
    savePrefs();
    if (state.sound) beep(660, 0.08, 'sine');
  });
}

function applyAnimations() {
  document.body.classList.toggle('animations-enabled', state.animations);
}

/* ========================================================================== */
/*  Keyboard support                                                          */
/* ========================================================================== */

function bindKeyboard() {
  const moveCursor = (dx, dy) => {
    const order = visualOrder();
    const idx = order.indexOf(state.cursor);
    if (idx === -1) return;
    const col = idx % 8;
    const row = Math.floor(idx / 8);
    const nCol = Math.max(0, Math.min(7, col + dx));
    const nRow = Math.max(0, Math.min(7, row + dy));
    state.cursor = order[nRow * 8 + nCol];
    renderBoard();
    squareEl(state.cursor)?.focus();
  };

  dom.board.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveCursor(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); moveCursor(1, 0); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(0, -1); break;
      case 'ArrowDown': e.preventDefault(); moveCursor(0, 1); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSquareClick(state.cursor);
        break;
      case 'Escape':
        clearSelection();
        renderBoard();
        break;
      case 'h':
      case 'H':
        e.preventDefault();
        hint();
        break;
      default:
        break;
    }
  });

  dom.board.addEventListener('focus', () => {
    squareEl(state.cursor)?.focus();
  }, { once: true });
}

/* ==========================================================================
   Coach placement
   ==========================================================================
   On wide screens the Coach lives in the right-hand sidebar. On narrow
   portrait screens (phones, iPad portrait in a split view) it must sit
   ABOVE the board so a child sees the advice without scrolling. `order` on
   flex/grid items cannot achieve that because the Coach card's parent is
   the sidebar, a sibling of the board region — so we move the node itself
   in JavaScript.
   ========================================================================== */

const coachCard = document.querySelector('.coach-card');
const sidePanel = document.querySelector('.side-panel');
const boardRegion = document.querySelector('.board-region');
const coachHome = coachCard ? coachCard.nextElementSibling : null;
const wideQuery = window.matchMedia('(min-width: 1041px)');

function placeCoach() {
  if (!coachCard || !sidePanel || !boardRegion) return;
  if (wideQuery.matches) {
    // Back into the sidebar, directly after the Coach heading area.
    if (coachCard.parentElement !== sidePanel) {
      sidePanel.insertBefore(coachCard, sidePanel.firstElementChild);
    }
  } else if (coachCard.parentElement !== boardRegion.parentElement) {
    // Above the board, inside the main column.
    boardRegion.parentElement.insertBefore(coachCard, boardRegion);
  }
}

function bindCoachPlacement() {
  placeCoach();
  if (typeof wideQuery.addEventListener === 'function') {
    wideQuery.addEventListener('change', placeCoach);
  } else if (typeof wideQuery.addListener === 'function') {
    wideQuery.addListener(placeCoach);   // older Safari
  }
}

/* ========================================================================== */
/*  Boot                                                                      */
/* ========================================================================== */

async function boot() {
  cacheDom();
  buildBoard();
  loadPrefs();
  applyAnimations();

  try {
    state.Chess = await loadChessJs();
  } catch {
    showBanner('Could not load the chess rules library. Please check your internet connection and reload.', 'check');
    dom.statusText.textContent = 'chess.js failed to load.';
    dom.statusLight.className = 'status-light warn';
    return;
  }

  state.chess = new state.Chess();

  // ---- Engine ----
  state.engine = new Engine({
    Chess: state.Chess,
    getChess: () => state.chess,
    onStatus: (kind, msg) => {
      dom.statusText.textContent = msg;
      dom.statusLight.className = 'status-light ' +
        (kind === 'ready' ? 'ok' : kind === 'fallback' ? 'warn' : 'busy');
    }
  });

  // ---- Wire controls ----
  dom.board.addEventListener('click', (e) => {
    const sq = e.target.closest('.square');
    if (sq) onSquareClick(sq.dataset.square);
  });

  dom.btnNew.addEventListener('click', newGame);
  dom.btnUndo.addEventListener('click', undo);
  dom.btnHint.addEventListener('click', hint);
  dom.btnFlip.addEventListener('click', flip);
  dom.btnResign.addEventListener('click', resign);
  $('#promo-cancel').addEventListener('click', closePromotionDialog);
  $('#result-again').addEventListener('click', () => { dom.resultDialog.hidden = true; newGame(); });
  $('#result-close').addEventListener('click', () => { dom.resultDialog.hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.promotionDialog.hidden) closePromotionDialog();
  });

  bindSettings();
  bindKeyboard();
  bindCoachPlacement();
  renderAll();

  // Start the first game immediately so the board is playable while the
  // engine is still warming up.
  newGame();

  // ---- Load engine in the background ----
  const kind = await state.engine.init();
  updateEngineDifficulty();

  if (kind === 'pocket') {
    addBubble({
      tier: 'info',
      title: 'Offline mode',
      text: 'There is no internet right now, so I am using a simple built-in player. Everything still works!'
    });
  } else {
    addBubble({
      tier: 'info',
      title: 'Engine ready',
      text: 'The chess engine has finished loading. Ask for a hint any time!'
    });
  }

  // If it was the computer's turn while the engine loaded, get things going.
  if (state.mode === 'computer' && state.chess.turn() !== state.playerColor && !state.gameOver) {
    computerMove();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* Expose a tiny debug surface for smoke tests. */
window.__chessClub = { state, get dom() { return dom; } };
