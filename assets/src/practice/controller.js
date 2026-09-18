/** Pure Practice lifecycle decisions. The app remains responsible for UI,
 * chess mutations, sound, and scheduling the next puzzle. */
export function resetPuzzleSession() {
  return { solved: false, misses: 0, hintStep: 0, attempted: false };
}

export function firstAttempt(progress) {
  return { ...progress, attempted: progress.attempted + 1 };
}

export function solvedProgress(progress, { usedHint, misses = 0, level }) {
  const currentStreak = progress.currentStreak + 1;
  const clean = !usedHint && misses === 0;
  const recentResults = [...(progress.recentResults || []), { solved: true, clean }].slice(-8);
  return {
    ...progress,
    solved: progress.solved + 1,
    solvedWithoutHint: progress.solvedWithoutHint + (usedHint ? 0 : 1),
    currentStreak,
    bestStreak: Math.max(progress.bestStreak, currentStreak),
    currentLevel: level,
    recentResults
  };
}

export function revealedProgress(progress, level) {
  const recentResults = [...(progress.recentResults || []), { solved: false, clean: false }].slice(-8);
  return { ...progress, currentStreak: 0, currentLevel: level, recentResults };
}
