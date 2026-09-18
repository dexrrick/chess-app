export const PRACTICE_STORAGE_KEY = 'chessclub.practice.v1';

export function emptyPracticeDrill() {
  return { attempted: 0, solved: 0, solvedWithoutHint: 0, currentStreak: 0, bestStreak: 0, currentLevel: 1, recentResults: [] };
}

export function emptyPracticeProgress() {
  return { drills: { 'free-piece': emptyPracticeDrill(), 'mate-one': emptyPracticeDrill() } };
}

export function loadPracticeProgress(drillIds) {
  try {
    const stored = JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY));
    if (!stored || typeof stored !== 'object' || !stored.drills) return emptyPracticeProgress();
    for (const id of drillIds) {
      const merged = { ...emptyPracticeDrill(), ...(stored.drills[id] || {}) };
      if (!Array.isArray(merged.recentResults)) {
        merged.recentResults = [];
      } else {
        merged.recentResults = merged.recentResults.slice(-8);
      }
      stored.drills[id] = merged;
    }
    return stored;
  } catch { return emptyPracticeProgress(); }
}

export function savePracticeProgress(progress) {
  try { localStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(progress)); } catch { /* optional browser storage */ }
}
