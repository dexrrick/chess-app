/**
 * pieces.js — inline SVG chess piece sprites.
 *
 * We draw the pieces ourselves instead of pulling images so that:
 *  - there are zero extra network requests (great for e-ink / offline),
 *  - the shapes are pure black & white, which reads well on low-contrast,
 *    greyscale e-ink panels.
 *
 * The artwork here is drawn from scratch on a 45x45 grid; it is not derived
 * from any third-party piece set, so no extra licence applies.
 *
 * Two layers per piece
 * --------------------
 * Each piece is two groups of paths, and `style.css` colours them
 * differently:
 *
 *   .piece-body    the silhouette — filled with the piece colour and outlined
 *                  in black.
 *   .piece-detail  the internal lines (base bands, collars, the king's robe
 *                  band, the bishop's mitre slit, the knight's mane). These
 *                  are stroked in the CONTRASTING colour, so a black piece
 *                  gets white detail lines and a white piece gets black ones.
 *
 * The detail layer is what stops a black piece from collapsing into a solid
 * blob. With one fill and one stroke for everything, a black piece (black fill
 * + black stroke) loses every internal line, while a white piece keeps them —
 * which is why the two sides used to look like different sets.
 *
 * Shared baseline: every piece stands on one plinth (x 11..34, y 36.4..40).
 * `assets/favicon.svg` mirrors the king; keep the two in step.
 */

