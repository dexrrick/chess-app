/**
 * preview/pieces-candidates.js — stroke-weight variants for comparison.
 *
 * DEV-ONLY. The artwork has exactly one source of truth: `assets/src/pieces.js`.
 * This module re-renders that same geometry with different stroke weights, so
 * the shipped look can be compared against a heavier, e-ink-friendly variant
 * without ever drifting from the real pieces.
 */

import { SHAPES } from '../assets/src/pieces.js';

/**
 * Render one piece as a two-layer SVG string with a configurable stroke weight.
 *
 * @param {string} type       one of p n b r q k
 * @param {'w'|'b'} color
 * @param {{pw?: number, pdw?: number}} style  stroke widths for body / detail
 * @returns {string} SVG markup
 */
export function pieceSvgFor(type, color, style = {}) {
  const shape = SHAPES[type];
  if (!shape) return '';
  const pw = style.pw ?? 1.5;
  const pdw = style.pdw ?? 1.15;
  const cls = `cand ${color === 'w' ? 'w' : 'b'}`;
  const body = shape.body.map((d) => `<path class="piece-body" d="${d}"/>`).join('');
  const detail = (shape.detail || []).map((d) => `<path class="piece-detail" d="${d}"/>`).join('');
  return `<svg class="${cls}" style="--pw:${pw};--pdw:${pdw}" viewBox="0 0 45 45"`
    + ` aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">`
    + `${body}${detail}</svg>`;
}

/**
 * The variants offered for comparison. All use the shipped geometry; they
 * differ in stroke weight, which is the main lever for e-ink legibility at
 * small square sizes.
 */
export const CANDIDATES = [
  {
    id: 'A',
    label: 'A — shipped artwork, full square',
    note: 'The shipped pieces filling the square (they ship at 88%). Medium strokes.',
    style: { pw: 1.5, pdw: 1.15 },
  },
  {
    id: 'B',
    label: 'B — bold strokes (e-ink / small screens)',
    note: 'Same shapes, heavy strokes and heavier detail so the pieces stay readable on a low-contrast panel.',
    style: { pw: 2.6, pdw: 1.9 },
  },
];
