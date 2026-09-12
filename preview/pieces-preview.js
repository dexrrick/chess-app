/**
 * preview/pieces-preview.js — builds the comparison page.
 *
 * DEV-ONLY. Imports the shipped artwork (read-only) alongside the candidates
 * so the two can be judged side by side before anything is committed.
 */

import { pieceSvg } from '../assets/src/pieces.js';
import { CANDIDATES, pieceSvgFor } from './pieces-candidates.js';

/** King, queen, rook, bishop, knight, pawn — the conventional order. */
const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];

const VARIANTS = [
  {
    id: 'current',
    label: 'Current (shipped)',
    note: 'assets/src/pieces.js. Every sub-shape shares one fill and one stroke, so black pieces '
      + 'lose their internal line work. Rendered at the app\'s 88% square size.',
  },
  ...CANDIDATES.map((c) => ({ ...c })),
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function square(px, dark) {
  const d = el('div', 'sq' + (dark ? ' dark' : ''));
  d.style.width = `${px}px`;
  d.style.height = `${px}px`;
  return d;
}

function svgFor(variant, type, color) {
  return variant.id === 'current'
    ? pieceSvg(type, color)
    : pieceSvgFor(type, color, variant.style);
}

/** A labelled row of six pieces. */
function buildGroup(variant, { px, dark, color }) {
  const group = el('div', 'group');
  const name = color === 'w' ? 'white' : 'black';
  group.appendChild(el('div', 'lbl', `${name} · ${px}px · ${dark ? 'dark' : 'light'}`));
  const row = el('div', 'row');
  for (const type of TYPES) {
    const sq = square(px, dark);
    sq.innerHTML = svgFor(variant, type, color);
    row.appendChild(sq);
  }
  group.appendChild(row);
  return group;
}

function buildVariantSection(variant) {
  const section = el('section');
  section.id = `variant-${variant.id}`;
  section.appendChild(el('h2', null, variant.label));
  if (variant.note) section.appendChild(el('p', 'note', variant.note));

  const strip = el('div', 'strip');
  for (const px of [56, 104]) {
    for (const dark of [false, true]) {
      for (const color of ['w', 'b']) {
        strip.appendChild(buildGroup(variant, { px, dark, color }));
      }
    }
  }
  section.appendChild(strip);
  return section;
}

/** Greyscale + contrast simulation for a low-contrast e-ink panel. */
function buildEinkSection() {
  const section = el('section');
  section.id = 'eink';
  section.appendChild(el('h2', null, 'E-ink simulation (greyscale + contrast 1.5)'));
  section.appendChild(el('p', 'note',
    'The panel that matters. A set that survives this filter at 56px is safe.'));

  const strip = el('div', 'strip eink');
  for (const variant of VARIANTS) {
    const group = el('div', 'group');
    group.appendChild(el('div', 'lbl', variant.id === 'current' ? 'Current' : variant.id));
    const row = el('div', 'row');
    for (const dark of [false, true]) {
      for (const color of ['w', 'b']) {
        for (const type of ['q', 'n', 'b', 'p', 'k', 'r']) {
          const sq = square(56, dark);
          sq.innerHTML = svgFor(variant, type, color);
          row.appendChild(sq);
        }
      }
    }
    group.appendChild(row);
    strip.appendChild(group);
  }
  section.appendChild(strip);
  return section;
}

const root = document.getElementById('root');
for (const variant of VARIANTS) root.appendChild(buildVariantSection(variant));
root.appendChild(buildEinkSection());

// Signal the screenshot script that layout (and fonts) have settled.
await document.fonts?.ready?.catch?.(() => {});
requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