/** Shared plinth, so all six pieces sit on the same baseline. */
const BASE =
  'M11.9 36.4h21.2a0.9 0.9 0 0 1 .9.9v1.8a0.9 0.9 0 0 1-.9.9H11.9a0.9 0.9 0 0 1-.9-.9v-1.8a0.9 0.9 0 0 1 .9-.9z';

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
      // head (circle r=4.5 @ 22.5,13.9) flowing into a neck, flaring to the foot
      'M22.5 9.4c2.5 0 4.5 2 4.5 4.5 0 1.7-1 3.2-2.4 4 2.6 1 4.4 3.6 4.4 6.5l1.8 12H14.2l1.8-12c0-2.9 1.8-5.5 4.4-6.5-1.4-.8-2.4-2.3-2.4-4 0-2.5 2-4.5 4.5-4.5z',
    ],
    detail: [
      'M16.4 24.4h12.2', // collar where the neck meets the body
    ],
  },

  /* -------------------------------------------------------------- knight */
  n: {
    body: [
      BASE,
      'M14.0 36.4C14.2 30.0 14.6 25.6 15.6 21.6C16.6 18.0 17.6 15.8 18.8 14.2L19.3 11.2L18.9 8.4L20.7 6.6L22.4 9.4C25.0 10.4 27.6 11.9 29.8 14.1C32.0 16.3 33.9 19.3 35.2 24.2C35.5 26.4 32.8 27.8 29.2 29.2C29.6 31.4 30.3 33.9 30.9 36.4Z',
    ],
    detail: [
      'M23.0 14.4a1.4 1.4 0 0 1 2.8 0',            // eye
      'M17.2 27.5C17.9 22.5 19.4 18.2 21.9 14.8',  // mane down the neck
      'M32.4 21.9h1.6',                             // nostril
    ],
  },

  /* -------------------------------------------------------------- bishop */
  b: {
    body: [
      BASE,
      'M22.5 10.6c3.1 1.6 5.3 4.8 5.3 8.6 0 2.0-.6 3.8-1.6 5.3L27.4 26.0c1.0 1.3 1.6 2.9 1.6 4.6 0 2.2.6 4.2 1.9 5.8H14.1c1.3-1.6 1.9-3.6 1.9-5.8 0-1.7.6-3.3 1.6-4.6L18.8 24.5c-1.0-1.5-1.6-3.3-1.6-5.3 0-3.8 2.2-7.0 5.3-8.6z', // mitre + collar step + skirt
      'M22.5 6.8a2 2 0 1 0 .01 0z',   // finial ball
    ],
    detail: [
      'M19.6 21.6L25.4 15.8', // mitre slit
      'M16.4 30.6h12.2',      // band between the collar and the skirt
    ],
  },

  /* --------------------------------------------------------------- rook */
  r: {
    body: [
      BASE,
      'M12.6 10.2h4.6v4.0h3.2v-4.0h4.8v4.0h3.2v-4.0h4.6v7.0h-2.2l2.2 19.2H12.6l2.2-19.2h-2.2z',
    ],
    detail: [
      'M14.8 17.2h16', // line under the battlements
    ],
  },

  /* -------------------------------------------------------------- queen */
  q: {
    body: [
      BASE,
      'M12.5 13.6L15.0 20.4L17.5 10.8L20.0 20.4L22.5 9.2L25.0 20.4L27.5 10.8L30.0 20.4L32.5 13.6C32.9 17.4 31.9 20.4 30.0 22.9C29.1 24.2 28.6 25.6 28.5 27.2C28.8 30.3 29.6 33.4 30.8 36.4L14.2 36.4C15.4 33.4 16.2 30.3 16.5 27.2C16.4 25.6 15.9 24.2 15.0 22.9C13.1 20.4 12.1 17.4 12.5 13.6Z',
      'M12.5 12.6a1.9 1.9 0 1 0 .01 0z',   // five crown pearls
      'M17.5 9.8a1.9 1.9 0 1 0 .01 0z',
      'M22.5 8.2a1.9 1.9 0 1 0 .01 0z',
      'M27.5 9.8a1.9 1.9 0 1 0 .01 0z',
      'M32.5 12.6a1.9 1.9 0 1 0 .01 0z',
    ],
    detail: [
      'M16.4 23.0h12.2', // collar under the crown
    ],
  },

  /* --------------------------------------------------------------- king */
  k: {
    body: [
      BASE,
      // cross
      'M21.2 5.6h2.6v3.4h4.8v2.4h-4.8v2.6h-2.6v-2.6h-4.8V9.0h4.8z',
      // crowned head
      'M22.5 13.4c2.7 0 4.9 2.2 4.9 4.9 0 1.3-.5 2.5-1.3 3.4l1.6 1.3H17.3l1.6-1.3c-.8-.9-1.3-2.1-1.3-3.4 0-2.7 2.2-4.9 4.9-4.9z',
      // robed body
      'M22.5 21.9c-2.5 0-4.6 1.7-5.2 4.1l-1.9 8.0c-.2.9-.9 1.6-1.8 1.9l-.6.2c-.9.3-1.5 1.1-1.5 2.0v.3h22v-.3c0-.9-.6-1.7-1.5-2.0l-.6-.2c-.9-.3-1.6-1-1.8-1.9l-1.9-8.0c-.6-2.4-2.7-4.1-5.2-4.1z',
    ],
    detail: [
      'M18.6 30.2h7.8', // band across the robe
    ],
  },
};

/** Unicode fallback glyphs, used if SVG rendering is unavailable. */
const GLYPHS = {
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F'
};

/**
 * Build an SVG string for a chess piece.
 *
 * The two path groups (`.piece-body` / `.piece-detail`) are coloured by
 * `style.css`; see the file header for why the split matters.
 *
 * @param {string} type   one of p n b r q k
 * @param {'w'|'b'} color
 * @returns {string} SVG markup
 */
export function pieceSvg(type, color) {
  const shape = SHAPES[type];
  if (!shape) return '';
  const cls = `piece piece-${color === 'w' ? 'w' : 'b'}`;
  const body = shape.body.map((d) => `<path class="piece-body" d="${d}"/>`).join('');
  const detail = (shape.detail || []).map((d) => `<path class="piece-detail" d="${d}"/>`).join('');
  return `<svg class="${cls}" viewBox="0 0 45 45" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${body}${detail}</svg>`;
}

export function pieceGlyph(type) {
  return GLYPHS[type] || '';
}

/**
 * Human-readable piece names for accessibility labels.
 */
export const PIECE_NAMES = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
};

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
