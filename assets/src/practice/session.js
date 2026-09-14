export function computeLevelTransition(streak, delta, levelForStreak) {
  const nextStreak = delta === 0 ? 0 : Math.max(0, streak + delta);
  return { streak: nextStreak, level: levelForStreak(nextStreak), leveledUp: delta > 0 && levelForStreak(nextStreak) !== levelForStreak(streak) };
}

export function selectNextPuzzle({ Chess, drill, level, seen, scheduler, makePuzzle }) {
  const puzzle = makePuzzle(Chess, drill, { seen, scheduler, level });
  return puzzle ? { puzzle, shouldRecord: true } : { puzzle: null, shouldRecord: false };
}

export function recordMiss(misses) { return { misses: misses + 1, reveal: misses + 1 >= 3 }; }
export function recordSolve() { return { review: true, nextAction: 'review' }; }
export function recordReveal() { return { review: true, resetStreak: true, nextAction: 'review' }; }
