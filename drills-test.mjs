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
  hasImmediateRecapture,
  sanForMove,
  levelForStreak,
  PuzzleScheduler
} from './assets/src/drills.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

/* ---- 3b. strict free-piece validation uses legal recaptures, not attacks ---- */
{
  // Black's Nh2xf1 takes the bishop, but White's Qe1xf1 is a legal immediate
  // recapture.  The old flipped-turn probe incorrectly called f1 undefended.
  const c = new Chess('6k1/8/8/8/8/8/7n/4QBK1 b - - 0 1');
  const candidate = c.moves({ verbose: true }).find((m) => m.from === 'h2' && m.to === 'f1');
  check('a defended bishop capture has an immediate legal recapture',
    !!candidate && hasImmediateRecapture(Chess, c, candidate));
  check('a defended bishop capture is excluded from free-piece candidates',
    !findHangingCaptures(Chess, c).some((p) => p.from === 'h2' && p.to === 'f1'));
}

/** Deterministic PRNG so generation tests are reproducible. */
function lcg(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Same FEN with the side to move swapped (for probing the enemy side). */
function flipTurn(fen) {
  const [pieces, turn, ...rest] = fen.split(' ');
  return [pieces, turn === 'w' ? 'b' : 'w', ...rest].join(' ');
}

/** All the moves in the position that actually deliver checkmate. */
function matingMoves(c) {
  const mates = [];
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    if (c.isCheckmate()) mates.push(m.san);
    c.undo();
  }
  return mates;
}

/** Does any move give check without mating (a tempting lure answer)? */
function hasLure(c) {
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const lure = c.inCheck() && !c.isCheckmate();
    c.undo();
    if (lure) return true;
  }
  return false;
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

