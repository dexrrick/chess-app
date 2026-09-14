/**
 * drills.js — the Practice mode mini-games.
 *
 * Two drills, both kid-first, and both auto-scale across three levels
 * (1 = easy, 2 = hard, 3 = expert) chosen from the solve streak:
 *
 *   free-piece  — curated, validated teaching positions where one tactical
 *                 capture wins material. Pure chess.js, no engine.
 *                 Higher levels demand pricier grabs and best-piece accuracy.
 *
 *   mate-one    — "checkmate in one move": positions composed procedurally
 *                 from several classic mating families (back-rank slides,
 *                 corner queen boxes, knight-in-the-cage, diagonal shutters).
 *                 Every candidate is re-verified live with chess.js: easier
 *                 levels accept any mating move, harder ones demand EXACTLY
 *                 ONE mate (and lure checks to see through). No engine needed.
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

/** A small, session-local diversity policy.  It deliberately tracks tactical
 * characteristics rather than FENs: transformed templates may have unique
 * positions while teaching exactly the same idea. */
export class PuzzleScheduler {
  constructor(recent = []) { this.recent = recent.slice(-5); this.used = new Set(); }
  allows(puzzle) {
    if (!puzzle || this.used.has(puzzle.id)) return false;
    const last = this.recent[this.recent.length - 1];
    if (last && last.motif === puzzle.motif) return false;
    if (this.recent.filter((p) => p.motif === puzzle.motif).length >= 2) return false;
    if (last && last.sideToMove === puzzle.sideToMove) return false;
    return true;
  }
  record(puzzle) {
    this.used.add(puzzle.id);
    this.recent.push({ id: puzzle.id, motif: puzzle.motif, sideToMove: puzzle.sideToMove,
      solutionPiece: puzzle.solutionPiece, targetSquare: puzzle.target?.to });
    this.recent = this.recent.slice(-5);
  }
}

/** Take the other side. */
const other = (c) => (c === 'w' ? 'b' : 'w');

/** Rotate the board 180 degrees and exchange colours. This preserves chess
 * legality and turns a White-to-move template into a Black-to-move lesson. */
export function invertPuzzleFen(fen) {
  const [placement, turn, , , half = '0', full = '1'] = fen.split(' ');
  const rows = placement.split('/').reverse().map((row) => {
    const expanded = row.replace(/[1-8]/g, (n) => ' '.repeat(Number(n))).split('').reverse()
      .map((p) => p === ' ' ? p : (p === p.toUpperCase() ? p.toLowerCase() : p.toUpperCase())).join('');
    return expanded.replace(/ {1,8}/g, (spaces) => String(spaces.length));
  });
  return `${rows.join('/')} ${other(turn)} - - ${half} ${full}`;
}

export function mirrorPuzzleFen(fen) {
  const [placement, turn, , , half = '0', full = '1'] = fen.split(' ');
  const rows = placement.split('/').map((row) => {
    const expanded = row.replace(/[1-8]/g, (n) => ' '.repeat(Number(n))).split('').reverse().join('');
    return expanded.replace(/ {1,8}/g, (spaces) => String(spaces.length));
  });
  return `${rows.join('/')} ${turn} - - ${half} ${full}`;
}

/** Auto-scaling level picker: streak 3 -> level 2, streak 7 -> level 3. */
export function levelForStreak(streak) {
  if (streak >= 7) return 3;
  if (streak >= 3) return 2;
  return 1;
}

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

/** A capture is only a clean win when the piece that lands on its destination
 * cannot be legally captured immediately.  Looking for attacks in the source
 * position is wrong: chess.js quite correctly omits moves onto a friendly
 * occupied square.  Apply the capture first, then inspect legal recaptures. */
export function hasImmediateRecapture(Chess, chess, move) {
  try {
    const after = new Chess(chess.fen());
    const played = after.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    return !!played && after.moves({ verbose: true }).some((reply) => reply.captured && reply.to === played.to);
  } catch {
    return true; // malformed candidates must never be advertised as free
  }
}

/** All the captures the side to move can make right now and win for free
 * (destination square not defended by the enemy). Sorted best first. */
export function findHangingCaptures(Chess, chess) {
  const picks = [];
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    const value = PIECE_VALUES[m.captured] || 0;
    picks.push({ from: m.from, to: m.to, san: m.san, captured: m.captured, value });
  }
  return picks
    .filter((p) => !hasImmediateRecapture(Chess, chess, p))
    .sort((a, b) => b.value - a.value || a.san.localeCompare(b.san));
}

