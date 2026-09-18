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
import { emptyPracticeDrill, emptyPracticeProgress, loadPracticeProgress, savePracticeProgress, PRACTICE_STORAGE_KEY } from './assets/src/practice/progress.js';
import { resetPuzzleSession, firstAttempt, solvedProgress, revealedProgress } from './assets/src/practice/controller.js';
import { computeLevelTransition, computeAdaptiveLevelTransition, selectNextPuzzle, recordMiss, recordSolve, recordReveal } from './assets/src/practice/session.js';
import { getPracticeHint, getWrongMoveFeedback, getSolvedFeedback, getRevealFeedback } from './assets/src/practice/feedback.js';

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
  check('deterministic mate sample covers every distinct mating geometry', motifs.size >= 4, [...motifs].join(','));
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

/* ---- 14. Free-Piece 30-puzzle simulation proves scheduler bug is eliminated ---- */
{
  const scheduler = new PuzzleScheduler();
  const seen = new Set();
  const puzzles = [];
  let fallbacks = 0;
  const fens = new Set();
  const motifs = new Set();
  const sides = { w: 0, b: 0 };

  for (let i = 0; i < 30; i++) {
    const p = makePuzzle(Chess, 'free-piece', { rng: lcg(3000 + i), scheduler, seen });
    check(`FP sim #${i} returned a puzzle`, !!p);
    if (!p) continue;
    if (p.id.startsWith('free-fallback-')) fallbacks++;
    puzzles.push(p);
    fens.add(p.fen);
    motifs.add(p.motif);
    sides[p.sideToMove] = (sides[p.sideToMove] || 0) + 1;
    scheduler.record(p);

    const c = new Chess(p.fen);
    const fenBefore = c.fen();
    const move = c.move({ from: p.target.from, to: p.target.to });
    check(`FP sim #${i} (${p.id}) solution is legal capture`, !!move && !!move.captured);
    check(`FP sim #${i} is judged solved`, isSolved(Chess, p, fenBefore, c, move));
    check(`FP sim #${i} has 4 progressive hints`, Array.isArray(p.hints) && p.hints.length === 4);
    check(`FP sim #${i} has explanation`, typeof p.explanation === 'string' && p.explanation.length > 20);
    check(`FP sim #${i} has rich metadata`, typeof p.attackerPiece === 'string' && typeof p.targetPiece === 'string' && typeof p.targetSquare === 'string');
  }

  check('FP 30-puzzle simulation has ZERO fallbacks (scheduler bug eliminated)', fallbacks === 0, `fallbacks=${fallbacks}/30`);
  check('FP 30-puzzle simulation has high unique FEN rate (>= 25 distinct)', fens.size >= 25, `unique=${fens.size}/30`);
  check('FP 30-puzzle simulation has balanced White and Black sides', sides.w >= 10 && sides.b >= 10, `w=${sides.w}, b=${sides.b}`);
  check('FP 30-puzzle simulation exhibits rich tactical motif variety (>= 6)', motifs.size >= 6, [...motifs].join(', '));
  check('FP 30-puzzle simulation has no consecutive identical motifs', puzzles.every((p, i) => !i || p.motif !== puzzles[i - 1].motif));
}

/* ---- 15. Mate-in-One 30-puzzle simulation across all 8 mating families ---- */
{
  const scheduler = new PuzzleScheduler();
  const seen = new Set();
  const puzzles = [];
  const motifs = new Set();
  const sides = { w: 0, b: 0 };

  for (let i = 0; i < 30; i++) {
    const p = makePuzzle(Chess, 'mate-one', { rng: lcg(4000 + i), scheduler, seen, level: 2 });
    check(`Mate sim #${i} returned a puzzle`, !!p);
    if (!p) continue;
    puzzles.push(p);
    motifs.add(p.motif);
    sides[p.sideToMove] = (sides[p.sideToMove] || 0) + 1;
    scheduler.record(p);

    const c = new Chess(p.fen);
    const mates = matingMoves(c);
    check(`Mate sim #${i} (${p.motif}) has exactly one mating move`, mates.length === 1, mates.join(','));
    const fenBefore = c.fen();
    const move = c.move(p.targetSan);
    check(`Mate sim #${i} solution mates`, !!move && c.isCheckmate());
    check(`Mate sim #${i} is judged solved`, isSolved(Chess, p, fenBefore, c, move));
    check(`Mate sim #${i} has 4 progressive hints`, Array.isArray(p.hints) && p.hints.length === 4);
    check(`Mate sim #${i} has explanation`, typeof p.explanation === 'string' && p.explanation.length > 20);
    if (p.motif === 'queen-knight') {
      check(`Mate sim #${i} explanation uses current board squares`,
        p.explanation.includes(p.sideToMove === 'b' ? 'b4' : 'g5') && p.explanation.includes(p.target.to));
    }
  }

  check('Mate 30-puzzle simulation covers diverse mating families (>= 7)', motifs.size >= 7, [...motifs].join(', '));
  check('Mate 30-puzzle simulation has balanced White and Black sides', sides.w >= 10 && sides.b >= 10, `w=${sides.w}, b=${sides.b}`);
  check('Mate 30-puzzle simulation has no consecutive identical motifs', puzzles.every((p, i) => !i || p.motif !== puzzles[i - 1].motif));
}

