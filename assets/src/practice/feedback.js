const PRAISE = {
  'free-piece': 'You are spotting hanging pieces like a pro!',
  'mate-one': 'You are learning to spot checkmating moves!'
};

export function getPracticeHint(puzzle, step) {
  const hints = puzzle.hints?.length ? puzzle.hints : [puzzle.hint];
  const index = Math.min(step, hints.length - 1);
  return { index, text: hints[index], highlight: index >= 1 ? puzzle.target : null };
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
  return puzzle.drill === 'mate-one'
    ? { title: 'Checkmate!', text: `Brilliant! ${puzzle.targetSan} traps the king. ${PRAISE[puzzle.drill]}` }
    : { title: 'Solved!', text: `You took the ${captured} — it really was all alone. ${PRAISE[puzzle.drill]}` };
}

export function getRevealFeedback(puzzle) {
  return `${puzzle.hint} ${puzzle.drill === 'mate-one' ? 'That is checkmate!' : 'Remember this pattern — always scan for lonely pieces.'}`;
}
