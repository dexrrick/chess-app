const PRAISE = {
  'free-piece': 'You are spotting hanging pieces like a pro!',
  'mate-one': 'You are learning to spot checkmating moves!'
};

export function getPracticeHint(puzzle, step) {
  const hints = puzzle.hints?.length ? puzzle.hints : [puzzle.hint];
  const index = Math.min(step, hints.length - 1);
  let highlight = null;
  if (hints.length >= 4) {
    if (index === 2 && puzzle.target?.from) {
      highlight = { from: puzzle.target.from };
    } else if (index >= 3) {
      highlight = puzzle.target || null;
    }
  } else if (index >= 1) {
    highlight = puzzle.target || null;
  }
  return { index, text: hints[index], highlight };
}

export function getWrongMoveFeedback(puzzle, { givesCheck, captured }) {
  if (puzzle.drill === 'mate-one') return givesCheck
    ? 'That gives check, but the king still has an escape square.'
    : 'That move is safe, but it is not checkmate. Start by looking at your checks.';
  return captured
    ? 'That capture can be legally recaptured. Look for a clean capture.'
    : 'Look for an attacked enemy piece with no legal recapture.';
}

export function getSolvedFeedback(puzzle, captured) {
  if (puzzle.drill === 'mate-one') {
    const text = puzzle.explanation
      ? `Brilliant! ${puzzle.explanation} ${PRAISE[puzzle.drill]}`
      : `Brilliant! ${puzzle.targetSan} traps the king. ${PRAISE[puzzle.drill]}`;
    return { title: 'Checkmate!', text };
  }
  const text = puzzle.explanation
    ? `You took the ${captured}! ${puzzle.explanation} ${PRAISE[puzzle.drill]}`
    : `You took the ${captured} — it really was all alone. ${PRAISE[puzzle.drill]}`;
  return { title: 'Solved!', text };
}

export function getRevealFeedback(puzzle) {
  if (puzzle.explanation) {
    return puzzle.explanation;
  }
  return `${puzzle.hint} ${puzzle.drill === 'mate-one' ? 'That is checkmate!' : 'Remember this pattern — always scan for lonely pieces.'}`;
}
