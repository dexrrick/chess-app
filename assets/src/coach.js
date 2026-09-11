/**
 * coach.js — turns engine numbers and board facts into kid-friendly advice.
 *
 * Two responsibilities:
 *   1. classify()  — turn a centipawn swing into a tier + friendly message.
 *   2. describe()  — explain *why* a move is good or bad using simple board
 *                    ideas (centre, development, king safety, hanging pieces).
 */

import { PIECE_NAMES, PIECE_VALUES } from './pieces.js';

/** Tiers, ordered best → worst. `max` is the centipawn loss ceiling. */
export const TIERS = {
  brilliant: { key: 'brilliant', label: 'Brilliant!', max: 0, icon: '\u2605' },
  best: { key: 'best', label: 'Best move!', max: 10, icon: '\u2605' },
  good: { key: 'good', label: 'Solid', max: 50, icon: '\u2713' },
  okay: { key: 'good', label: 'Okay', max: 120, icon: '\u2713' },
  inaccuracy: { key: 'inaccuracy', label: 'Hmm…', max: 250, icon: '\u26A0' },
  mistake: { key: 'mistake', label: 'Careful!', max: 500, icon: '\u26A0' },
  blunder: { key: 'blunder', label: 'Oops!', max: Infinity, icon: '\u2716' }
};

/** Friendly openers per tier, chosen at random so it doesn't feel robotic. */
const OPENERS = {
  brilliant: ['Wow — spot on!', 'Brilliant!', 'Amazing move!'],
  good: ['Nice one!', 'Good move.', 'That works well.'],
  inaccuracy: ['Hmm, careful.', 'Almost — but look again.', 'Not the best, but okay.'],
  mistake: ['Careful!', 'That one is risky.', 'Hmm, that gives something away.'],
  blunder: ['Oops!', 'Oh no — watch out!', 'That one hurts a bit.']
};

const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5']);
const EXTENDED_CENTER = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'd4', 'e4', 'f4',
  'c5', 'd5', 'e5', 'f5', 'c6', 'd6', 'e6', 'f6']);
const HOME_RANK = { w: ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2'],
  b: ['a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8', 'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7'] };

/**
 * Classify a move by centipawn loss.
 * @param {number} loss       centipawns lost vs. the best available move
 * @param {boolean} isBest    true when the played move *was* the engine's choice
 * @param {object} details    { wasCapture, wasCheck, wasCastle, isSacrifice,
 *                              opponentBestReplyIsCapture, hungPiece, phase }
 */
export function classify(loss, isBest, details = {}) {
  let tier;
  if (isBest || loss <= 10) tier = 'brilliant';
  else if (loss <= 50) tier = 'good';
  else if (loss <= 120) tier = 'good';
  else if (loss <= 250) tier = 'inaccuracy';
  else if (loss <= 500) tier = 'mistake';
  else tier = 'blunder';

  // A capture that also gives check and is best is genuinely brilliant;
  // a "best" move that is a quiet developing move is merely Good.
  if (tier === 'brilliant') {
    const special = details.wasCapture || details.wasCheck || details.wasCastle ||
      details.isSacrifice || details.wasPromotion;
    if (!special) tier = 'good';
  }
  return tier;
}

/**
 * Build the full coach message for a played move.
 *
 * @returns {{tier:string, label:string, text:string, title:string}}
 */
