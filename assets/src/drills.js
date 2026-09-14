/**
 * drills.js — the Practice mode mini-games.
 *
 * Two drills, both kid-first:
 *
 *   free-piece  — "grab the piece that is all alone": a random walk from the
 *                 start position produces a position where White can capture
 *                 an undefended enemy piece. Pure chess.js, no engine.
 *
 *   mate-one    — "checkmate in one move": positions composed procedurally
 *                 from classic back-rank traps and rooted heavy-piece mates.
 *                 Every candidate is re-verified live with chess.js to have
 *                 EXACTLY ONE mating move, so judging needs no engine either
 *                 (a move that leaves Black checkmated is the winning move).
 *                 The hand-curated pool below is only a safety-net fallback.
 *
 * Everything here takes a `Chess` constructor as an argument so the module has
 * no static dependency on chess.js (the app loads it dynamically with CDN
 * fallbacks) and stays unit-testable in Node.
 */

import { PIECE_NAMES, PIECE_VALUES } from './pieces.js';

export const DRILL_IDS = ['free-piece', 'mate-one'];

export const DRILL_LABELS = {
  'free-piece': 'Find the free piece',
  'mate-one': 'Checkmate in one'
};

/** Take the other side. */
const other = (c) => (c === 'w' ? 'b' : 'w');

/** The flip side of a FEN has the other side to move; castling rights and
 * en-passant squares belong to the side that actually moved, so blank them. */
function flippedTurnFen(fen) {
  const [pieces, turn, , , half, full] = fen.split(' ');
  return [pieces, other(turn), '-', '-', half, full].join(' ');
}

/**
 * Is `sq` defended by the side NOT to move? The trick: hand the flipped FEN to
 * a throwaway chess.js instance — now the defenders are the side to move, and
 * `moves({verbose})` lists every legal way one of them can land on `sq`.
 * Pinned defenders cannot save the piece, which is exactly what we want.
 */
export function isSquareDefended(Chess, fen, sq) {
  try {
    const flipped = new Chess(flippedTurnFen(fen));
    return flipped.moves({ verbose: true }).some((m) => m.to === sq);
  } catch {
    return false;
  }
}

/** All the captures the side to move can make right now and win for free
 * (destination square not defended by the enemy). Sorted best first. */
export function findHangingCaptures(Chess, chess) {
  const fen = chess.fen();
  const picks = [];
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    const value = PIECE_VALUES[m.captured] || 0;
    picks.push({ from: m.from, to: m.to, san: m.san, captured: m.captured, value });
  }
  return picks
    .filter((p) => !isSquareDefended(Chess, fen, p.to))
    .sort((a, b) => b.value - a.value || a.san.localeCompare(b.san));
}

function describeFreePiece(captured, to, color) {
  return {
    goal: 'Grab the piece that is all alone!',
    caption: `${color === 'w' ? 'White' : 'Black'}'s ${PIECE_NAMES[captured]} on ${to} has no friends to protect it.`,
    hint: `Their ${PIECE_NAMES[captured]} on ${to} is wide open — play ${captured === 'k' ? 'the move' : 'the capture'} that wins it.`
  };
}

/**
 * Play a few random legal moves and keep the first position in which White can
 * take an undefended enemy piece worth grabbing. `seen` (a Set of FENs) keeps a
 * session from repeating a puzzle.
 */
export function freePiecePuzzle(Chess, { rng = Math.random, maxGames = 60, seen } = {}) {
  for (let g = 0; g < maxGames; g++) {
    const c = new Chess();
    const plies = 4 + Math.floor(rng() * 9);   // 4..12 half-moves in
    for (let p = 0; p < plies; p++) {
      const moves = c.moves({ verbose: true });
      if (!moves.length) break;
      c.move(moves[Math.floor(rng() * moves.length)]);
    }
    if (c.turn() !== 'w') continue;

    const picks = findHangingCaptures(Chess, c);
    const best = picks[0];
    if (!best || best.value < 3) continue;   // a pawn with no value grab is not a fun puzzle

    const fen = c.fen();
    if (seen && seen.has(fen)) continue;
    if (seen) seen.add(fen);
    return { drill: 'free-piece', fen, solutions: picks, target: { from: best.from, to: best.to }, targetSan: best.san, ...describeFreePiece(best.captured, best.to, other(c.turn())) };
  }
  return null;
}

