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
import { DRILL_IDS, DRILL_LABELS, makePuzzle, isSolved, levelForStreak } from './src/drills.js';

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

mode: 'computer',          // 'computer' | 'human' | 'practice'
  difficulty: 'beginner',
  playerColor: 'w',          // human colour in vs-computer
  drill: 'free-piece',       // active practice drill

  flipped: false,
  autoFlip: true,
  coachOn: true,
  animations: false,
  sound: false,

  puzzle: null,              // current practice puzzle ({drill, fen, goal, ...})
  solved: false,             // current puzzle won (board frozen until next)
  misses: 0,                 // wrong tries on the current puzzle
  puzzleTimer: null,         // timeout that advances to the next puzzle
  solveStreak: 0,            // puzzles solved in a row (session-only)
  drillLevel: 1,             // 1 easy · 2 hard · 3 expert, auto-scaled by streak

  selected: null,            // square name of the currently selected piece
  legalTargets: [],          // [{to, capture}]
  lastMove: null,            // {from, to}
  hint: null,                // {from, to}
  cursor: 'e2',              // keyboard cursor square

  busy: false,               // engine thinking / animating
  gameOver: false,
  generation: 0,             // bumped by newGame(); async work compares against it
  history: [],               // { san, fenBefore, fenAfter, color, move }
  evalCp: 0,                 // centipawns, white's perspective
  evalFen: null,             // the position evalCp describes (null = unknown)
  started: false,
pendingPromotion: null
};

/**
 * Every asynchronous continuation that can outlive its game calls this.
 *
 * `newGame()` bumps `state.generation`, so a reply from an engine search (or a
 * coach evaluation) that started before the reset is discarded instead of being
 * applied to the brand-new position. Without it, a stale computer move was
 * replayed onto the fresh board, failed as illegal, and immediately ended the
 * new game (see computerMove()).
 */
function isStale(generation) {
  return generation !== state.generation;
}

/* LocalStorage key for remembered preferences */
const PREFS_KEY = 'chessclub.prefs.v1';

