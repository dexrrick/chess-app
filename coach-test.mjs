/**
 * coach-test.mjs — unit tests for the move grader (assets/src/coach.js).
 *
 * A pure module with no DOM or engine dependency, so the tier boundaries and
 * the wording can be pinned down exactly and instantly in Node.
 *
 * The two defects these guard against: a declared tier that no loss value could
 * ever produce, and hint text that never varied because the caller passed no
 * tier.
 */

import { TIERS, classify, describeMove, describeHint } from './assets/src/coach.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

const TIER_ORDER = Object.keys(TIERS);     // declared best → worst
const SPECIAL = { wasCapture: true };

/* ---- 1. the tier table is self-consistent ---- */
{
  for (const [name, meta] of Object.entries(TIERS)) {
    check(`tier "${name}" has a matching key`, meta.key === name, String(meta.key));
    check(`tier "${name}" has a label`,
      typeof meta.label === 'string' && meta.label.length > 0);
  }
  const ceilings = TIER_ORDER.map((t) => TIERS[t].max);
  check('tier ceilings increase from best to worst',
    ceilings.every((m, i) => i === 0 || m > ceilings[i - 1]), ceilings.join(','));
}

/* ---- 2. classify boundaries ---- */
{
  check('loss 10 is still "best"', classify(10) === 'best', classify(10));
  check('loss 11 drops to "good"', classify(11) === 'good', classify(11));
  check('loss 50 is "good"', classify(50) === 'good', classify(50));
  check('loss 51 drops to "okay"', classify(51) === 'okay', classify(51));
  check('loss 120 is "okay"', classify(120) === 'okay', classify(120));
  check('loss 121 drops to "inaccuracy"', classify(121) === 'inaccuracy', classify(121));
  check('loss 250 is "inaccuracy"', classify(250) === 'inaccuracy', classify(250));
  check('loss 251 drops to "mistake"', classify(251) === 'mistake', classify(251));
  check('loss 500 is "mistake"', classify(500) === 'mistake', classify(500));
  check('loss 501 drops to "blunder"', classify(501) === 'blunder', classify(501));
}

/* ---- 3. brilliant is gated on quality; plain "best" is reachable ---- */
{
  check('an engine-best quiet move is "best"', classify(0, true, {}) === 'best',
    classify(0, true, {}));
  check('an engine-best capture is "brilliant"',
    classify(0, true, SPECIAL) === 'brilliant');
  check('an engine-best check is "brilliant"',
    classify(0, true, { wasCheck: true }) === 'brilliant');
  check('an engine-best castle is "brilliant"',
    classify(0, true, { wasCastle: true }) === 'brilliant');
  check('an engine-best promotion is "brilliant"',
    classify(0, true, { wasPromotion: true }) === 'brilliant');
  check('a lossy capture is never brilliant',
    classify(400, false, SPECIAL) === 'mistake', classify(400, false, SPECIAL));
}

/* ---- 4. every declared tier is reachable (the bug that started this) ---- */
{
  const reached = new Set();
  for (let loss = 0; loss <= 2000; loss += 1) {
    for (const isBest of [false, true]) {
      for (const details of [{}, SPECIAL, { wasCheck: true }]) {
        reached.add(classify(loss, isBest, details));
      }
    }
  }
  const unreachable = TIER_ORDER.filter((t) => !reached.has(t));
  check('no declared tier is unreachable', unreachable.length === 0,
    unreachable.join(', ') || 'all reachable');
  const unknown = [...reached].filter((t) => !TIERS[t]);
  check('classify never returns an undeclared tier', unknown.length === 0,
    unknown.join(', ') || 'none');
}

/* ---- 5. grading never improves as the loss grows ---- */
{
  let previous = 0;
  let monotonic = true;
  let brokeAt = -1;
  for (let loss = 0; loss <= 2000; loss += 1) {
    const rank = TIER_ORDER.indexOf(classify(loss, false, {}));
    if (rank < previous) { monotonic = false; brokeAt = loss; break; }
    previous = rank;
  }
  check('severity never improves as the loss grows', monotonic, `broke at loss=${brokeAt}`);
}

/* ---- 6. hint wording depends on the tier ---- */
{
  const strong = describeHint({ san: 'Nf3', from: 'g1', to: 'f3', tier: 'best' });
  const weak = describeHint({ san: 'Nf3', from: 'g1', to: 'f3', tier: 'good' });
  check('a top-choice hint names the move and squares',
    /Nf3/.test(strong) && /g1/.test(strong) && /f3/.test(strong), strong);
  check('a top-choice hint uses the strong line', /strong idea/i.test(strong), strong);
  check('a lesser hint uses the safe line', /keeps everything safe/i.test(weak), weak);
  check('the two hint texts are no longer identical', strong !== weak);
  check('a brilliant hint also uses the strong line',
    /strong idea/i.test(describeHint({ san: 'Qh5', from: 'd1', to: 'h5', tier: 'brilliant' })));
  check('an untiered hint still returns a sentence',
    /^Try .+ — move from .+ to .+\./.test(describeHint({ san: 'e4', from: 'e2', to: 'e4' })));
}

/* ---- 7. describeMove labels match the tier table ---- */
{
  for (const tier of TIER_ORDER) {
    const msg = describeMove({ tier, san: 'e4', color: 'w', details: {}, loss: 0 });
    check(`describeMove wires up tier "${tier}"`, msg.label === TIERS[tier].label,
      `${msg.label} vs ${TIERS[tier].label}`);
    check(`describeMove gives "${tier}" real text`,
      typeof msg.text === 'string' && msg.text.length > 10);
  }
  const msg = describeMove({ tier: 'blunder', san: 'Qh5', color: 'b', details: {}, loss: 900 });
  check('describeMove titles include the side and the move',
    /Black/.test(msg.title) && /Qh5/.test(msg.title), msg.title);
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL COACH TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);
