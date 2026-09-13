/**
 * pieces.js — chess piece sprites.
 *
 * The live board renders each piece from one locally bundled sprite sheet
 * (`assets/pieces-atlas-inspired.png`, a 6 × 2 grid: ivory pieces on the first
 * row, charcoal on the second; each row is ordered king, queen, rook, bishop,
 * knight, pawn). `pieceSvg()` only picks the right cell by emitting
 * `--sprite-x`/`--sprite-y`, which `style.css` turns into a
 * `background-position`. That keeps the board free of extra image requests and
 * works offline and on e-ink panels.
 *
 * `SHAPES`/`BASE` below are raw SVG drawings used only by the dev-only preview
 * harness (`preview/`) to experiment with the artwork — they are not what the
 * live app renders. They are original work on a 45x45 grid, not derived from
 * any third-party piece set, so no extra licence applies. They share one plinth
 * (x 11..34, y 36.4..40); `assets/favicon.svg` mirrors the king — keep the two
 * in step.
 */

/** A two-step plinth gives every piece the poised Staunton-style stance. */
const BASE =
  'M10.2 37.1h24.6v2.2H10.2z M12.2 34.5h20.6a1.5 1.5 0 0 1 1.5 1.5v1.1H10.7V36a1.5 1.5 0 0 1 1.5-1.5z';

/**
 * One entry per piece type. `body` is filled; `detail` is stroked in the
 * contrasting colour. Adding a line to `detail` is how structure becomes
 * visible on BOTH black and white pieces.
 *
 * Exported so the dev-only preview harness (preview/) can re-render the very
 * same artwork at other stroke weights instead of keeping its own copy.
 */
export const SHAPES = {
  /* ---------------------------------------------------------------- pawn */
  p: {
    body: [
      BASE,
      'M22.5 8.2a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z',
      'M18.8 18.4h7.4l1.9 3.1-1.1 2.2 3.2 10.8H14.8L18 23.7l-1.1-2.2z',
    ],
    detail: [
      'M18.2 21.5h8.6',
    ],
  },

  /* -------------------------------------------------------------- knight */
  n: {
    body: [
      BASE,
      'M14.5 34.5c.2-7.5.8-12.7 2.3-16.6 1.1-3.1 2.8-5.7 5.1-7.8l-.7-3.6 2.2-1.6 2.2 4.1c3.2.8 5.8 2.8 7.5 5.5 1.2 1.8 1.9 3.9 2.3 6.1l-3.2 1.2 1.3 2.4-3.6 1.6c.3 3 .9 5.9 1.8 8.7z',
    ],
    detail: [
      'M25.2 14.2h.1',
      'M18 27c.9-5.7 2.5-9.8 5.2-12.5',
      'M29.6 19.1l2.4-.3',
    ],
  },

  /* -------------------------------------------------------------- bishop */
  b: {
    body: [
      BASE,
      'M22.5 7.2c3.8 3.1 6.1 7.1 6.1 11.1 0 2.1-.8 4.1-2.2 5.6l-2 2.1 2.5 8.5H18l2.5-8.5-2-2.1a8.1 8.1 0 0 1-2.2-5.6c0-4 2.4-8 6.2-11.1z',
    ],
    detail: [
      'M18.7 21.2l7.6-8.6',
      'M19.7 27.2h5.6',
    ],
  },

  /* --------------------------------------------------------------- rook */
  r: {
    body: [
      BASE,
      'M12.2 9.3h4.5v3.8h3.7V9.3h4.2v3.8h3.7V9.3h4.5v7.5h-2.2l-1.5 17.7H15.9l-1.5-17.7h-2.2z',
    ],
    detail: [
      'M14.4 16.8h16.2',
      'M16.4 25.2h12.2',
    ],
  },

  /* -------------------------------------------------------------- queen */
  q: {
    body: [
      BASE,
      // A quiet three-point crown: unmistakably a queen without tiny pearls
      // that would turn into visual noise on an e-ink screen.
      'M14.2 10.6l4.2 6.3 2.1-9.1 2 8.1 2-10.6 2 10.6 2-8.1 2.1 9.1 4.2-6.3-2.6 12.5-2.2 11.1H19l-2.2-11.1z',
    ],
    detail: [
      'M16.1 23.7h12.8',
    ],
  },

  /* --------------------------------------------------------------- king */
  k: {
    body: [
      BASE,
      'M21.1 4.8h2.8v3.5h3.8v2.5h-3.8v3h-2.8v-3h-3.8V8.3h3.8z',
      // Broad shoulders and a tall, tapered stem make the king read first.
      'M17.3 15.3h10.4l1.2 2.1-2.3 4.7 1.4 2.1 2.2 10.3H15.8L18 24.2l1.4-2.1-2.3-4.7z',
    ],
    detail: [
      'M18.5 23.9h8',
      'M17.5 29.5h10',
    ],
  },
};

/**
 * Build a sprite-backed chess piece.
 *
 * The original e-ink set is packaged as one local, transparent two-row sprite
 * sheet: ivory on the first row and charcoal on the second. Keeping one atlas
 * avoids twelve network requests while giving the board a consistently drawn
 * set instead of six unrelated icon shapes.
 *
* @param {string} type   one of p n b r q k
 * @param {'w'|'b'} color
 * @returns {string} sprite <span> markup
 */
export function pieceSvg(type, color) {
  if (!SHAPES[type]) return '';
  const cls = `piece piece-${color === 'w' ? 'w' : 'b'}`;
  const col = { k: 0, q: 20, r: 40, b: 60, n: 80, p: 100 }[type];
  const row = color === 'w' ? 0 : 100;
  return `<span class="${cls} piece-${type}" style="--sprite-x:${col}%;--sprite-y:${row}%" aria-hidden="true"></span>`;
}

/**
 * Human-readable piece names for accessibility labels.
 */
export const PIECE_NAMES = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
};

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
