import { Chess } from './assets/vendor/chess.js';
import { freePiecePuzzle, mateOnePuzzle } from './assets/src/drills.js';

function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
for (const [name, make] of [['FREE PIECE', freePiecePuzzle], ['MATE IN ONE', mateOnePuzzle]]) {
  console.log(`\n${name}`);
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const p = make(Chess, { rng: lcg(8000 + i), seen, level: 3 });
    console.log(`${String(i + 1).padStart(2, '0')} ${p?.motif} | ${p?.sideToMove} | ${p?.targetSan} | ${p?.fen}`);
  }
}
