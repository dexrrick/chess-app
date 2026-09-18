export function computeLevelTransition(streak, delta, levelForStreak) {
  const nextStreak = delta === 0 ? 0 : Math.max(0, streak + delta);
  return { streak: nextStreak, level: levelForStreak(nextStreak), leveledUp: delta > 0 && levelForStreak(nextStreak) !== levelForStreak(streak) };
}

export function computeAdaptiveLevelTransition({ currentLevel = 1, recentResults = [], streak = 0, delta = 0 }) {
  const nextStreak = delta === 0 ? 0 : Math.max(0, streak + delta);
  const recent = (recentResults || []).slice(-8);
  const cleanCount = recent.filter((r) => r && r.solved && r.clean).length;
  const failCount = recent.filter((r) => r && !r.solved).length;

  let nextLevel = Math.max(1, Math.min(3, currentLevel || 1));

  if (nextLevel === 1) {
    if (delta > 0 && recent.length >= 6 && cleanCount >= 5) {
      nextLevel = 2;
    }
  } else if (nextLevel === 2) {
    if (recent.length >= 6 && failCount >= 4 && nextStreak === 0) {
      nextLevel = 1;
    } else if (delta > 0 && recent.length >= 7 && cleanCount >= 6) {
      nextLevel = 3;
    }
  } else if (nextLevel === 3) {
    if (recent.length >= 6 && failCount >= 3 && nextStreak === 0) {
      nextLevel = 2;
    }
  }

  const leveledUp = delta > 0 && nextLevel > currentLevel;
  return { streak: nextStreak, level: nextLevel, leveledUp };
}

export function selectNextPuzzle({ Chess, drill, level, seen, scheduler, makePuzzle }) {
  const puzzle = makePuzzle(Chess, drill, { seen, scheduler, level });
  return puzzle ? { puzzle, shouldRecord: true } : { puzzle: null, shouldRecord: false };
}

export function recordMiss(misses) { return { misses: misses + 1, reveal: misses + 1 >= 3 }; }
export function recordSolve() { return { review: true, nextAction: 'review' }; }
export function recordReveal() { return { review: true, resetStreak: true, nextAction: 'review' }; }
