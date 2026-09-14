/**
 * drills-test.mjs — unit tests for the practice drills (assets/src/drills.js).
 *
 * Pure Node, same shape as coach-test.mjs. Guards the exact properties the UI
 * depends on: every stored mate-in-1 really is a mate in one, every fallback
 * free-piece position really has a hanging piece worth grabbing, and the
 * judges agree with chess.js about what counts as solved.
 */

import { Chess } from './assets/vendor/chess.js';
import {
  MATE_ONE_PUZZLES,
  FREE_PIECE_FALLBACK,
  DRILL_IDS,
  DRILL_LABELS,
  findHangingCaptures,
  freePiecePuzzle,
  fallbackFreePiece,
  mateOnePuzzle,
  makePuzzle,
  isSolved,
  isSquareDefended,
  sanForMove
} from './assets/src/drills.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

/** Deterministic PRNG so generation tests are reproducible. */
function lcg(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/* ---- 1. drill catalogue is coherent ---- */
{
  check('two drills are registered', DRILL_IDS.length === 2, DRILL_IDS.join(','));
  for (const id of DRILL_IDS) {
    check(`drill "${id}" has a label`, typeof DRILL_LABELS[id] === 'string' && DRILL_LABELS[id].length > 0);
  }
}

/* ---- 2. every mate-in-1 puzzle really is a mate in one for White ---- */
{
  for (const [i, p] of MATE_ONE_PUZZLES.entries()) {
    const c = new Chess(p.fen);
    check(`mate puzzle #${i} is White to move`, c.turn() === 'w', p.fen);
    const mating = c.moves({ verbose: true }).filter((m) => {
      c.move(m);
      const dead = c.isCheckmate();
      c.undo();
      return dead;
    });
    check(`mate puzzle #${i} has a mating move`, mating.length >= 1,
      `solutions=${mating.map((m) => m.san).join(',') || 'none'}`);
    try {
      const c2 = new Chess(p.fen);
      c2.move(p.solution);
      check(`mate puzzle #${i} declared solution "${p.solution}" is legal and mates`,
        c2.isCheckmate(), p.solution);
    } catch {
      check(`mate puzzle #${i} declared solution "${p.solution}" is legal and mates`, false, 'throws');
    }
  }
}

/* ---- 3. every fallback free-piece position has a hanging grab ----- */
{
  for (const fen of FREE_PIECE_FALLBACK) {
    const picks = findHangingCaptures(Chess, new Chess(fen));
    check(`fallback ${fen.split(' ')[0].slice(0, 18)}… has a free capture worth >=3`,
      picks.length > 0 && picks[0].value >= 3,
      picks.map((p) => `${p.san}=${p.captured}`).join(',') || 'none');
  }
}

/* ---- 4. the start position has nothing to grab ---- */
{
  check('start position has no hanging captures',
    findHangingCaptures(Chess, new Chess()).length === 0);
}

/* ---- 5. the free-piece generator honours its rng and shape ---- */
{
  const puzzle = freePiecePuzzle(Chess, { rng: lcg(7) });
  check('freePiecePuzzle generated a puzzle', !!puzzle, puzzle ? puzzle.fen : 'null');
  check('free-piece puzzle is White to move', puzzle && new Chess(puzzle.fen).turn() === 'w');
  check('free-piece puzzle explains the goal',
    typeof puzzle.goal === 'string' && /all alone/i.test(puzzle.goal));
  check('free-piece puzzle names the target',
    typeof puzzle.caption === 'string' && puzzle.caption.length > 10);
  check('free-piece puzzle exposes targetSan', /x[a-h][1-8]/.test(puzzle.targetSan));

  const c = new Chess(puzzle.fen);
  const m = c.move({ from: puzzle.target.from, to: puzzle.target.to });
  check('the advertised target move is a legal capture',
    !!m && !!m.captured, m ? `${m.san}` : 'no move');
}

/* ---- 6. the free-piece judge agrees with the generator ---- */
{
  const puzzle = fallbackFreePiece(Chess);   // deterministic set, always solves
  const c = new Chess(puzzle.fen);
  const fenBefore = c.fen();
  const win = c.move({ from: puzzle.target.from, to: puzzle.target.to });
  check('fallback target solves the free-piece drill',
    isSolved(Chess, puzzle, fenBefore, c, win) && !!win.captured);

  // A quiet (non-capture) move must NOT count as solved.
  const c2 = new Chess(puzzle.fen);
  const fen2 = c2.fen();
  const quietMove = c2.moves({ verbose: true }).find((m) => !m.captured);
  if (quietMove) {
    const q = c2.move(quietMove);
    check('a quiet move is not "solved"', !isSolved(Chess, puzzle, fen2, c2, q), q.san);
  }
}

/* ---- 7. the mate-one judge needs a real checkmate ---- */
{
  const puzzle = mateOnePuzzle(Chess, { rng: lcg(3) });
  const c = new Chess(puzzle.fen);
  const fenBefore = c.fen();
  const quiet = c.moves({ verbose: true })[0];       // any move
  const q = c.move({ from: quiet.from, to: quiet.to });
  check('a random mate-one move is not solved (unless it mated)',
    isSolved(Chess, puzzle, fenBefore, c, q) === c.isCheckmate());

  const c2 = new Chess(puzzle.fen);
  const fen2 = c2.fen();
  const win = c2.move(puzzle.targetSan);
  check('playing the solution checks mate', isSolved(Chess, puzzle, fen2, c2, win));
}

/* ---- 8. makePuzzle dispatches both drills ---- */
{
  for (const id of DRILL_IDS) {
    const p = makePuzzle(Chess, id, { rng: lcg(9) });
    check(`makePuzzle('${id}') returns a ${id} puzzle`, p && p.drill === id);
    check(`makePuzzle('${id}') has goal/hint text`, p.hint && p.hint.length > 10);
  }
}

/* ---- 9. defence probe uses the flipped-turn trick correctly ---- */
{
  const f = new Chess();
  f.move('e4');                           // White moved; White = side NOT to move
  const fen = f.fen();
  check('e2 is defended by White after 1.e4', isSquareDefended(Chess, fen, 'e2'));
  check('b2 is not defended by White after 1.e4', !isSquareDefended(Chess, fen, 'b2'));
  check('e4 is not defended by the pawn standing on it', !isSquareDefended(Chess, fen, 'e4'));
  check('probe answers for the side not to move (White here)',
    isSquareDefended(Chess, fen, 'e2') === true);
  // Free-piece semantics: the defender is the side to move in the flipped clone,
  // i.e. Black in a White-to-move position.
  const g = new Chess('6k1/5ppp/r7/1P6/8/8/8/6K1 w - - 0 1'); // fallback #0
  check('hanging a6 rook is undefended by Black', !isSquareDefended(Chess, g.fen(), 'a6'));
}

/* ---- 10. sanForMove recovers SAN for hint bubbles ---- */
{
  const p = makePuzzle(Chess, 'free-piece', { rng: lcg(5) });
  const san = sanForMove(Chess, p.fen, p.target);
  check('sanForMove names the winning move', !!san && san.length >= 3, san || 'null');
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL DRILL TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);