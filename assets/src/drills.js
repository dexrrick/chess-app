/**
 * drills.js — the Practice mode mini-games.
 *
 * Two drills, both kid-first:
 *
 *   free-piece  — "grab the piece that is all alone": a random walk from the
 *                 start position produces a position where White can capture
 *                 an undefended enemy piece. Pure chess.js, no engine.
 *
 *   mate-one    — "checkmate in one move": a hand-verified set of positions.
 *                 Each one is checked at test time to be a genuine mate-in-1
 *                 for White, so judging needs no engine either (a move that
 *                 leaves Black checkmated is by definition the winning move).
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

export function mateOnePuzzle(Chess, { rng = Math.random } = {}) {
  const pool = MATE_ONE_PUZZLES;
  let i = Math.floor(rng() * pool.length);
  if (pool.length > 1 && i === _lastMateIndex) i = (i + 1) % pool.length;
  _lastMateIndex = i;
  const p = pool[i];
  const mv = new Chess(p.fen).move(p.solution);
  return {
    drill: 'mate-one',
    fen: p.fen,
    solutions: [p.solution],
    target: { from: mv.from, to: mv.to },
    targetSan: p.solution,
    goal: 'Deliver checkmate in ONE move!',
    caption: 'The black king is nearly trapped — one move finishes the job.',
    hint: `Play ${p.solution} and the king will have no safe square to run to.`
  };
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