function describeFreePiece(captured, to, color) {
  return {
    goal: 'Grab the piece that is all alone!',
    caption: `${color === 'w' ? 'White' : 'Black'}'s ${PIECE_NAMES[captured]} on ${to} has no friends to protect it.`,
    hint: `Their ${PIECE_NAMES[captured]} on ${to} is wide open — play ${captured === 'k' ? 'the move' : 'the capture'} that wins it.`
  };
}

/** Free-piece difficulty knobs. Pricier targets and best-piece precision scale up. */
const FREE_LEVELS = {
  1: { value: 3, needBest: false, plies: [4, 8], maxGames: 60 },
  2: { value: 4, needBest: true, plies: [4, 10], maxGames: 60 },
  3: { value: 4, needBest: true, plies: [5, 11], maxGames: 90, shopForTwo: true }
};

/**
 * Play a few random legal moves and keep the first position in which White can
 * take an undefended enemy piece worth grabbing. `seen` (a Set of FENs) keeps a
 * session from repeating a puzzle; `level` scales the target value, the clutter
 * (deeper plies) and whether the best grab is required.
 */
const CURATED_FREE_FENS = [
 'rBbqkb1r/1p1ppp2/6p1/pNp2n1p/3P3P/1P6/P1P1PPP1/R2QKBNR b KQkq - 0 7','r2qkb1r/pbppp2p/Qp3ppn/8/5P2/2P5/PP1PP1PP/RNB1KBNR w KQkq - 1 7','rnq1kbnr/1pp1pp1p/3P2p1/p7/4P3/6P1/PPbP1P1P/RNBQK1NR w KQkq - 1 8','rnbqkbnr/1p6/3pNpp1/p1p4p/P5P1/1P5N/2PPPP1P/R1BQKBR1 b Qkq - 0 9','rnbk1b1r/p1Nppp1p/1p5q/2p3p1/1P2n2P/4PN2/P1PP1PP1/R1BQKBR1 w Q - 2 9','1rbqkb2/1ppnppp1/p1n5/3p2Nr/3P2Pp/2P2P2/PP1NP2P/R1BQKB1R w K - 3 10','rnbq1rk1/bp1p1ppp/p1p5/4pn2/6P1/NP1P1P1P/P1P1P1BR/R1B1QK2 w - - 1 11','r1b2b1r/1pppk2p/p3p3/n4p1n/1PPP3q/N3P1p1/P4PPP/R1BQKB1R w K - 0 13','rn1k1b1r/pp1bp2p/6pn/q1p2p1Q/BP1p3P/N3P2R/P1PP1PP1/R1BK2N1 w - - 0 11','rnbqk2r/3pppb1/Pp3n1B/2p4p/2P3p1/P2P3N/4PPPP/RN1QKB1R w KQkq - 3 10','r2q1bnr/p1p1pk2/n4p1p/3p2p1/P1pPb1P1/RPN5/1B1QPP1P/4KBNR b K - 5 11','rn1qkB1r/2pb1p1p/3pp1pn/pp6/2PP4/P6N/1P2PPPP/RN1QKB1R w KQkq - 0 8','rn2kbnr/p1p2pp1/bp1pp2p/P3P3/q7/3B1P2/1PPP2P1/RNBQ1KNR w kq - 2 9','r1b1kb1r/3qpp1p/pp1p1n2/n1p1N3/5p1P/1PPP2PR/P2QP3/RNBK1B2 b kq - 1 11','1nbqk1nr/3pp1bp/r4pp1/p1P1N3/p3P3/P2P3P/1P3PP1/1RBQKB1R b Kk - 0 13','r1b2bnr/pppkppp1/2n4p/N1Pp1P2/P1Q5/3B4/RP1P1PPP/1NB1K1R1 b - - 2 14','r1bqkb1r/p1ppp3/Bp4pn/5p1p/P5PP/2N1P3/1PPP1P2/R1BQK1NR b Qkq - 2 8','rnb1kbnr/pp1ppppp/8/2p5/2P2P2/3PB2P/PP2P1q1/RN2KBNR b KQkq - 0 7','r1b1k1nr/pp1ppp1p/B1p2P1b/2n1q1p1/8/4PN2/PPPP2PP/RNBQK1R1 w Qkq - 7 8','r3kbnr/pp1b2p1/2q1ppnp/PPpp1P2/2B5/4P2P/1BPPNRP1/RN1Q2K1 b - - 0 14','rnq1kbn1/4p1p1/2p2p1r/Pp5p/2p2P2/N2Q2PP/P2PP1B1/R1BbK1NR w KQq - 4 13','r1b2b1r/ppkq1p1p/2ppp3/5Pp1/4n2N/3QP2P/PP1P2P1/RNBK1BR1 b - - 3 13','rnbqk1nr/p1p5/1p1pp3/5ppp/3N2PP/b1N5/PPPPPP2/R1BQKB1R w KQkq - 0 8','r1b2bnr/1p1p1kpN/1q3p1p/pnp1p3/2N1P2P/1PQ5/P1PP1PP1/1RB1KB1R w K - 7 14','3r1bnr/pppkq2p/3p2p1/4ppP1/1nP1PPb1/P6P/1P1PQ1B1/RNB1K1NR w KQ - 1 11','rn2kb1r/p5p1/1ppB1n1p/3P1p2/5P1N/P4b2/RPP1B1PP/1N1QK2R b Kkq - 0 13','1nb1k1nr/2p3p1/rp1p1p1p/8/pbPPp1P1/4P2N/PP1Q1PRP/RNBK1B2 w k - 0 12','r1b1kbr1/pp1pp1p1/1N3n2/2p2pBp/3PP1n1/5PP1/P1P3P1/R2QKBNR b KQq - 4 13','r1b1kb1r/1ppn1p2/p2p2pn/4p1qp/P2B1N1P/NP1P2P1/2PKPP2/R3QB1R b kq - 2 14','1nbqk1nr/1p1pp1Bp/8/r1p2pp1/p2P4/2N1P3/PPP2PPP/R2QKBNR w KQk - 2 8'
];
const FREE_PIECE_TEMPLATES = CURATED_FREE_FENS.map((fen, i) => ({ id: `free-base-${i + 1}`, fen, motif: 'clean-capture', difficulty: i < 10 ? 1 : i < 20 ? 2 : 3 }));