export function describeMove(ctx) {
  const {
    tier,
    san,
    color,          // 'w' | 'b'  (who moved)
    details = {},
    loss = 0
  } = ctx;

  const opener = pick(OPENERS[tier] || OPENERS.good);
  const meta = TIERS[Object.keys(TIERS).find((k) => TIERS[k].key === tier) || 'good'] || TIERS.good;

  const reasons = [];
  const side = color === 'w' ? 'White' : 'Black';
  const to = details.to;

  if (tier === 'blunder' || tier === 'mistake') {
    if (details.opponentBestReplyIsCapture && details.hungPiece) {
      reasons.push(`your ${PIECE_NAMES[details.hungPiece] || 'piece'} on ${details.hungSquare || to} is now unguarded — they can just take it.`);
    }
    if (details.hungPiece && !details.opponentBestReplyIsCapture) {
      reasons.push(`that leaves your ${PIECE_NAMES[details.hungPiece]} looking a bit lonely. Keep pieces where a friend can protect them.`);
    }
    if (details.losesMaterial) {
      reasons.push('you might lose a piece for free here. Before you move, ask: “is my new square safe?”');
    }
    if (details.kingExposed) {
      reasons.push('the king is feeling the draft — an open king is dangerous.');
    }
    if (reasons.length === 0) {
      reasons.push(`there was a stronger idea. Try to make every move do a job: attack, defend, or get a new piece out.`);
    }
    reasons.push(`Next time look for a move that does one of these: **capture safely**, **defend a friend**, or **make a threat**.`);
  } else if (tier === 'inaccuracy') {
    if (details.betterWasCapture) {
      reasons.push('there was a free piece to take! Always check for captures first.');
    } else if (CENTER_SQUARES.has(to) || EXTENDED_CENTER.has(to)) {
      reasons.push('your move is fine, but a slightly stronger idea was available. Keep fighting for the four centre squares (d4, e4, d5, e5).');
    } else {
      reasons.push('it is safe, but a better move existed. Look for moves that **develop a piece** or **control the centre**.');
    }
  } else {
    // good / brilliant
    if (details.wasCastle) {
      reasons.push('castling tucks your king away safely and wakes up your rook. Very grown-up chess!');
    }
    if (details.wasCapture) {
      const gained = details.capturedValue || 0;
      reasons.push(gained > 0
        ? `you won a ${PIECE_NAMES[details.capturedPiece] || 'piece'} — nice trading!`
        : 'you took a piece, which keeps the board balanced.');
    }
    if (details.wasPromotion) {
      reasons.push('your little pawn grew up into a big piece!');
    }
    if (CENTER_SQUARES.has(to)) {
      reasons.push('that plant a piece right in the centre, where it can see the most squares.');
    } else if (EXTENDED_CENTER.has(to)) {
      reasons.push('good — you are helping control the middle of the board.');
    }
    if (details.isDevelopment) {
      reasons.push('this brings a new piece into the game. Try to get your knights and bishops out early.');
    }
    if (details.wasCheck) {
      reasons.push('check! Their king has to react to you.');
    }
    if (details.defendsHanging) {
      reasons.push('you saved a piece that was in trouble.');
    }
    if (details.wasFork) {
      reasons.push('that attacks two things at once — super tricky to answer!');
    }
    if (reasons.length === 0) {
      reasons.push('keep it up — every safe move makes your position a little stronger.');
    }
  }

  const text = `${opener} ${capitalize(reasons[0])}${reasons.length > 1 ? ' ' + capitalize(reasons[1]) : ''}`;

  return {
    tier,
    label: meta.label,
    title: `${side} played ${san}`,
    text
  };
}

/**
 * Describe a hint in friendly language.
 */
export function describeHint(hintCtx) {
  const { san, from, to, moveNumber, tier } = hintCtx;
  const bits = [
    `Try ${san} — move from ${from} to ${to}.`,
    tier === 'brilliant' || tier === 'best'
      ? 'This is a strong idea. Look at what it attacks!'
      : 'This keeps everything safe and makes your position a bit better.'
  ];
  return bits.join(' ');
}

/** Opening principles shown at the start of a game. */
export function openingTip() {
  return pick([
    'Remember the three rules of the opening: **get the centre**, **bring out your knights and bishops**, and **castle early**.',
    'Tip: start by putting a pawn in the middle (e4 or d4), then wake up your knights.',
    'Tip: before every move, ask “is my piece safe there?” That one question wins lots of games.',
    'Tip: try not to move the same piece twice in the opening. There are friends waiting to play!'
  ]);
}

/** Positional assessment text for the eval meter. */
export function evalText(cp) {
  if (cp === null || cp === undefined || Number.isNaN(cp)) return 'Thinking…';
  const abs = Math.abs(cp);
  const who = cp > 0 ? 'White' : 'Black';
  if (abs < 25) return 'Even game';
  if (abs < 75) return `${who} is a tiny bit ahead`;
  if (abs < 200) return `${who} is a little better`;
  if (abs < 500) return `${who} is clearly better`;
  if (abs < 1500) return `${who} is winning`;
  return abs >= 1990 ? `${who} has mate soon` : `${who} is completely winning`;
}

/* ============================== helpers ================================== */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

export function materialCount(chess) {
  const board = chess.board();
  const totals = { w: 0, b: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      totals[sq.color] += PIECE_VALUES[sq.type] || 0;
    }
  }
  return totals;
}

export function phaseOf(chess) {
  const m = materialCount(chess);
  const total = m.w + m.b;
  if (total > 40) return 'opening';
  if (total > 20) return 'middlegame';
  return 'endgame';
}