/* ---- 16. Conservative adaptive difficulty transitions & anti-bouncing ---- */
{
  // Level 1: requires >= 6 attempts with >= 5 clean solves to promote
  const l1Start = computeAdaptiveLevelTransition({ currentLevel: 1, recentResults: [{ solved: true, clean: true }], streak: 1, delta: 1 });
  check('L1 single clean solve remains at L1', l1Start.level === 1 && l1Start.streak === 2);

  const fiveClean = Array(5).fill({ solved: true, clean: true });
  const l1Almost = computeAdaptiveLevelTransition({ currentLevel: 1, recentResults: fiveClean, streak: 5, delta: 1 });
  check('L1 with 5 results remains at L1 (requires 6 results)', l1Almost.level === 1);
  const legacyStreak = computeAdaptiveLevelTransition({ currentLevel: 1, recentResults: fiveClean, streak: 5, delta: 1, levelForStreak });
  check('legacy streak callback cannot bypass the six-result window', legacyStreak.level === 1);

  const sixClean = Array(6).fill({ solved: true, clean: true });
  const l1Promote = computeAdaptiveLevelTransition({ currentLevel: 1, recentResults: sixClean, streak: 6, delta: 1 });
  check('L1 with 6 clean solves promotes to L2', l1Promote.level === 2 && l1Promote.leveledUp === true);

  // Level 2 hysteresis: single failure resets streak to 0 but does NOT bounce back to L1
  const l2AfterOneFail = computeAdaptiveLevelTransition({
    currentLevel: 2,
    recentResults: [...sixClean, { solved: false, clean: false }],
    streak: 6,
    delta: 0
  });
  check('L2 single failure resets streak to 0 but stays at L2 (no level bouncing)',
    l2AfterOneFail.level === 2 && l2AfterOneFail.streak === 0);

  // Level 2 promotion to Level 3 requires >= 7 attempts with >= 6 clean solves
  const sevenClean = Array(7).fill({ solved: true, clean: true });
  const l2Promote = computeAdaptiveLevelTransition({ currentLevel: 2, recentResults: sevenClean, streak: 7, delta: 1 });
  check('L2 with 7 clean solves promotes to L3', l2Promote.level === 3 && l2Promote.leveledUp === true);

  // Level 3 hysteresis: single failure resets streak to 0 but stays at L3
  const l3AfterOneFail = computeAdaptiveLevelTransition({
    currentLevel: 3,
    recentResults: [...sevenClean, { solved: false, clean: false }],
    streak: 7,
    delta: 0
  });
  check('L3 single failure resets streak to 0 but stays at L3 (no level bouncing)',
    l3AfterOneFail.level === 3 && l3AfterOneFail.streak === 0);

  // Level 3 demotion to L2 requires repeated failures (>= 3 fails and streak === 0)
  const l3WithRepeatedFails = [
    { solved: true, clean: true },
    { solved: false, clean: false },
    { solved: true, clean: true },
    { solved: false, clean: false },
    { solved: false, clean: false },
    { solved: true, clean: true }
  ];
  const l3Demote = computeAdaptiveLevelTransition({ currentLevel: 3, recentResults: l3WithRepeatedFails, streak: 0, delta: 0 });
  check('L3 with >= 3 failures demotes to L2', l3Demote.level === 2);

  // Level 2 demotion to L1 requires repeated failures (>= 4 fails and streak === 0)
  const l2WithRepeatedFails = [
    { solved: false, clean: false },
    { solved: true, clean: true },
    { solved: false, clean: false },
    { solved: false, clean: false },
    { solved: false, clean: false },
    { solved: true, clean: true }
  ];
  const l2Demote = computeAdaptiveLevelTransition({ currentLevel: 2, recentResults: l2WithRepeatedFails, streak: 0, delta: 0 });
  check('L2 with >= 4 failures demotes to L1', l2Demote.level === 1);

  // Fallback compatibility with levelForStreak
  const fallbackL1 = computeLevelTransition(0, 1, levelForStreak);
  check('computeLevelTransition fallback: streak 1 -> L1', fallbackL1.level === 1 && fallbackL1.streak === 1);
  const fallbackL2 = computeLevelTransition(2, 1, levelForStreak);
  check('computeLevelTransition fallback: streak 3 -> L2', fallbackL2.level === 2 && fallbackL2.leveledUp === true);
}