/** A few guaranteed positions if the random generator somehow finds nothing. */
export const FREE_PIECE_FALLBACK = [
  '6k1/5ppp/r7/1P6/8/8/8/6K1 w - - 0 1',                 // bxa6 wins a rook
  '6k1/5ppp/8/8/6n1/7P/8/6K1 w - - 0 1',                 // hxg4 wins a knight
  'r1bqkbnr/pp1ppppp/3N4/8/8/8/8/4K3 w kq - 0 1'         // Nxc8 wins a bishop
];

export function fallbackFreePiece(Chess, { rng = Math.random } = {}) {
  const fen = FREE_PIECE_FALLBACK[Math.floor(rng() * FREE_PIECE_FALLBACK.length)];
  const chess = new Chess(fen);
  const picks = findHangingCaptures(Chess, chess);
  const best = picks[0];
  return { drill: 'free-piece', fen, solutions: picks, target: { from: best.from, to: best.to }, targetSan: best.san, ...describeFreePiece(best.captured, best.to, other(chess.turn())) };
}

/** Mate-in-one positions, all White to move. Every entry is re-verified in
 * drills-test.mjs, so a broken puzzle can never ship silently. */
export const MATE_ONE_PUZZLES = [
  { fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: 'Qxf7#' },
  { fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', solution: 'Ra8#' },
  { fen: '6k1/5ppp/8/8/8/8/5PPP/2Q3K1 w - - 0 1', solution: 'Qc8#' },
  { fen: '6k1/5ppp/8/8/8/1Q6/5PPP/6K1 w - - 0 1', solution: 'Qb8#' },
  { fen: 'k7/8/1QK5/8/8/8/8/8 w - - 0 1', solution: 'Qb7#' },
  { fen: '7k/6pp/8/8/8/8/7Q/6K1 w - - 0 1', solution: 'Qb8#' },
  { fen: 'k7/8/8/8/8/8/1R6/1R1K4 w - - 0 1', solution: 'Ra2#' },
  { fen: '6k1/5ppp/8/8/8/1Q6/8/6K1 w - - 0 1', solution: 'Qb8#' },
  { fen: 'r1bqkbnr/pppp2pp/2n2p2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 2 4', solution: 'Qf7#' },
  { fen: '6k1/5ppp/8/8/8/8/2R5/1R4K1 w - - 0 1', solution: 'Rc8#' },
  { fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', solution: 'Nf7#' }
];

let _lastMateIndex = -1;
const FILES = 'abcdefgh';
const sqName = (f, r) => FILES[f] + (r + 1);   // 0..7 file/rank -> 'a1'..'h8'

/** Serialize a {square: piece} board as a FEN with White to move, no rights. */
function fenOf(board) {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let row = '', gap = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[sqName(f, r)];
      if (p) { if (gap) { row += gap; gap = 0; } row += p; } else gap++;
    }
    if (gap) row += gap;
    out += (out ? '/' : '') + row;
  }
  return `${out} w - - 0 1`;
}

/**
 * Compose a near-mate base: a black king pinned to the 8th rank by its own
 * pawn wall, and a rook/queen parked on the far edge file whose single slide
 * to the 8th rank delivers mate. White's king just keeps him off the lane.
 */
function makeMateBoard(rng) {
  const board = {};
  const corner = rng() < 0.6;                           // tucked in a8/h8 vs c8..g8
  const heavy = rng() < 0.5 ? 'Q' : 'R';
  const kf = corner ? (rng() < 0.5 ? 0 : 7) : 2 + Math.floor(rng() * 5);
  board[sqName(kf, 7)] = 'k';
  for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
    board[sqName(f, 6)] = 'p';                          // pawn wall on rank 7
  }
  const heavyFile = rng() < 0.5 ? 0 : 7;                // far edge file
  const minHr = corner && heavy === 'Q' ? 1 : 0;        // corner queens can't sit on the checking diagonal
  board[sqName(heavyFile, minHr + Math.floor(rng() * (6 - minHr)))] = heavy;
  const wkf = heavyFile === 0 ? 1 + Math.floor(rng() * 7) : Math.floor(rng() * 7);
  board[sqName(wkf, 0)] = 'K';                          // White king on his back rank
  return { board, heavyFile };
}

/**
 * Verify a composed board is a quiet (no side in check, White to move) legal
 * position in which EXACTLY ONE White move checkmates. Returns {fen, mate}.
 */
