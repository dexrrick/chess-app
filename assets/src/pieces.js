/**
 * pieces.js — inline SVG chess piece sprites.
 *
 * We draw the pieces ourselves instead of pulling images so that:
 *  - there are zero extra network requests (great for e-ink / offline),
 *  - the shapes are pure black & white with a thick stroke, which reads
 *    well on low-contrast, greyscale e-ink panels.
 *
 * Each entry is the *inner* markup of a 45x45 viewBox SVG (the classic
 * Cburnett-style geometry, simplified and thickened).
 */

const SHAPES = {
  k: `
    <path d="M22.5 6.5c1.9 0 3.5 1.6 3.5 3.5 0 1.5-.9 2.7-2.2 3.2v3.1l6.6 4.9c.6.5.3 1.5-.5 1.5h-3.1v11.6h3.1c.7 0 1.2.6 1.2 1.2v2.3H14.4v-2.3c0-.7.5-1.2 1.2-1.2h3.1V20.2h-3.1c-.8 0-1.1-1-.5-1.5l6.6-4.9v-3.1c-1.3-.5-2.2-1.7-2.2-3.2 0-1.9 1.6-3.5 3-3.5z"/>
    <path d="M12.6 38.6h19.8v3.4H12.6z"/>`,
  q: `
    <path d="M22.5 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM9.6 11.4a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zm25.8 0a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM7.2 19.4l3.1 16.1h24.4l3.1-16.1-7 5.6-5.9-10.1-5.9 10.1z"/>
    <path d="M11.3 37h22.4v2.2H11.3zM10.1 40.4h24.8v3.2H10.1z"/>`,
  r: `
    <path d="M12.4 36.6h20.2v3.4H12.4zM13.8 40.2h17.4v3.4H13.8z"/>
    <path d="M10.6 10.2h4.6v3.6h3.5v-3.6h7.6v3.6h3.5v-3.6h4.6v9.2h-3.4l-1.5 20.2H15.5L14 15.8h-3.4z"/>`,
  b: `
    <path d="M22.5 5.5c1.5 0 2.7 1.2 2.7 2.7 0 .8-.4 1.6-1 2.1 2.3 1.6 4 4.5 4 8 0 3.2-1.3 6-3.3 7.5h-4.8c-2-1.5-3.3-4.3-3.3-7.5 0-3.5 1.7-6.4 4-8-.6-.5-1-1.3-1-2.1 0-1.5 1.2-2.7 2.7-2.7z"/>
    <path d="M16.1 27.3h12.8c1.2 0 2.1 1 2.1 2.1v3.1H14v-3.1c0-1.2 1-2.1 2.1-2.1z" />
    <path d="M12.4 35.4h20.2v2.6H12.4zM12 39.4h21v4.2H12z"/>`,
  n: `
    <path d="M19.6 7.4c.3-.4 1-.3 1.2.2l.4 1.3c1.6-.5 3.4-.3 4.9.7 3.4 2.2 5.9 6 6.6 9.4l2 10.7c.3 1.5-.2 2.3-1.4 2.3h-4.2c-1 0-1.6-.6-1.9-1.6l-1.6-5.6-4.3 1.2-2.6 2.7h-5l2.3-4.5c-1.6-1.4-2.5-3.4-2.4-5.4.1-2 1.3-3.6 2.9-4.4l.6-3.6-1.4 1.2c-.6.5-1.4-.3-1-1z"/>
    <path d="M15.4 35.8h14.6l.7 6.6H14.7z"/>`,
  p: `
    <path d="M22.5 8.6c3.3 0 6 2.7 6 6 0 2.1-1.1 4-2.8 5.1l.9 2.6h-8.2l.9-2.6a6 6 0 0 1-2.8-5.1c0-3.3 2.7-6 6-6z"/>
    <path d="M15.6 24.3h13.8c.9 0 1.6.8 1.5 1.7l-.8 7.9H14.9l-.8-7.9c-.1-.9.6-1.7 1.5-1.7z"/>
    <path d="M12.2 35.5h20.6v3H12.2zM11.1 39.4h22.8v4.2H11.1z"/>`
};

/** Unicode fallback glyphs, used if SVG rendering is unavailable. */
const GLYPHS = {
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F'
};

/**
 * Build an SVG string for a chess piece.
 * @param {string} type   one of p n b r q k
 * @param {'w'|'b'} color
 * @returns {string} SVG markup
 */
export function pieceSvg(type, color) {
  const d = SHAPES[type];
  if (!d) return '';
  const cls = `piece piece-${color === 'w' ? 'w' : 'b'}`;
  return `<svg class="${cls}" viewBox="0 0 45 45" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${d}</svg>`;
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