/* ---- 17. Wrong-move check detection, progressive hints & feedback ---- */
{
  // Wrong move that gives check vs wrong move that does not give check
  const matePuzzle = { drill: 'mate-one', hint: 'Deliver mate in one.' };
  const checkFeedback = getWrongMoveFeedback(matePuzzle, { givesCheck: true, captured: false });
  check('givesCheck=true gives escape-square feedback',
    checkFeedback === 'That gives check, but the king still has an escape square.');
  const nonCheckFeedback = getWrongMoveFeedback(matePuzzle, { givesCheck: false, captured: false });
  check('givesCheck=false gives look-for-checks feedback',
    nonCheckFeedback === 'That move is safe, but it is not checkmate. Start by looking at your checks.');

  // Free-piece wrong move: recapture vs quiet
  const fpPuzzle = { drill: 'free-piece', hint: 'Find the free piece.' };
  const recapturableFeedback = getWrongMoveFeedback(fpPuzzle, { givesCheck: false, captured: true });
  check('captured=true gives recapture feedback',
    recapturableFeedback === 'That capture can be legally recaptured. Look for a clean capture.');
  const quietFeedback = getWrongMoveFeedback(fpPuzzle, { givesCheck: false, captured: false });
  check('captured=false gives unattacked feedback',
    quietFeedback === 'Look for an attacked enemy piece with no legal recapture.');

  // Progressive hints
  const samplePuzzle = {
    drill: 'mate-one',
    hints: ['Hint 1: principle', 'Hint 2: board area', 'Hint 3: piece clue', 'Hint 4: exact move'],
    target: { from: 'e1', to: 'e8' },
    explanation: 'Re8# delivers checkmate because the rook cuts off rank 8 and the king cannot escape.'
  };

  const h0 = getPracticeHint(samplePuzzle, 0);
  check('Hint step 0 has null highlight', h0.highlight === null && h0.index === 0);
  const h1 = getPracticeHint(samplePuzzle, 1);
  check('Hint step 1 has null highlight', h1.highlight === null && h1.index === 1);
  const h2 = getPracticeHint(samplePuzzle, 2);
  check('Hint step 2 highlights attacker square only',
    h2.highlight && h2.highlight.from === 'e1' && h2.highlight.to === undefined);
  const h3 = getPracticeHint(samplePuzzle, 3);
  check('Hint step 3 highlights full target (from and to)',
    h3.highlight && h3.highlight.from === 'e1' && h3.highlight.to === 'e8');

  // Solved and Reveal feedback integrate explanation
  const solvedFb = getSolvedFeedback(samplePuzzle, null);
  check('getSolvedFeedback includes puzzle explanation', solvedFb.text.includes(samplePuzzle.explanation));
  const revealFb = getRevealFeedback(samplePuzzle);
  check('getRevealFeedback returns puzzle explanation', revealFb === samplePuzzle.explanation);
}

/* ---- 18. Backward-compatible LocalStorage hydration & controller tracking ---- */
{
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear()
    };
  }

  // Pre-populate with legacy format without recentResults
  const legacyData = {
    drills: {
      'free-piece': { attempted: 15, solved: 12, solvedWithoutHint: 10, currentStreak: 4, bestStreak: 7, currentLevel: 2 },
      'mate-one': { attempted: 8, solved: 6, solvedWithoutHint: 5, currentStreak: 2, bestStreak: 3, currentLevel: 1 }
    }
  };
  localStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(legacyData));

  const hydrated = loadPracticeProgress(DRILL_IDS);
  check('hydrated legacy free-piece preserves attempted', hydrated.drills['free-piece'].attempted === 15);
  check('hydrated legacy free-piece preserves solved', hydrated.drills['free-piece'].solved === 12);
  check('hydrated legacy free-piece preserves streak', hydrated.drills['free-piece'].currentStreak === 4);
  check('hydrated legacy free-piece adds recentResults array', Array.isArray(hydrated.drills['free-piece'].recentResults));
  check('hydrated legacy mate-one adds recentResults array', Array.isArray(hydrated.drills['mate-one'].recentResults));

  // Test controller functions append and cap at 8
  let drillProg = hydrated.drills['free-piece'];
  for (let i = 0; i < 10; i++) {
    drillProg = solvedProgress(drillProg, { usedHint: i % 2 !== 0, misses: 0, level: 2 });
  }
  check('solvedProgress caps recentResults at 8', drillProg.recentResults.length === 8);
  check('solvedProgress tracks clean flag accurately (hint used -> clean false)',
    drillProg.recentResults[drillProg.recentResults.length - 1].clean === false);
  const cleanSolve = solvedProgress(drillProg, { usedHint: false, misses: 0, level: 2 });
  check('solved without hint tracks clean === true',
    cleanSolve.recentResults[cleanSolve.recentResults.length - 1].clean === true);

  drillProg = revealedProgress(drillProg, 2);
  check('revealedProgress records false for solved and clean',
    drillProg.recentResults[drillProg.recentResults.length - 1].solved === false &&
    drillProg.recentResults[drillProg.recentResults.length - 1].clean === false);
  check('revealedProgress resets currentStreak to 0', drillProg.currentStreak === 0);
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL DRILL TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);
