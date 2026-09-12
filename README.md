# Chess Club — a kid-friendly chess app with a built-in coach

A complete, responsive chess game that runs **entirely in the browser** and deploys
to **Cloudflare Workers** in one command. It is designed for e-ink displays and
iPads: high-contrast monochrome, no animations by default, and generous
touch targets.

The app plays against **Stockfish** (WebAssembly, in a Web Worker) or in
**2-player pass & play** mode, and it explains every move in plain language a
child can understand.

---

## Highlights

| Area | What you get |
| --- | --- |
| **Chess rules** | `chess.js` handles legality, FEN, check/checkmate, draws |
| **Engine** | `stockfish.js` 10 (WASM) in a Web Worker — never blocks the UI |
| **Offline** | If Stockfish can't load, a built-in JavaScript "Pocket Bot" takes over |
| **Coach** | Every move graded Brilliant → Blunder, with a kid-friendly *why* |
| **Hints** | Highlights a recommended from/to square on the board |
| **Modes** | Vs Computer (3 tiers) and 2-player pass & play with auto-flip |
| **E-ink / iPad** | Monochrome palette, animations off by default, 48px+ squares |
| **Accessibility** | Full keyboard play, ARIA labels, live regions, focus rings |

---

## Quick start (local)

The app is plain static files — there is no build step.

```bash
# 1. Install the only dev dependency (Puppeteer, for the tests)
npm install

# 2. Serve the assets directory
npm run serve            # -> http://localhost:8899
# or pick a port:
npm run serve -- 3000
```

Then open <http://localhost:8899>.

> Any static server works. If you prefer Python:
> `cd assets && python -m http.server 8899`

---

## Deploy to Cloudflare Workers