function savePrefs() {
  try {
localStorage.setItem(PREFS_KEY, JSON.stringify({
      mode: state.mode,
      difficulty: state.difficulty,
      playerColor: state.playerColor,
      autoFlip: state.autoFlip,
      coachOn: state.coachOn,
      animations: state.animations,
      sound: state.sound,
      drill: state.drill
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
    if (p.playerColor === 'w' || p.playerColor === 'b') state.playerColor = p.playerColor;
    if (typeof p.autoFlip === 'boolean') state.autoFlip = p.autoFlip;
    if (typeof p.coachOn === 'boolean') state.coachOn = p.coachOn;
if (typeof p.animations === 'boolean') state.animations = p.animations;
    if (typeof p.sound === 'boolean') state.sound = p.sound;
    if (DRILL_IDS.includes(p.drill)) state.drill = p.drill;
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
  dom.moveArrow = $('#move-arrow');
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
  dom.colourGroup = $('#colour-group');
dom.promotionDialog = $('#promotion-dialog');
  dom.promoChoices = $('#promo-choices');
  dom.resultDialog = $('#result-dialog');
  dom.resultTitle = $('#result-title');
  dom.resultText = $('#result-text');
  dom.puzzlePrompt = $('#puzzle-prompt');
  dom.drillGroup = $('#drill-group');
}

/* ========================================================================== */
/*  Board rendering                                                           */
/* ========================================================================== */

/**
 * Build the 8x8 board.
 *
 * The squares live inside real `role="row"` elements. A `role="grid"` whose
 * children are gridcells with no rows in between is invalid, and assistive tech
 * is entitled to ignore the structure it cannot make sense of — so the rows are
 * part of the markup rather than implied by the visual layout.
 */
function buildBoard() {
  dom.board.innerHTML = '';
  const rows = [];
  for (let r = 0; r < 8; r++) {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.setAttribute('role', 'row');
    rows.push(row);
    dom.board.appendChild(row);
  }
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
      rows[r].appendChild(btn);
    }
  }
  laidOutFlipped = null;     // let layoutBoard() place them for the current flip
  layoutBoard();
}

/** The orientation the DOM is currently laid out for. */
let laidOutFlipped = null;

/** The 8 row elements, in on-screen order. */
function boardRows() {
  return [...dom.board.querySelectorAll('.board-row')];
}

/**
 * Draw the arrow marking the last move.
 *
 * The engine answers almost instantly, so without this the reply reads as
 * "something changed somewhere on the board". Decorative only — the move is
 * already announced in the coach feed and listed under "Move list", hence
 * aria-hidden in the markup.
 *
 * Everything is in board units: the SVG's viewBox is 0 0 8 8 with
 * preserveAspectRatio="none", so one unit is exactly one square. Nothing has to
 * be measured, and because the centres come from the same visual order the
 * squares are laid out in, it stays correct when the board is flipped.
 */
function drawMoveArrow() {
  const arrow = dom.moveArrow;
  if (!arrow) return;

  const move = state.lastMove;
  const order = visualOrder();
  const from = move ? order.indexOf(move.from) : -1;
  const to = move ? order.indexOf(move.to) : -1;
  // NB: `hidden` is an HTMLElement property and SVGElement does not have it, so
  // the attribute must be toggled directly — assigning `arrow.hidden` would only
  // set a JS expando and style.css would still hide it.
  if (from === -1 || to === -1) {
    arrow.setAttribute('hidden', '');
    return;
  }
  arrow.removeAttribute('hidden');

  const centre = (i) => ({ x: (i % 8) + 0.5, y: Math.floor(i / 8) + 0.5 });
  const a = centre(from);
  const b = centre(to);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  const TAIL = 0.18;   // start the line clear of the piece that moved
  const HEAD = 0.26;   // arrowhead length
  const HALF = 0.155;  // arrowhead half-width (kept modest so the piece the
                       // arrow points at stays readable through it)

  const start = { x: a.x + ux * TAIL, y: a.y + uy * TAIL };
  const end = { x: b.x - ux * HEAD, y: b.y - uy * HEAD };
  const nx = -uy;      // unit normal, for the head's two back corners
  const ny = ux;
  const r = (n) => n.toFixed(3);

  for (const cls of ['.move-arrow-casing', '.move-arrow-line']) {
    const line = arrow.querySelector(cls);
    line.setAttribute('x1', r(start.x));
    line.setAttribute('y1', r(start.y));
    line.setAttribute('x2', r(end.x));
    line.setAttribute('y2', r(end.y));
  }
  const head = [
    `${r(b.x)},${r(b.y)}`,
    `${r(end.x + nx * HALF)},${r(end.y + ny * HALF)}`,
    `${r(end.x - nx * HALF)},${r(end.y - ny * HALF)}`
  ].join(' ');
  arrow.querySelector('.move-arrow-head').setAttribute('points', head);
  arrow.querySelector('.move-arrow-head-casing').setAttribute('points', head);
}

/**
 * Put every square in the row it belongs to for the current orientation.
 *
 * Because the rows are real `role="row"` elements, the DOM order has to match
 * what is on screen — otherwise the accessibility tree would announce the wrong
 * squares after a flip. That is why flipping re-appends nodes instead of
 * shuffling them with CSS `order`, which would leave the structure describing a
 * different board from the one being displayed.
 */
function layoutBoard() {
  if (laidOutFlipped === state.flipped) return;

  // Moving a node with appendChild drops focus from it, so remember where the
  // keyboard was and put it back afterwards — otherwise a flip would silently
  // end keyboard play (the board's key handling needs focus on a square).
  const focused = document.activeElement;
  const focusedSquare = (focused && focused.dataset && focused.dataset.square) || null;
  const focusedBoard = focused === dom.board;

  const rows = boardRows();
  visualOrder().forEach((name, idx) => {
    const el = squareEl(name);
    if (el) rows[Math.floor(idx / 8)].appendChild(el);
  });
  laidOutFlipped = state.flipped;

  if (focusedSquare) squareEl(focusedSquare)?.focus();
  else if (focusedBoard) dom.board.focus();
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
  layoutBoard();
  drawMoveArrow();
  const order = visualOrder();
  const board = state.chess.board();   // board[0] is rank 8
  const turn = state.chess.turn();
  const checkedKing = state.chess.isCheck() ? findKing(board, turn) : null;
  const hint = state.hint;

  order.forEach((name, idx) => {
    const el = squareEl(name);
    if (!el) return;

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
    if (isBottomEdge) {
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

// Determine who sits at the top.
  let topColor, bottomColor, topName, bottomName;
  if (state.mode === 'practice') {
    // The solver always plays the winning side (White) from the bottom.
    topColor = 'b';
    bottomColor = 'w';
    topName = 'Puzzle';
    bottomName = 'You';
  } else if (state.mode === 'human') {
    topColor = state.flipped ? 'w' : 'b';
    bottomColor = otherColor(topColor);
    topName = colorName(topColor);
    bottomName = colorName(bottomColor);
  } else {
    const humanColor = state.playerColor;
    // Orientation decides which colour is physically at the bottom, including
    // when the player chooses Black.
    bottomColor = state.flipped ? 'b' : 'w';
    topColor = otherColor(bottomColor);
    topName = topColor === humanColor ? 'You' : `Computer (${DIFFICULTIES[state.difficulty].label})`;
    bottomName = bottomColor === humanColor ? 'You' : `Computer (${DIFFICULTIES[state.difficulty].label})`;
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
  if (state.mode === 'practice') {
    // No engine evaluation in drills — reuse the meter to show the goal.
    dom.evalFill.style.width = '50%';
    dom.evalLabel.textContent = state.solved ? 'Solved!' : `Drill: ${DRILL_LABELS[state.drill]}`;
    return;
  }
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
  const practice = state.mode === 'practice';
  const myTurn = state.mode === 'computer'
    ? turn === state.playerColor
    : true;
  dom.btnUndo.disabled = state.history.length === 0 || state.busy || practice;
  dom.btnHint.disabled = state.busy || state.gameOver || !myTurn || (practice && state.solved);
  dom.btnResign.disabled = state.gameOver || state.busy || practice;
  dom.btnFlip.disabled = practice;
  dom.btnNew.disabled = false;
  dom.btnNew.textContent = practice ? 'New Puzzle' : 'New Game';
}

function renderPuzzlePrompt() {
  const el = dom.puzzlePrompt;
  if (!el) return;
  if (state.mode !== 'practice') {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  const p = state.puzzle;
  if (state.solved) {
    el.textContent = 'Solved! Next puzzle is on its way…';
  } else if (p) {
    const head = p.level ? `Level ${p.level} · ` : '';
    const tail = state.solveStreak >= 3 ? ` · Streak ${state.solveStreak}` : '';
    el.textContent = `${head}${p.caption}${tail}`;
  } else {
    el.textContent = 'Preparing a puzzle…';
  }
}

function renderAll() {
  renderBoard();
  renderCaptures();
  renderMoveList();
  renderEval();
  renderStatus();
  renderPuzzlePrompt();
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
  if (state.mode === 'practice') return !state.solved && !state.busy;
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
  if (state.mode === 'practice' && state.solved) return;

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
  if (state.mode === 'practice') {
    judgePuzzleMove(move, fenBefore);
    return;
  }

  if (state.chess.isGameOver()) {
    finishGame();
    return;
  }

  const generation = state.generation;

  // Hand over to the computer if it is its turn.
  if (state.mode === 'computer' && state.chess.turn() !== state.playerColor) {
    // Start both analyses now instead of one strictly after the other. They
    // share a single engine, which queues them (see UciProcess.enqueue), and
    // the coach's evaluation is requested first, so its bubble is still
    // rendered before the reply is applied. The reply's e-ink paint yield now
    // overlaps the coach's search instead of sitting in front of it.
    const review = state.coachOn ? coachReviewPlayedMove(move, fenBefore) : null;
    const reply = computeComputerMove();

    if (review) await review;
    if (isStale(generation)) return;
    applyComputerMove(await reply);
    if (isStale(generation)) return;
  } else if (state.coachOn) {
    await coachReviewPlayedMove(move, fenBefore);
    if (isStale(generation)) return;
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

/**
 * The evaluation of `fen` in centipawns from White's point of view.
 *
 * The position *before* a move is exactly the position the previous step already
 * evaluated (the previous move's "after"), so from the second move on the coach
 * needs no engine search for it — which halves the coach's engine cost. The
 * cache is keyed by FEN, so a miss simply re-evaluates; a stale entry can never
 * produce a wrong number.
 */
async function evaluateForFen(fen) {
  if (state.evalFen === fen) return state.evalCp;
  return state.engine.evaluate(new state.Chess(fen), { depth: 8, timeoutMs: 2000 });
}

/** Record that `state.evalCp` now describes `fen`. */
function cacheEval(fen, cp) {
  state.evalFen = fen;
  state.evalCp = cp;
}

function scheduleEvalRefresh() {
  if (!state.engine) return;
  const generation = state.generation;
  const fen = state.chess.fen();
  state.engine.evaluate(state.chess, { depth: 8, timeoutMs: 1800 })
    .then((cp) => {
      if (isStale(generation)) return;
      cacheEval(fen, cp);
      renderEval();
    })
    .catch(() => { /* ignore */ });
}

/* ========================================================================== */
/*  Promotion dialog                                                          */
/* ========================================================================== */

/* ========================================================================== */
/*  Modal dialogs                                                             */
/* ========================================================================== */

/**
 * Take everything except the open dialog out of play.
 *
 * `aria-modal` only *claims* the rest is inert; the `inert` attribute makes it
 * true, for the keyboard and for assistive technology alike.
 */
function setBackgroundInert(inert) {
  for (const el of document.body.children) {
    if (el === dom.promotionDialog || el === dom.resultDialog) continue;
    if (el.tagName === 'SCRIPT') continue;
    if (inert) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
}

/** Focusable, currently-visible controls inside `root`. */
function focusableIn(root) {
  const selector = 'button:not([disabled]), [href], input:not([disabled]), '
    + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll(selector)].filter((el) => el.getClientRects().length > 0);
}

/** Whichever dialog is open right now, or null. */
function openDialogEl() {
  if (!dom.promotionDialog.hidden) return dom.promotionDialog;
  if (!dom.resultDialog.hidden) return dom.resultDialog;
  return null;
}

/** Give the keyboard back to the board, on the square the cursor is on. */
function restoreBoardFocus() {
  const square = squareEl(state.cursor);
  if (square) square.focus();
  else dom.board.focus();
}

function openDialog(dialog, focusTarget) {
  dialog.hidden = false;
  setBackgroundInert(true);
  const target = focusTarget || focusableIn(dialog)[0];
  if (target) target.focus();
}

function closeDialog(dialog) {
  if (dialog.hidden) return;      // already closed: leave focus alone
  dialog.hidden = true;
  if (dialog === dom.promotionDialog) state.pendingPromotion = null;
  setBackgroundInert(false);
  restoreBoardFocus();
}

/** Escape closes a dialog, and Tab cycles within it instead of escaping. */
function onDialogKeydown(e) {
  const dialog = openDialogEl();
  if (!dialog) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDialog(dialog);
    return;
  }
  if (e.key !== 'Tab') return;

  const items = focusableIn(dialog);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !dialog.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
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
      closeDialog(dom.promotionDialog);
      attemptMove(from, to, type);
    });
    dom.promoChoices.appendChild(btn);
  }
  openDialog(dom.promotionDialog);
}

function closePromotionDialog() {
  closeDialog(dom.promotionDialog);
}

/* ========================================================================== */
/*  Coach logic                                                               */
/* ========================================================================== */

async function bestMoveLoss(chess, playedMove, fenBefore) {
  // Request BOTH evaluations up front. On a cache hit the "before" value costs
  // no engine call at all; on a miss the two are queued back-to-back, which
  // keeps the coach's verdict ahead of the concurrently-requested reply search
  // instead of letting that search jump the queue.
  const beforePromise = evaluateForFen(fenBefore);
  const afterPromise = state.engine.evaluate(chess, { depth: 8, timeoutMs: 2000 });
  // Both are requested up front, so make sure neither can become an unhandled
  // rejection if the other one fails first. Attaching a handler does not stop
  // the `await`s below from seeing the error.
  beforePromise.catch(() => {});
  afterPromise.catch(() => {});
  const before = await beforePromise;
  const after = await afterPromise;

  // `evaluate` returns White-perspective centipawns.
  const moverIsWhite = playedMove.color === 'w';
  const delta = moverIsWhite ? (after - before) : (before - after);
  const loss = Math.max(0, -delta);
  return { before, after, loss };
}

async function coachReviewPlayedMove(move, fenBefore) {
  const generation = state.generation;
  try {
    const { loss, after } = await bestMoveLoss(state.chess, move, fenBefore);
    if (isStale(generation)) return;
    cacheEval(state.chess.fen(), after);
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
    case 'okay':          // shares the "solid" styling; no separate rule needed
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

/**
 * Work out the computer's reply.
 *
 * This is started concurrently with the coach's review; the engine queues the
 * two searches so neither can corrupt the other's result (see
 * UciProcess.enqueue).
 *
 * @returns {Promise<{from:string,to:string,promotion?:string}|null|undefined>}
 *   the move, `null` when there is no legal move, or `undefined` when the game
 *   changed underneath us and the result must be discarded.
 */
async function computeComputerMove() {
  if (state.gameOver) return undefined;
  if (state.mode !== 'computer') return undefined;
  if (state.chess.turn() === state.playerColor) return undefined;

  const generation = state.generation;
  try {
    setBusy(true, 'Computer is thinking…');
    // Yield a frame so the overlay paints (important on slow e-ink). This now
    // overlaps the coach's search rather than delaying the reply.
    await sleep(40);
    if (isStale(generation)) return undefined;   // a New Game landed while we waited

    let move = null;
    try {
      move = await state.engine.bestMove(state.chess, { difficulty: state.difficulty });
    } catch {
      move = null;
    }

    // Discard the reply if the game changed while the engine was thinking. The
    // move was computed for a position that no longer exists; applying it to
    // the new one made it illegal and killed the fresh game. `newGame()` has
    // already cleared `busy`, so there is nothing to unwind here.
    if (isStale(generation)) return undefined;

    if (!move) {
      // Absolute last resort: pick any legal move so we never deadlock.
      const legal = state.chess.moves({ verbose: true });
      if (legal.length) {
        const m = legal[Math.floor(Math.random() * legal.length)];
        move = { from: m.from, to: m.to, promotion: m.promotion };
      }
    }

    return move;
  } catch {
    // Never leave the spinner up if something unforeseen goes wrong.
    setBusy(false);
    return undefined;
  }
}

/** Put the computer's reply on the board, or end the game if there is none. */
function applyComputerMove(move) {
  if (move === undefined) return;   // superseded — nothing to apply

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

/**
 * Compute and apply the reply in one step — used by newGame(), undo() and
 * boot(), where there is no coach review to interleave with.
 */
async function computerMove() {
  applyComputerMove(await computeComputerMove());
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
  openDialog(dom.resultDialog, $('#result-again'));
}

/* ========================================================================== */
/*  New game / undo / resign / hint / flip                                    */
/* ========================================================================== */

function newGame() {
  // Invalidate any engine search or coach evaluation still in flight, so its
  // reply cannot be applied to this game (see isStale()).
  state.generation += 1;

  state.chess = new state.Chess();
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.hint = null;
  state.cursor = 'e2';
  state.gameOver = false;
  state.history = [];
  state.solved = false;
  state.misses = 0;
  clearTimeout(state.puzzleTimer);
  state.puzzle = null;
  cacheEval(null, 0);        // no known evaluation yet; recomputed on first use
state.busy = false;
  state.flipped = state.mode === 'computer' && state.playerColor === 'b';

  dom.coachFeed.innerHTML = '';
  closeDialog(dom.resultDialog);
  closeDialog(dom.promotionDialog);
  dom.moveList.innerHTML = '';
  dom.moveCount.textContent = '0';
  showBanner('');
  renderPuzzlePrompt();

  if (state.mode === 'practice') {
    newPuzzle();
    return;
  }

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

/* ========================================================================== */
/*  Practice drills                                                           */
/* ========================================================================== */

const PRAISE = {
  'free-piece': 'You are spotting hanging pieces like a pro!',
  'mate-one': 'You are learning to spot checkmating moves!'
};

const puzzleSeen = new Set();   // FENs already shown this session, so drills stay varied

const LEVEL_NAMES = { 1: 'easy', 2: 'hard', 3: 'expert' };

/** Move the solve streak and, when it crosses a level threshold, level up the
 *  puzzle difficulty and announce it. Streak is session-only on purpose. */
function bumpStreak(delta) {
  state.solveStreak = delta === 0 ? 0 : Math.max(0, state.solveStreak + delta);
  const level = levelForStreak(state.solveStreak);
  if (level !== state.drillLevel) {
    state.drillLevel = level;
    if (delta > 0) {
      addBubble({ tier: 'success', title: 'Level up!', text: `You are on a roll — puzzles are now **${LEVEL_NAMES[level]}**!` });
    }
  }
}

function newPuzzle() {
  state.puzzle = makePuzzle(state.Chess, state.drill, { seen: puzzleSeen, level: state.drillLevel });
  const p = state.puzzle;
  if (!p) return;

  state.chess = new state.Chess(p.fen);
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.hint = null;
  state.gameOver = false;
  state.history = [];
  state.solved = false;
  state.misses = 0;
  clearTimeout(state.puzzleTimer);
  cacheEval(null, 0);
  state.busy = false;
  state.flipped = false;          // solver (White) always sits at the bottom

  showBanner('');
  renderPuzzlePrompt();
  addBubble({ tier: 'info', title: DRILL_LABELS[state.drill], text: p.goal });
  renderAll();
  updateEngineDifficulty();
}

function judgePuzzleMove(move, fenBefore) {
  const p = state.puzzle;
  if (!p) return;

  if (isSolved(state.Chess, p, fenBefore, state.chess, move)) {
    bumpStreak(1);
    state.solved = true;
    sfx.win();
    showBanner('Solved!', 'good');
    renderPuzzlePrompt();
    updateControls();
    if (p.drill === 'mate-one') {
      addBubble({ tier: 'success', title: 'Checkmate!', text: `Brilliant! ${p.targetSan} traps the king. ${PRAISE[p.drill]}` });
    } else {
      addBubble({ tier: 'success', title: 'Solved!', text: `You took the ${PIECE_NAMES[move.captured]} — it really was all alone. ${PRAISE[p.drill]}` });
    }
    state.puzzleTimer = setTimeout(newPuzzle, 3200);
    return;
  }

  // Wrong idea: take the move straight back and let them try again.
  state.misses += 1;
  state.chess.undo();
  state.history.pop();
  const last = state.history[state.history.length - 1];
  state.lastMove = last ? { from: last.move.from, to: last.move.to } : null;

  if (state.misses >= 3) {
    revealPuzzleSolution();
    return;
  }
  renderAll();
  addBubble({
    tier: 'info',
    title: 'Not quite',
    text: p.drill === 'mate-one'
      ? 'That move does not finish the game. Look for one that traps the king — maybe a check on the back rank.'
      : 'That piece was not the free one. Find the enemy piece with nobody protecting it.'
  });
}

function revealPuzzleSolution() {
  const p = state.puzzle;
  if (!p || state.solved) return;
  bumpStreak(0);   // solve streak does not survive giving up
  try {
    const t = p.target;
    const m = state.chess.move({ from: t.from, to: t.to, promotion: 'q' });
    state.lastMove = { from: m.from, to: m.to };
    state.history.push({
      san: m.san,
      fenBefore: p.fen,
      fenAfter: state.chess.fen(),
      color: m.color,
      move: m
    });
    if (m.captured) sfx.capture();
    state.solved = true;
    showBanner('Here is how!', 'good');
    renderPuzzlePrompt();
    updateControls();
    addBubble({ tier: 'success', title: 'Solution', move: m.san, text: `${p.hint} ${p.drill === 'mate-one' ? 'That is checkmate!' : 'Remember this pattern — always scan for lonely pieces.'}` });
    state.puzzleTimer = setTimeout(newPuzzle, 4000);
  } catch {
    // never crash the board over a hint; the human can keep trying
    renderAll();
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
  closeDialog(dom.resultDialog);
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
  openDialog(dom.resultDialog, $('#result-again'));
}

async function hint() {
  if (!isHumanTurn() || state.busy || state.gameOver) return;
  if (state.mode === 'practice') {
    revealPuzzleSolution();
    return;
  }
  const generation = state.generation;
  setBusy(true, 'Looking for a good move…');
  try {
    const moves = await state.engine.rankedMoves(state.chess, { depth: 6, count: 1 });
    // A New Game during the search: newGame() already cleared `busy`.
    if (isStale(generation)) return;
    if (moves && moves.length) {
      const m = moves[0];
      state.hint = { from: m.from, to: m.to };
      const san = sanFor(m);
      const details = hintDetailsFor(m);
      addBubble({
        tier: 'info',
        title: 'Hint',
        move: san,
        text: describeHint({ san, from: m.from, to: m.to, tier: 'best', details })
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

/** Board facts for a hint, so the coach explains its purpose rather than only
 * naming two squares. The clone keeps the live game completely untouched. */
function hintDetailsFor(uciMove) {
  try {
    const clone = new state.Chess(state.chess.fen());
    const move = clone.move({ from: uciMove.from, to: uciMove.to, promotion: uciMove.promotion || 'q' });
    if (!move) return {};
    return {
      piece: move.piece,
      wasCapture: !!move.captured,
      capturedPiece: move.captured || null,
      wasCheck: /[+#]/.test(move.san),
      wasCastle: move.flags.includes('k') || move.flags.includes('q'),
      isDevelopment: !move.captured && (move.piece === 'n' || move.piece === 'b') &&
        HOME_RANK_FOR(move.color).includes(move.from)
    };
  } catch {
    return {};
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
  const practice = state.mode === 'practice';
  if (practice) {
    dom.difficultyGroup.style.display = 'none';
    dom.colourGroup.style.display = 'none';
    dom.drillGroup.style.display = '';
  } else if (state.mode === 'computer') {
    dom.difficultyGroup.style.display = '';
    dom.colourGroup.style.display = '';
    dom.drillGroup.style.display = 'none';
  } else {
    dom.difficultyGroup.style.display = 'none';
    dom.colourGroup.style.display = 'none';
    dom.drillGroup.style.display = 'none';
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

document.querySelectorAll('input[name="player-colour"]').forEach((el) => {
    el.checked = el.value === state.playerColor;
    el.addEventListener('change', () => {
      if (!el.checked || state.mode !== 'computer') return;
      state.playerColor = el.value;
      savePrefs();
      newGame();
    });
  });

  document.querySelectorAll('input[name="drill"]').forEach((el) => {
    el.checked = el.value === state.drill;
    el.addEventListener('change', () => {
      if (!el.checked || state.mode !== 'practice') return;
      state.drill = el.value;
      savePrefs();
      newPuzzle();
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
  $('#result-again').addEventListener('click', () => { closeDialog(dom.resultDialog); newGame(); });
  $('#result-close').addEventListener('click', () => closeDialog(dom.resultDialog));

  // Escape closes a dialog; Tab is kept inside it (see onDialogKeydown).
  document.addEventListener('keydown', onDialogKeydown);

  // Scrolling to a fragment does not reliably move focus to the target, so the
  // skip link takes focus explicitly once the navigation has happened.
  $('.skip-link')?.addEventListener('click', () => {
    setTimeout(() => dom.board.focus(), 0);
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

/* ==========================================================================
   Service worker (offline / installable PWA)
   ========================================================================== */

// Register the service worker after the page has loaded so it never delays the
// first paint. Skipped on localhost: the dev server and the test suites should
// keep seeing fresh files, not the last SW cache.
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sw is a nice-to-have */ });
  });
}

/* Expose a tiny debug surface for smoke tests. */
window.__chessClub = { state, get dom() { return dom; } };