/* ---- 11. the mate-one generator composes unique, legal, varied mates (L2) ----
   Level 2 demands EXACTLY ONE mate — the strongest generator contract we ship. */
{
  const seen = new Set();
  const fens = new Set();
  let got = 0;
  for (let i = 0; i < 40; i++) {
    const p = mateOnePuzzle(Chess, { rng: lcg(1000 + i), seen, level: 2 });
    if (!p) continue;
    got++;
    fens.add(p.fen);
    const c = new Chess(p.fen);
    check(`gen #${i} starts quiet (solver to move, nobody checked)`,
      c.turn() === p.sideToMove && !c.inCheck() && !new Chess(flipTurn(p.fen)).inCheck(), p.fen);
    const mates = matingMoves(c);
    check(`gen #${i} has exactly one mating move`, mates.length === 1,
      mates.join(',') || 'none');
    try {
      const c2 = new Chess(p.fen);
      c2.move(p.targetSan);
      check(`gen #${i} advertised mate "${p.targetSan}" is legal and mates`, c2.isCheckmate(), p.targetSan);
    } catch {
      check(`gen #${i} advertised mate "${p.targetSan}" is legal and mates`, false, 'throws');
    }
  }
  check('generator produced puzzles across seeds', got >= 30, `got=${got}`);
  check('generated puzzles within one session are all distinct', fens.size === got,
    `unique=${fens.size} got=${got} (seen-set dedup)`);
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

/* ---- 12. auto-scaling levels ---- */
{
  const streakLevels = [1, 1, 1, 1, 2, 2, 2, 3, 3, 3].map((_, i) => levelForStreak(i));
  check('levelForStreak: 1 until streak 3, 2 until streak 6, 3 from streak 7',
    JSON.stringify(streakLevels) === '[1,1,1,2,2,2,2,3,3,3]', streakLevels.join(','));
  check('levelForStreak clamps negatives', levelForStreak(-5) === 1);

  // Level 1 accepts 1..3 mating moves (any mate wins); L2/L3 are unique.
  let l1Seen = 0;
  let l1Multi = 0;
  for (let i = 0; i < 40; i++) {
    const p = mateOnePuzzle(Chess, { rng: lcg(500 + i), level: 1 });
    if (!p) continue;
    l1Seen++;
    const mates = matingMoves(new Chess(p.fen));
    check(`L1 #${i} allows 1..3 mating moves`, mates.length >= 1 && mates.length <= 3, mates.join(','));
    if (mates.length > 1) l1Multi++;
  }
  check('L1 generated puzzles across seeds', l1Seen >= 20, `got=${l1Seen}`);
  check('L1 produced some multi-mate (friendlier) puzzles', l1Multi >= 1, `multi=${l1Multi}`);

  for (const level of [2, 3]) {
    for (let i = 0; i < 14; i++) {
      const p = mateOnePuzzle(Chess, { rng: lcg(600 + level * 100 + i), level });
      if (!p) continue;
      check(`L${level} #${i} has exactly one mating move`, matingMoves(new Chess(p.fen)).length === 1, p.fen);
    }
  }

  // Expert tier also hides lure checks (checks that are NOT mate) to train the eye.
  let lures = 0;
  for (let i = 0; i < 24; i++) {
    const p = mateOnePuzzle(Chess, { rng: lcg(900 + i), level: 3 });
    if (!p) continue;
    if (hasLure(new Chess(p.fen))) lures++;
  }
  check('L3 puzzles tend to screen lure checks', lures >= 12, `lures=${lures}`);

  // Free-piece: easy need not grab the best, harder tiers insist on it.
  const easy = freePiecePuzzle(Chess, { rng: lcg(7), level: 1 });
  check('L1 free-piece does not demand the best grab', easy.needBest === false, `needBest=${easy.needBest}`);
  const hard = makePuzzle(Chess, 'free-piece', { rng: lcg(8), level: 3 }) ||
    fallbackFreePiece(Chess, { rng: lcg(8), level: 3 });
  check('L3 free-piece demands the best grab', hard.needBest === true && hard.level === 3,
    `needBest=${hard.needBest} level=${hard.level}`);
  const mid = makePuzzle(Chess, 'free-piece', { rng: lcg(12), level: 2 });
  check('L2 free-piece demands the best grab too', mid.needBest === true);
  check('L2 tracks the best-grab value', typeof mid.bestValue === 'number' && mid.bestValue >= 3, `bestValue=${mid.bestValue}`);

  // The needBest judge on a synthetic position with a hanging rook AND pawn:
  // black rook d2 (Rxd2, value 5) and black pawn a6 (bxa6, value 1), neither
  // defended by Black so both grabs are "legal damage" — the judge must prefer 5.
  const fen = '6k1/8/p7/1P6/8/8/3r4/3R2K1 w - - 0 1';
  const picks = findHangingCaptures(Chess, new Chess(fen));
  const pz = { drill: 'free-piece', needBest: true, bestValue: 5, solutions: picks };
  check('synthetic hanging position offers a rook and a pawn to grab',
    picks.length >= 2 && picks[0].value === 5, picks.map((q) => q.value).join(','));
  const cr = new Chess(fen);
  check('needBest accepts taking the rook', isSolved(Chess, pz, cr.fen(), cr, cr.move('Rxd2')));
  const cp = new Chess(fen);
  check('needBest rejects grabbing only the pawn', !isSolved(Chess, pz, cp.fen(), cp, cp.move('bxa6')));
  const bare = { drill: 'free-piece', needBest: false, bestValue: 5, solutions: picks };
  const cq = new Chess(fen);
  check('without needBest the pawn grab is fine', isSolved(Chess, bare, cq.fen(), cq, cq.move('bxa6')));
}

/* ---- 13. tactical diversity is deterministic and signature-led ---- */
{
  const scheduler = new PuzzleScheduler();
  const puzzles = [];
  for (let i = 0; i < 24; i++) {
    const p = mateOnePuzzle(Chess, { rng: lcg(2000 + i), level: 2, scheduler });
    if (p) { scheduler.record(p); puzzles.push(p); }
  }
  const motifs = new Set(puzzles.map((p) => p.motif));
  const sides = new Set(puzzles.map((p) => p.sideToMove));
  const pieces = new Set(puzzles.map((p) => p.solutionPiece));
  check('deterministic mate sample covers at least six tactical motifs', motifs.size >= 6, [...motifs].join(','));
  check('deterministic mate sample includes both solving colours', sides.size === 2, [...sides].join(','));
  check('deterministic mate sample uses several mating pieces', pieces.size >= 2, [...pieces].join(','));
  check('scheduler never repeats a motif consecutively', puzzles.every((p, i) => !i || p.motif !== puzzles[i - 1].motif));
  check('scheduler alternates the solving side', puzzles.every((p, i) => !i || p.sideToMove !== puzzles[i - 1].sideToMove));
  for (const p of puzzles) {
    const c = new Chess(p.fen);
    const move = c.move(p.targetSan);
    check(`diverse puzzle ${p.id} remains a valid mate`, !!move && c.isCheckmate());
  }
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL DRILL TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);