The project ships with `wrangler.toml` already configured. You need Node 22+
(wrangler 4's requirement) and a (free) Cloudflare account.

```bash
# One-time: authenticate with Cloudflare
npx wrangler login

# Validate the bundle without uploading
npm run deploy:dry

# Ship it
npm run deploy
```

Wrangler prints the live URL, e.g. `https://chess-club.<your-subdomain>.workers.dev`.

To publish a separate preview Worker instead, uncomment the `[env.staging]`
block in `wrangler.toml` and run `npx wrangler deploy --env staging`.

### What the config does

```toml
name = "chess-club"
main = "src/index.js"

[assets]
directory = "./assets"        # every static file is uploaded to the edge
binding   = "ASSETS"          # exposes them to the Worker as env.ASSETS
not_found_handling = "none"   # missing files return a real 404
run_worker_first   = false     # assets are served directly; Worker is a fallback
```

* **`assets/`** holds the entire front end (`index.html`, `style.css`, `app.js`,
  `src/`, `vendor/`). Because the files sit at the root of that directory, the
  site is served from the domain root.
* **`assets/_headers`** carries the security headers. It has to live here rather
  than in the Worker: with `run_worker_first = false`, Cloudflare serves a
  matching static file *without invoking the Worker*, so anything the Worker set
  on a response never reached the real pages. Cloudflare parses this file and
  does not serve it.
* **`src/index.js`** is a small Worker that only handles requests Cloudflare's
  asset layer can't: it returns `index.html` for extension-less deep links, and
  re-attaches the same security headers for that generated response (`_headers`
  is documented not to apply to Worker-generated responses). `worker-test.mjs`
  asserts the two definitions stay identical.

---

## Project layout

```
chess-app/
├─ assets/                    # ← everything Cloudflare uploads
│  ├─ _headers                # security headers for the static files (parsed, not served)
│  ├─ index.html              # semantic markup, app shell
│  ├─ favicon.svg             # king sprite (mirrors src/pieces.js)
│  ├─ style.css               # monochrome e-ink / iPad styling
│  ├─ app.js                  # board rendering, input, game flow, wiring
│  ├─ src/
│  │  ├─ pieces.js            # inline SVG piece sprites
│  │  ├─ engine.js            # Stockfish wrapper + Pocket Bot fallback
│  │  └─ coach.js             # move grading and kid-friendly explanations
│  └─ vendor/
│     ├─ chess.js             # chess.js 1.4.0 (ESM)
│     ├─ stockfish.wasm.js    # Stockfish 10 WASM loader
│     ├─ stockfish.wasm       # Stockfish 10 WASM binary
│     └─ stockfish.js         # Stockfish 10 asm.js (used when WASM is blocked)
├─ src/
│  └─ index.js                # Cloudflare Worker (SPA fallback + headers)
├─ scripts/
│  └─ serve.mjs               # zero-dependency static dev server
├─ preview/                   # dev-only piece preview + verification (not deployed)
├─ wrangler.toml              # Cloudflare Workers config
├─ LICENSE                    # GPL-3.0
├─ .editorconfig              # shared editor settings
├─ smoke-test.mjs             # browser smoke tests
├─ e2e-test.mjs               # end-to-end game scenarios
├─ worker-test.mjs            # Worker unit tests (no network needed)
├─ test-all.mjs               # runs all three suites
└─ shots.mjs                  # captures screenshots at 4 viewports
```

There is **no bundler**. `app.js` is an ES module and imports its siblings with
relative paths, which browsers resolve natively. This keeps deployment to a
single `wrangler deploy` with nothing to build.

---

## How the pieces fit together

### Engine loading (`assets/src/engine.js`)

Loading a chess engine from a CDN is surprisingly fiddly, because
`new Worker('https://other-origin/...')` is **rejected by browsers**. The loader
tries, in order:

1. **`./vendor/stockfish.wasm.js`** — same origin, so the Worker constructs
   directly and its `.wasm` sibling resolves relative to the script. This is the
   normal path.
2. **`./vendor/stockfish.js`** — the asm.js build, for browsers or CSP policies
   that block WebAssembly compilation.
3. **CDN copies** of both builds. Here the source is fetched and wrapped in a
   `Blob`, and `locateFile` is rewritten so the `.wasm` still resolves to the
   CDN rather than the blob origin.
4. **Pocket Bot** — a pure-JavaScript negamax search with a material +
   piece-square-table evaluation. Slower and weaker, but the app never
   hard-breaks and never deadlocks.

Difficulty tiers map onto UCI options and search limits:

| Tier | Skill Level | Depth | Move time | Blunder chance |
| --- | --- | --- | --- | --- |
| Beginner | 1 | 1 | 250 ms | 30 % |
| Casual | 6 | 5 | 600 ms | 8 % |
| Challenger | 18 | 12 | 1600 ms | 0 % |

> **Note on this Stockfish build.** It advertises `Threads min 1 max 1` but
> sending `setoption name Threads value 1` permanently wedges the worker — after
> that command it stops answering `isready` and every search times out. Since
> the only legal value is already the default, the loader deliberately never
> sends it. `Hash` is likewise capped at 16 MB.

### The coach (`assets/src/coach.js`)

For every move the app evaluates the position before and after, then compares
the played move against the best available one. The centipawn loss maps onto a
tier:

| Tier | Loss | Example message |
| --- | --- | --- |
| Brilliant / Best | ≤ 10 cp | "Wow — spot on! That controls the centre." |
| Good / Solid | ≤ 120 cp | "Nice one! You are helping control the middle." |
| Inaccuracy | ≤ 250 cp | "Hmm, careful — there was a stronger idea." |
| Mistake | ≤ 500 cp | "Careful! That leaves your knight looking lonely." |
| Blunder | > 500 cp | "Oops! Your bishop is unguarded — they can just take it." |

Explanations lean on four ideas a child can act on: **control the centre**,
**protect the king**, **don't leave pieces hanging**, and **develop your pieces**.

### Piece sprites (`assets/src/pieces.js`)

Each piece is drawn from scratch as **two layers**:

* `.piece-body` — the silhouette, filled with the piece colour and outlined in
  black.
* `.piece-detail` — the internal lines (base bands, collars, the king's robe
  band, the bishop's mitre slit, the knight's mane), stroked in the
  **contrasting** colour.

That split is what keeps black pieces readable. With a single fill and a single
stroke for everything, a black piece (black fill + black stroke) loses every
internal line while a white piece keeps them — the two sides end up looking
like different sets.

All six pieces share one plinth (`x 11..34`, `y 36.4..40`) so they sit on a
common baseline. `assets/favicon.svg` mirrors the king; keep the two in step.

`preview/` holds a dev-only harness that renders the shipped set and any
candidate redraws side by side at several sizes, on both square colours and
under an e-ink simulation:

```bash
npm run preview          # writes preview/out/*.png
npm run preview:verify   # asserts the real app renders pieces correctly
```

Neither script is uploaded by `wrangler deploy` — they live outside `assets/`.

### E-ink and iPad tuning (`assets/style.css`)

* Palette is `#000`, `#FFF` and a few mid-greys — no colour anywhere.
* Animations are **off by default**; `--anim-speed` is `0ms`. The *Animations*
  switch sets it to `160ms` for smooth transitions on a normal screen.
* Squares never go below **48 × 48 px**. On narrow phones the board scrolls
  horizontally inside its own container rather than shrinking touch targets.
* On narrow portrait screens the **Coach panel moves above the board** (moved in
  `app.js`, since CSS `order` can't move a node out of its parent) so children
  see feedback without scrolling.

---

## Testing

```bash
npm test              # all four suites, starts its own server
npm run test:worker   # Worker unit tests (no browser, no network)
npm run test:engine   # engine-layer unit tests (fake UCI worker, no browser)
npm run test:smoke    # 37 browser checks: rendering, pieces, engine, coach, layout
npm run test:e2e      # scenario checks: checkmate, promotion, offline, concurrency…
```

The suite covers, among other things:

* the board renders 64 squares and 32 pieces in the correct start position
* the real Stockfish WASM engine loads and replies (`kind=wasm`)
* the coach produces a **tiered** verdict with a readable sentence
* checkmate ends the game, shows the result dialog and banner
* promotion offers four pieces and applies the chosen one
* 2-player auto-flip puts the side to move at the bottom
* blocking the engine falls back to the Pocket Bot, which still plays legally
* keyboard-only play (arrows + Enter, `H` for a hint)
* squares are ≥ 48 px at iPad portrait, iPad landscape and iPhone portrait
* the Worker returns 404 for a missing asset but the shell for a deep link
* `assets/_headers` and the Worker agree on the security headers
* New Game while the engine is thinking does **not** end the new game
  (the stale-reply guard)
* the coach's review and the reply are analysed concurrently, the reply is
  still applied after the coach's feedback lands, and neither stalls the other

The engine-layer suite (`npm run test:engine`) runs in Node against a fake UCI
worker, so the queueing that makes concurrent requests safe is tested
deterministically: overlapping requests never run two searches at once, a late
`bestmove` from an abandoned search is not delivered to the next one, and a
timed-out or failed search degrades instead of hanging.

Capture reference screenshots with `npm run shots` (writes to `shots/`).

---

## Using the app

| Control | What it does |
| --- | --- |
| **Tap a piece** | Shows every legal destination (dots, rings for captures) |
| **New Game** | Resets the board; you always play White |
| **Undo** | Takes back your move — and the computer's reply, in vs-computer mode |
| **Hint** | Highlights a strong from/to square and explains the idea |
| **Flip** | Rotates the board 180° |
| **Resign** | Ends the game in favour of your opponent |

Keyboard: arrow keys move a square cursor, **Enter** picks up or drops a piece,
**Escape** cancels, and **H** asks for a hint.

Preferences (mode, difficulty, animation toggle, sound, auto-flip) are saved to
`localStorage`.

---

## Troubleshooting

**"Playing with the built-in Pocket Bot."**
Stockfish couldn't load. The app still works. Check that `assets/vendor/`
contains all four files and that your server sends `application/wasm` for
`.wasm`. A strict Content-Security-Policy can also block WASM — the policy in
`assets/_headers` (and in `src/index.js` for Worker-generated responses) allows
`'wasm-unsafe-eval'` and blob workers, which the engine needs.

**The board looks cramped on a phone.**
Squares are locked to a 48 px minimum, so below ~400 px wide the board scrolls
sideways inside its own container instead of shrinking.

**`wrangler deploy --dry-run` warns about environments.**
Harmless; it only appeared when an extra `[env.*]` block was uncommented.

**`npm run dev` complains that workerd failed to install.**
Recent npm versions refuse to run lifecycle scripts unless you allow them, which
skips workerd's postinstall. Approve it once:

```bash
npm approve-scripts workerd   # then re-run npm install
```

`npm run deploy` is unaffected — only the local runtime needs workerd.

---

## Licences and credits

This project is released under the **GNU General Public License v3.0** — see
[`LICENSE`](LICENSE). That is not an arbitrary choice: it bundles Stockfish,
which is GPL-3.0, so the combined work has to be GPL-compatible.

* [`chess.js`](https://github.com/jhlywa/chess.js) — BSD-2-Clause
* [`stockfish.js`](https://github.com/nmrugg/stockfish.js) — GPL-3.0
* Piece sprites are original inline SVG drawn on a 45×45 grid in
  `assets/src/pieces.js` — not derived from any third-party piece set, so no
  extra licence applies. `assets/favicon.svg` mirrors the king.

Because Stockfish is GPL-3.0, redistributing this app (including the copies in
`assets/vendor/`) means the combined work must comply with the GPL. Chess
itself is, of course, public domain.
