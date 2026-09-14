import { Chess } from './assets/vendor/chess.js';
import { freePiecePuzzle, mateOnePuzzle, MATE_GENERATOR_HEALTH, resetMateGeneratorHealth } from './assets/src/drills.js';
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
let bad = 0;
for (const [name, make] of [['free', freePiecePuzzle], ['mate', mateOnePuzzle]]) {
  const seen = new Set(), out = [];
  for (let i = 0; i < 100; i++) { const p = make(Chess, { rng: lcg(12000 + i), seen, level: 3 }); if (p) out.push(p); }
  const count = (key) => Object.fromEntries([...new Set(out.map(key))].map((v) => [v, out.filter((p) => key(p) === v).length]));
  const landings = count((p) => p.target.to); const peak = Math.max(...Object.values(landings));
  console.log(`${name}: ${out.length}/100, motifs=${JSON.stringify(count((p) => p.motif))}, sides=${JSON.stringify(count((p) => p.sideToMove))}, peakLanding=${peak}`);
  if (name === 'mate') for (const motif of Object.keys(count((p) => p.motif))) {
    const group = out.filter((p) => p.motif === motif);
    const hist = (fn) => Object.fromEntries([...new Set(group.map(fn))].map((v) => [v, group.filter((p) => fn(p) === v).length]));
    const king = (p) => { const c = new Chess(p.fen); for (const r of '12345678') for (const f of 'abcdefgh') if (c.get(f + r)?.type === 'k' && c.get(f + r)?.color !== p.sideToMove) return f + r; };
    console.log(`${motif}: landings=${JSON.stringify(hist((p) => p.target.to))} kings=${JSON.stringify(hist(king))} pieces=${JSON.stringify(hist((p) => p.solutionPiece))} sides=${JSON.stringify(hist((p) => p.sideToMove))}`);
    const motifLandings = hist((p) => p.target.to);
    if (Object.keys(motifLandings).length < 4 || Math.max(...Object.values(motifLandings)) > group.length / 2) bad++;
  }
  if (out.length !== 100 || new Set(out.map((p) => p.fen)).size !== out.length || peak > 20) bad++;
}
console.log('mate health', JSON.stringify(MATE_GENERATOR_HEALTH));
process.exit(bad ? 1 : 0);