function freePuzzleFromTemplate(Chess, template, sideToMove, level, mirrored = false) {
  let fen = sideToMove === 'b' ? invertPuzzleFen(template.fen) : template.fen;
  if (mirrored) fen = mirrorPuzzleFen(fen);
  const chess = new Chess(fen);
  const picks = findHangingCaptures(Chess, chess);
  const best = picks[0];
  if (!best) return null;
  const cfg = FREE_LEVELS[level] || FREE_LEVELS[1];
  return {
    id: `${template.id}-${sideToMove}`, drill: 'free-piece', fen, level, difficulty: level,
    motif: template.motif, sideToMove, orientation: sideToMove, solutionPiece: chess.get(best.from).type,
    needBest: cfg.needBest || template.difficulty >= 2, bestValue: best.value, solutions: picks,
    target: { from: best.from, to: best.to }, targetSan: best.san,
    explanation: 'The target cannot be safely recaptured.', hints: [],
    ...describeFreePiece(best.captured, best.to, other(chess.turn()))
  };
}

/** Curated templates are selected before their safe colour transformation;
 * random legal walks are intentionally no longer part of this drill. */
export function freePiecePuzzle(Chess, { rng = Math.random, seen, level = 1, scheduler } = {}) {
  const pool = FREE_PIECE_TEMPLATES.filter((p) => p.difficulty <= level);
  const start = Math.floor(rng() * pool.length);
  for (let n = 0; n < pool.length * 4; n++) {
    const template = pool[(start + n) % pool.length];
    for (const side of n % 2 ? ['b', 'w'] : ['w', 'b']) {
      const p = freePuzzleFromTemplate(Chess, template, side, level, n % 4 >= 2);
      if (!p || (seen && seen.has(p.fen)) || (scheduler && !scheduler.allows(p))) continue;
      if (seen) seen.add(p.fen);
      return p;
    }
  }
  return null;
}

/** A few guaranteed positions if the random generator somehow finds nothing. */
export const FREE_PIECE_FALLBACK = [
  '6k1/5ppp/r7/1P6/8/8/8/6K1 w - - 0 1',                 // bxa6 wins a rook
  '6k1/5ppp/8/8/6n1/7P/8/6K1 w - - 0 1'                  // hxg4 wins a knight
];

