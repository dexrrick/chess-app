# Piece preview harness (dev-only)

Two scripts, both run from the repository root:

```bash
npm run preview          # render the comparison page -> preview/out/*.png
npm run preview:verify   # assert the REAL app renders pieces correctly
```

`render-preview.mjs` starts a tiny static server rooted at the repository (so
both `/preview/...` and `/assets/...` resolve — the app's own `scripts/serve.mjs`
only serves `assets/`), renders the page in the same Puppeteer/Chromium the test
suite uses, and writes PNGs to `preview/out/` (git-ignored):

| File | Shows |
| --- | --- |
| `compare.png` | the whole page |
| `variant-current.png` | the shipped artwork, as the app renders it |
| `variant-A.png` | shipped artwork filling the square |
| `variant-B.png` | shipped artwork with bold strokes |
| `eink.png` | all variants under a greyscale + contrast filter |

Open `preview/pieces-preview.html` in a browser for a live version.

`verify-board.mjs` loads the real `assets/index.html`, asserts the two-layer
markup is present *and* that the stylesheet colours it (a black piece must get
white detail strokes), plays a move and checks the last-move arrow is drawn
against the right squares, and writes screenshots to `preview/out/`
(`app-board.png`, and `app-board-lastmove.png` with the arrow on screen). It is
the quick way to check a board change without waiting on the full browser suites.

Point it at a different origin with `VERIFY_URL`. That is how the app gets
checked under the *real* edge headers, since the plain static server sends no
Content-Security-Policy:

```bash
npx wrangler dev --port 8971 &      # applies assets/_headers
VERIFY_URL=http://127.0.0.1:8971/index.html npm run preview:verify
```

## Files

| File | Purpose |
| --- | --- |
| `pieces-preview.html` | page shell and the colour rules |
| `pieces-preview.js` | builds the comparison grid |
| `pieces-candidates.js` | `pieceSvgFor()` + the stroke-weight variants |
| `render-preview.mjs` | server + comparison screenshots |
| `verify-board.mjs` | loads the real app, asserts, screenshots |

## The two-layer model

Each piece has a `body` (the silhouette) and a `detail` layer. The body is
filled with the piece colour; the detail lines are drawn in the **contrasting**
colour:

```css
.piece .piece-body   { fill: var(--piece-fill); stroke: #000; }
.piece .piece-detail { fill: none;              stroke: var(--piece-detail); }
.piece.piece-w { --piece-fill:#fff; --piece-detail:#000; }
.piece.piece-b { --piece-fill:#000; --piece-detail:#fff; }
```

That is the fix for the old set's main weakness: with one fill *and* one stroke
for everything, black pieces (black fill + black stroke) lost all their internal
structure.

The geometry lives in `assets/src/pieces.js` and is **imported** here, so there
is exactly one copy of the artwork. `pieces-candidates.js` only changes stroke
weight.

Nothing in this directory is uploaded by `wrangler deploy` — it lives outside
`assets/`.