function inspectMateOne(Chess, board) {
  const fen = fenOf(board);
  let c;
  try { c = new Chess(fen); } catch { return null; }
  if (c.turn() !== 'w' || c.inCheck() || c.isCheckmate() || c.isStalemate()) return null;
  if (new Chess(flippedTurnFen(fen)).inCheck()) return null;   // Black already in check
  const mates = [];
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    if (c.isCheckmate()) mates.push({ from: m.from, to: m.to, san: m.san });
    c.undo();
  }
  if (mates.length !== 1) return null;
  return { fen, mate: mates[0] };
}

const MATE_DECOYS = ['p', 'p', 'p', 'N', 'N', 'N', 'B', 'B', 'R'];

function pickDecoySquare(board, rng, heavyFile) {
  const empties = [];
  for (let f = 0; f < 8; f++) {
    if (f === heavyFile) continue;                       // never block the mating lane
    for (let r = 0; r < 6; r++) {                        // ranks 1..6 only
      const s = sqName(f, r);
      if (!board[s]) empties.push(s);
    }
  }
  return empties.length ? empties[Math.floor(rng() * empties.length)] : null;
}

/** Add a little noise (black pawns / White minors), keeping the unique mate. */
function decorateMateBoard(board, heavyFile, rng, isGood) {
  const want = rng() < 0.5 ? Math.floor(rng() * 3) : 1;
  for (let n = 0; n < want; n++) {
    let placed = false;
    for (let t = 0; t < 15 && !placed; t++) {
      const s = pickDecoySquare(board, rng, heavyFile);
      if (!s) break;
      const piece = MATE_DECOYS[Math.floor(rng() * MATE_DECOYS.length)];
      board[s] = piece;
      if (isGood(board)) placed = true;
      else delete board[s];
    }
    if (!placed) break;
  }
}

function puzzleFromMate(fen, mate) {
  return {
    drill: 'mate-one',
    fen,
    solutions: [mate.san],
    target: { from: mate.from, to: mate.to },
    targetSan: mate.san,
    goal: 'Deliver checkmate in ONE move!',
    caption: 'The black king is nearly trapped — one move finishes the job.',
    hint: `Play ${mate.san} and the king will have no safe square to run to.`
  };
}

/** Draw from the hand-curated pool as a rare fallback (seen-aware). */
function curatedMateOne(Chess, rng, seen) {
  const pool = MATE_ONE_PUZZLES;
  const start = Math.floor(rng() * pool.length);
  for (let k = 0; k < pool.length; k++) {
    const i = (start + k) % pool.length;
    const p = pool[i];
    if (i === _lastMateIndex || (seen && seen.has(p.fen))) continue;
    if (seen) seen.add(p.fen);
    _lastMateIndex = i;
    const mv = new Chess(p.fen).move(p.solution);
    return puzzleFromMate(p.fen, { from: mv.from, to: mv.to, san: p.solution });
  }
  return null;
}

export function mateOnePuzzle(Chess, { rng = Math.random, seen } = {}) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const { board, heavyFile } = makeMateBoard(rng);
    if (!inspectMateOne(Chess, board)) continue;
    decorateMateBoard(board, heavyFile, rng, (b) => !!inspectMateOne(Chess, b));
    const got = inspectMateOne(Chess, board);
    if (!got) continue;
    if (seen && seen.has(got.fen)) continue;
    if (seen) seen.add(got.fen);
    return puzzleFromMate(got.fen, got.mate);
  }
  return curatedMateOne(Chess, rng, seen);
}

/** Build a fresh puzzle for a drill id (used by app.js for each new puzzle). */
export function makePuzzle(Chess, drillId, opts) {
  if (drillId === 'mate-one') return mateOnePuzzle(Chess, opts);
  return freePiecePuzzle(Chess, opts) || fallbackFreePiece(Chess, opts);
}

/** Judge a move that was just played on the puzzle: did it solve it? */
export function isSolved(Chess, puzzle, fenBefore, chess, move) {
  if (puzzle.drill === 'mate-one') return chess.isCheckmate();
  return !!move.captured && !isSquareDefended(Chess, fenBefore, move.to);
}

/** SAN of a {from,to} move on a given FEN (used by the reveal-hint). */
export function sanForMove(Chess, fen, { from, to, promotion }) {
  try {
    const c = new Chess(fen);
    const m = c.move({ from, to, promotion: promotion || 'q' });
    return m ? m.san : null;
  } catch {
    return null;
  }
}