export function fallbackFreePiece(Chess, { rng = Math.random, level = 1 } = {}) {
  const cfg = FREE_LEVELS[level] || FREE_LEVELS[1];
  const fen = FREE_PIECE_FALLBACK[Math.floor(rng() * FREE_PIECE_FALLBACK.length)];
  const chess = new Chess(fen);
  const picks = findHangingCaptures(Chess, chess);
  const best = picks[0];
  return {
    drill: 'free-piece',
    fen,
    level,
    needBest: cfg.needBest,
    bestValue: best.value,
    solutions: picks,
    target: { from: best.from, to: best.to },
    targetSan: best.san,
    ...describeFreePiece(best.captured, best.to, other(chess.turn()))
  };
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

/* ---- Mating families. Each composes a near-mate base and returns
   {board, lane}, where `lane` is the file the mating piece slides along and so
   must be kept clear of decoys (null = no lane). The chess.js verifier turns
   the scaffolds into guaranteed positions. ---- */

/** Back-rank slide: black king folded against the 8th rank by a pawn wall, a
 *  rook/queen parked on the far edge file slides to the rank to mate. */
const scaffoldBackRank = (rng) => {
  const board = {};
  const corner = rng() < 0.6;                          // tucked in a8/h8 vs c8..g8
  const heavy = rng() < 0.5 ? 'Q' : 'R';
  const kf = corner ? (rng() < 0.5 ? 0 : 7) : 2 + Math.floor(rng() * 5);
  board[sqName(kf, 7)] = 'k';
  for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
    board[sqName(f, 6)] = 'p';                         // pawn wall on rank 7
  }
  const lane = rng() < 0.5 ? 0 : 7;                    // far edge file
  const minHr = corner && heavy === 'Q' ? 1 : 0;       // corner queens can't sit on the checking diagonal
  board[sqName(lane, minHr + Math.floor(rng() * (6 - minHr)))] = heavy;
  const wkf = lane === 0 ? 1 + Math.floor(rng() * 7) : Math.floor(rng() * 7);
  board[sqName(wkf, 0)] = 'K';                         // White king on his back rank
  return { board, lane };
};

/** Corner queen box: bare king stuck in a8/h8, the queen slides to the square
 *  b7/g7 (defended from c6/f6) to mate. Queen + king cooperation is far less
 *  obvious than a straight heavy-piece slide. */
const scaffoldCornerBox = (rng) => {
  const board = {};
  const right = rng() < 0.5;                           // king h8 vs a8
  const kf = right ? 7 : 0;
  board[sqName(kf, 7)] = 'k';
  const lane = right ? 6 : 1;                          // the queen mates b7/g7
  board[sqName(right ? 5 : 2, 5)] = 'K';               // c6/f6 shelters her (never adjacent to the king)
  board[sqName(lane, 1 + Math.floor(rng() * 4))] = 'Q';  // starts on her own file, ranks 2..5
  return { board, lane };
};

/** Knight in the cage: the king is jailed in the corner by its own rook and
 *  pawns, and a lone knight lands on the killing square (f7 / c7). */
const KNIGHT_CAGE_MATE = {
  7: ['d6', 'd8', 'e5', 'g5', 'h6'],   // all reach the killing square f7
  0: ['a6', 'b5', 'd5', 'e6', 'e8']    // all reach c7
};
const scaffoldKnightCage = (rng) => {
  const board = {};
  const right = rng() < 0.5;
  const kf = right ? 7 : 0;
  board[sqName(kf, 7)] = 'k';
  const side = right ? kf - 1 : kf + 1;                // g8 / b8 cage blocker
  board[sqName(side, 7)] = 'r';
  board[sqName(side, 6)] = 'p';
  board[sqName(kf, 6)] = 'p';
  const starts = KNIGHT_CAGE_MATE[kf];
  board[starts[Math.floor(rng() * starts.length)]] = 'N';
  board[sqName(right ? 0 : 7, 0)] = 'K';               // white king away in the far corner
  return { board, lane: null };
};

/** Diagonal shutter: a two-pawn wall leaves one escape square open, which a
 *  far-away bishop covers along a long diagonal while the heavy piece mates on
 *  the rank. The solver must notice a hidden diagonal, not just the obvious
 *  slide. */
const scaffoldDiagonalShutter = (rng) => {
  const board = {};
  const heavy = rng() < 0.5 ? 'Q' : 'R';
  const kf = 2 + Math.floor(rng() * 5);                // c8..g8
  const openRight = kf < 6 && rng() < 0.5 ? false : kf > 2 && rng() < 0.5 ? true : kf >= 6 ? false : true;
  const openF = openRight ? kf + 1 : kf - 1;
  board[sqName(kf, 7)] = 'k';
  if (openRight) {
    board[sqName(kf - 1, 6)] = 'p';
    board[sqName(kf, 6)] = 'p';
  } else {
    board[sqName(kf, 6)] = 'p';
    board[sqName(kf + 1, 6)] = 'p';
  }
  const lane = openRight ? 0 : 7;                      // heavy mates from the far corner
  board[sqName(lane, Math.floor(rng() * 6))] = heavy;
  const dir = openRight ? -1 : 1;                      // walk down the shutter diagonal
  const shutter = [];
  for (let f = openF + dir, r = 5; f >= 0 && f <= 7 && r >= 0; f += dir, r--) {
    shutter.push(sqName(f, r));
  }
  board[shutter[Math.floor(rng() * shutter.length)]] = 'B';
  board[sqName(openRight ? 7 : 0, 0)] = 'K';           // white king far away
  return { board, lane };
};

const MATE_FAMILIES = {
  backRank: scaffoldBackRank,
  cornerBox: scaffoldCornerBox,
  knightCage: scaffoldKnightCage,
  diagonal: scaffoldDiagonalShutter
};

/** Verify a composed board is a quiet (no side in check, White to move) legal
 *  position whose mating moves fall inside [minMates, maxMates], with optional
 *  "lure" checks (moves that give check but do NOT mate — a tempting wrong
 *  answer on the expert tier). Returns {fen, mates}. */
function inspectMateOne(Chess, board, { minMates = 1, maxMates = 1, wantLure = false } = {}) {
  const fen = fenOf(board);
  let c;
  try { c = new Chess(fen); } catch { return null; }
  if (c.turn() !== 'w' || c.inCheck() || c.isCheckmate() || c.isStalemate()) return null;
  if (new Chess(flippedTurnFen(fen)).inCheck()) return null;   // Black already in check
  const mates = [];
  let lureChecks = 0;
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    if (c.isCheckmate()) mates.push({ from: m.from, to: m.to, san: m.san });
    else if (c.inCheck()) lureChecks++;
    c.undo();
  }
  if (mates.length < minMates || mates.length > maxMates) return null;
  if (wantLure && lureChecks < 1) return null;
  return { fen, mates };
}

const MATE_DECOYS = ['p', 'p', 'p', 'N', 'N', 'N', 'B', 'B', 'R'];

function pickDecoySquare(board, rng, lane) {
  const empties = [];
  for (let f = 0; f < 8; f++) {
    if (lane !== null && f === lane) continue;         // never block the mating lane
    for (let r = 0; r < 6; r++) {                      // ranks 1..6 only
      const s = sqName(f, r);
      if (!board[s]) empties.push(s);
    }
  }
  return empties.length ? empties[Math.floor(rng() * empties.length)] : null;
}

/** Add noise (black pawns / White minors) without breaking the level's mate
 *  contract. Every placement is re-verified and rolled back if invalid. */
function decorateMateBoard(board, lane, rng, range, isGood) {
  const want = range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
  for (let n = 0; n < want; n++) {
    let placed = false;
    for (let t = 0; t < 15 && !placed; t++) {
      const s = pickDecoySquare(board, rng, lane);
      if (!s) break;
      const piece = MATE_DECOYS[Math.floor(rng() * MATE_DECOYS.length)];
      board[s] = piece;
      if (isGood(board)) placed = true;
      else delete board[s];
    }
    if (!placed) break;
  }
}

function puzzleFromMate(fen, mates, level, motif = 'back-rank') {
  const first = mates[0];
  const sideToMove = fen.split(' ')[1];
  return {
    id: `${motif}-${sideToMove}-${fen.split(' ')[0]}`,
    drill: 'mate-one', motif, sideToMove, orientation: sideToMove, difficulty: level,
    fen,
    level,
    solutionPiece: /^[KQRBN]/.test(first.san) ? first.san[0].toLowerCase() : 'p',
    solutions: mates.map((m) => m.san),
    target: { from: first.from, to: first.to },
    targetSan: first.san,
    goal: 'Deliver checkmate in ONE move!',
    caption: 'The black king is nearly trapped — one move finishes the job.',
    hint: `Play ${first.san} and the king will have no safe square to run to.`,
    hints: ['Start by looking at every check.', `The mating piece starts on ${first.from}.`],
    explanation: 'The mating move checks the king and covers every available escape square.'
  };
}

/** Draw from the hand-curated pool as a rare fallback (seen-aware). */
function curatedMateOne(Chess, rng, seen, level) {
  const pool = MATE_ONE_PUZZLES;
  const start = Math.floor(rng() * pool.length);
  for (let k = 0; k < pool.length; k++) {
    const i = (start + k) % pool.length;
    const p = pool[i];
    if (i === _lastMateIndex || (seen && seen.has(p.fen))) continue;
    if (seen) seen.add(p.fen);
    _lastMateIndex = i;
    const mv = new Chess(p.fen).move(p.solution);
    return puzzleFromMate(p.fen, [{ from: mv.from, to: mv.to, san: p.solution }], level, 'curated-mate');
  }
  return null;
}

/* These are deliberately one-to-one mappings.  A motif is a distinct mating
 * geometry, never a new label placed on a shared scaffold. */
const MATE_VARIANTS = [
  ['back-rank', 'backRank'],          // heavy piece cuts the blocked back rank
  ['queen-touch-support', 'cornerBox'], // queen beside king, protected by king
  ['smothered-knight', 'knightCage'], // knight delivers to a king boxed by own men
  ['bishop-battery', 'diagonal']      // long diagonal support closes the sole flight square
];
const MATE_LEVELS = {
  1: { variants: MATE_VARIANTS, minMates: 1, maxMates: 3, decoys: [0, 1], lure: false },
  2: { variants: MATE_VARIANTS, minMates: 1, maxMates: 1, decoys: [1, 2], lure: false },
  3: { variants: MATE_VARIANTS, minMates: 1, maxMates: 1, decoys: [2, 3], lure: true }
};

function mateMovesForFen(Chess, fen) {
  const c = new Chess(fen); const mates = [];
  for (const m of c.moves({ verbose: true })) { c.move(m); if (c.isCheckmate()) mates.push({ from: m.from, to: m.to, san: m.san }); c.undo(); }
  return mates;
}

export function mateOnePuzzle(Chess, { rng = Math.random, seen, level = 1, scheduler } = {}) {
  const cfg = MATE_LEVELS[level] || MATE_LEVELS[1];
  for (let attempt = 0; attempt < 200; attempt++) {
    const wantLure = cfg.lure && attempt < 60;   // prefer lure mates on expert, don't starve on them
    const [motif, family] = cfg.variants[Math.floor(rng() * cfg.variants.length)];
    const { board, lane } = MATE_FAMILIES[family](rng);
    const good = () => inspectMateOne(Chess, board, { minMates: cfg.minMates, maxMates: cfg.maxMates, wantLure });
    if (!good()) continue;
    decorateMateBoard(board, lane, rng, cfg.decoys, () => !!good());
    const got = good();
    if (!got) continue;
    for (const side of attempt % 2 ? ['b', 'w'] : ['w', 'b']) {
      const fen = side === 'b' ? invertPuzzleFen(got.fen) : got.fen;
      const mates = side === 'b' ? mateMovesForFen(Chess, fen) : got.mates;
      const p = puzzleFromMate(fen, mates, level, motif);
      if ((seen && seen.has(fen)) || (scheduler && !scheduler.allows(p))) continue;
      if (seen) seen.add(fen);
      return p;
    }
  }
  return curatedMateOne(Chess, rng, seen, level);
}

/** Build a fresh puzzle for a drill id (used by app.js for each new puzzle). */
export function makePuzzle(Chess, drillId, opts) {
  if (drillId === 'mate-one') return mateOnePuzzle(Chess, opts);
  return freePiecePuzzle(Chess, opts) || fallbackFreePiece(Chess, opts);
}

/** Judge a move that was just played on the puzzle: did it solve it? */
export function isSolved(Chess, puzzle, fenBefore, chess, move) {
  if (puzzle.drill === 'mate-one') return chess.isCheckmate();
  if (!move.captured) return false;
  const before = new Chess(fenBefore);
  if (hasImmediateRecapture(Chess, before, move)) return false;
  if (puzzle.needBest && PIECE_VALUES[move.captured] < puzzle.bestValue) return false;
  return true;
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
