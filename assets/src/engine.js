/**
 * engine.js — Stockfish wrapper with graceful degradation.
 *
 * Strategy (tried in order, first success wins):
 *   1. Stockfish.js 10 (WASM build) served from ./vendor/ — same origin, so
 *      the Worker can be constructed directly and the .wasm sibling resolves
 *      relative to the script. This is the normal path.
 *   2. Stockfish.js 10 (asm.js build) from ./vendor/ for browsers or CSP
 *      policies that block WebAssembly compilation.
 *   3. The same two builds from a CDN. A Worker cannot be constructed from a
 *      cross-origin URL, so we fetch the source and spawn it from a Blob,
 *      passing an absolute base URL via `locateFile` so the .wasm still
 *      resolves. Only used if the local vendor files are missing.
 *   4. Built-in "Pocket Bot": pure JavaScript negamax + material eval.
 *
 * The public API is identical in all cases, so app.js never has to care
 * which engine is actually running. Every method returns a Promise and
 * never rejects — failures resolve to a null/plain move so the UI cannot
 * deadlock.
 */

/** Local, same-origin builds (preferred). */
const LOCAL_BUILDS = [
  { url: './vendor/stockfish.wasm.js', kind: 'wasm', base: './vendor/' },
  { url: './vendor/stockfish.js', kind: 'asm', base: './vendor/' }
];

/** CDN mirrors, used only when the local vendor files are unavailable. */
const CDN_BASES = [
  'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/',
  'https://unpkg.com/stockfish.js@10.0.2/'
];

const CDN_SCRIPTS = ['stockfish.wasm.js', 'stockfish.js'];

/** Difficulty presets → UCI options + search limits. */
export const DIFFICULTIES = {
  beginner: {
    label: 'Beginner',
    skill: 1,
    depth: 1,
    movetimeMs: 250,
    blunderChance: 0.30,
    orderedMoves: 5
  },
  casual: {
    label: 'Casual',
    skill: 6,
    depth: 5,
    movetimeMs: 600,
    blunderChance: 0.08,
    orderedMoves: 3
  },
  challenger: {
    label: 'Challenger',
    skill: 18,
    depth: 12,
    movetimeMs: 1600,
    blunderChance: 0,
    orderedMoves: 1
  }
};

/* ========================================================================== */
/*  Pocket Bot — a tiny, dependency-free fallback engine                      */
/* ========================================================================== */

const PB_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const PB_CENTER = [0, 0, 0, 0];

/**
 * Very small piece-square table set, from White's point of view.
 * Enough to make the bot develop pieces and fight for the centre.
 */
const PB_PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
  ],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20
  ]
};

/**
 * Static evaluation from White's perspective, in centipawns.
 * Uses a Chess instance's board() output.
 */
function evaluateBoard(chess) {
  const board = chess.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      const idx = r * 8 + f;
      const mirror = (7 - r) * 8 + f;
      const pst = PB_PST[sq.type];
      const positional = pst ? (sq.color === 'w' ? pst[idx] : pst[mirror]) : 0;
      const value = PB_VALUES[sq.type] + positional;
      score += sq.color === 'w' ? value : -value;
    }
  }
  return score;
}

/**
 * Negamax with alpha-beta pruning.
 * @returns {number} score in centipawns from the side-to-move's perspective
 */
function negamax(chess, depth, alpha, beta) {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    // Checkmate or stalemate
    if (chess.isCheck()) return -100000 - depth * 100;
    return 0;
  }
  if (depth === 0) {
    const s = evaluateBoard(chess);
    return chess.turn() === 'w' ? s : -s;
  }

  // Simple move ordering: captures first, then promotions.
  moves.sort((a, b) => moveScore(b) - moveScore(a));

  let best = -Infinity;
  for (const move of moves) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function moveScore(move) {
  let s = 0;
  if (move.captured) s += 10 + (PB_VALUES[move.captured] || 0) / 100;
  if (move.promotion) s += 9;
  return s;
}

/**
 * Pick a move with the Pocket Bot.
 * @param {object} chess  a Chess instance (search state is restored afterwards)
 * @param {object} opts   { depth, blunderChance, orderedMoves }
 * @returns {{from:string,to:string,promotion?:string}|null}
 */
function pocketBotMove(chess, opts) {
  const { depth = 2, blunderChance = 0 } = opts || {};
  const fen = chess.fen();
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;

  const side = chess.turn();
  const scored = [];
  for (const move of legal) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    const raw = -negamax(chess, Math.max(0, depth - 1), -Infinity, Infinity);
    chess.undo();
    scored.push({ move, score: raw });
  }
  // Restore exactly (negamax should not mutate, but be safe).
  chess.load(fen);

  scored.sort((a, b) => b.score - a.score);

  // Deliberate slip-ups for beginner mode: sometimes take a worse move.
  if (blunderChance > 0 && Math.random() < blunderChance && scored.length > 1) {
    const window = Math.min(scored.length - 1, 3);
    const pick = 1 + Math.floor(Math.random() * window);
    return toMove(scored[pick].move);
  }

  // Tiny random tie-break among near-equal moves so games vary.
  const best = scored[0].score;
  const ties = scored.filter((s) => s.score >= best - 15);
  const chosen = ties[Math.floor(Math.random() * ties.length)];
  return toMove(chosen.move);
}

function toMove(m) {
  return m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to };
}

/* ========================================================================== */
/*  UCI engine process (worker-based)                                         */
/* ========================================================================== */

class UciProcess {
  /**
   * @param {string} url      worker script URL
   * @param {object} [opts]
   * @param {string} [opts.base]     absolute base for locateFile (CDN/blob case)
   * @param {boolean} [opts.sameOrigin] true when `url` is on our own origin
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.base = opts.base || null;
    this.sameOrigin = opts.sameOrigin !== false;
    this.blobUrl = null;
    this.worker = null;
    this.ready = false;
    this.pending = null;      // { id, resolve, reject, timer, lines }
    this._searchId = 0;
    this._readyWaiter = null;
    this.listeners = new Set();
    this.queue = [];
    this.initError = null;
  }

  /** Spawn the worker and complete the UCI handshake. @returns {Promise<boolean>} */
  async start() {
    try {
      const worker = await this.#spawn();
      this.worker = worker;

      // Attach ONE listener for the lifetime of the worker. The handshake
      // resolves on `uciok`; afterwards every line goes to #route().
      // Attaching a single listener avoids the double-delivery bug where a
      // temporary handshake listener and the permanent one both consume
      // `bestmove`, leaving a search pending forever.
      const readyPromise = new Promise((resolve, reject) => {
        this._handshake = { resolve, reject };
        this._handshakeTimer = setTimeout(() => {
          this._handshake = null;
          reject(new Error('engine handshake timeout'));
        }, 25000);
      });

      worker.addEventListener('message', (e) => {
        const line = typeof e.data === 'string' ? e.data : (e.data && e.data.text) || '';
        if (!line) return;
        if (this._handshake) {
          if (line.includes('uciok')) {
            clearTimeout(this._handshakeTimer);
            const h = this._handshake;
            this._handshake = null;
            h.resolve();
          } else if (/^info string (error|fail)/i.test(line)) {
            clearTimeout(this._handshakeTimer);
            const h = this._handshake;
            this._handshake = null;
            h.reject(new Error(line));
          }
          return;   // don't route engine chatter during the handshake
        }
        this.#route(line);
      });

      worker.addEventListener('error', (err) => {
        const msg = (err && err.message) || 'worker error';
        if (this._handshake) {
          clearTimeout(this._handshakeTimer);
          const h = this._handshake;
          this._handshake = null;
          h.reject(new Error(msg));
        }
        // Fail any in-flight search rather than hanging the UI.
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          clearTimeout(p.timer);
          p.resolve(null);
        }
      });

      // Kick off the handshake. Options are queried so `uciok` is emitted.
      this.send('uci');
      await readyPromise;
      this.ready = true;
      return true;
    } catch (err) {
      this.initError = err;
      this.terminate();
      return false;
    }
  }

  /**
   * Construct the Worker.
   *
   * Same-origin scripts are used directly. Cross-origin scripts must be
   * fetched and wrapped in a Blob first, because `new Worker(crossOriginUrl)`
   * is rejected by the browser. Emscripten resolves its .wasm sibling against
   * `locateFile(name, prefix)`, so for the Blob case we rewrite that function
   * header to inject an absolute base — otherwise the wasm request would be
   * resolved against the blob: origin and fail.
   */
  async #spawn() {
    if (this.sameOrigin && !this.base) {
      return new Worker(this.url);
    }

    // Same-origin but with an explicit base: still construct directly, the
    // relative .wasm path already resolves correctly.
    if (this.sameOrigin) {
      return new Worker(this.url);
    }

    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`fetch ${this.url} -> ${res.status}`);
    let src = await res.text();

    if (this.base) {
      const absBase = new URL(this.base, window.location.href).href;
      // Emscripten's Module definition: { locateFile: function(e) { return e } }
      // Rewrite the first locateFile so relative asset names hit the CDN.
      src = src.replace(
        /locateFile:\s*function\s*\(\s*([a-zA-Z_$][\w$]*)\s*(?:,\s*[a-zA-Z_$][\w$]*)?\s*\)\s*\{\s*return\s+\1\s*\}/,
        `locateFile:function(e){return "${absBase}"+e}`
      );
    }

    const blob = new Blob([src], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    return new Worker(this.blobUrl);
  }

  #route(line) {
    if (!line) return;

    // readyok may arrive between searches.
    if (line.includes('readyok')) {
      if (this._readyWaiter) this._readyWaiter();
      if (!this.pending) return;
    }

    // Feed the active search first.
    if (this.pending) {
      this.pending.lines.push(line);
      const m = line.match(/^bestmove\s+(\S+)/);
      if (m) {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(m[1]);
        return;
      }
      const cm = line.match(/score\s+(cp|mate)\s+(-?\d+)/);
      if (cm && this.pending.onInfo) {
        const p = this.pending;
        p.onInfo(cm[1], parseInt(cm[2], 10));
      }
      return;
    }

    // A bestmove with no pending search is the tail of a cancelled search.
    if (/^bestmove/.test(line)) return;

    for (const fn of this.listeners) fn(line);
  }

  send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  /**
   * Send `isready` and resolve when `readyok` arrives. Used to know that
   * options were accepted. Resolves (never rejects) after `timeoutMs`.
   */
  isReady(timeoutMs = 8000) {
    if (!this.ready && !this._handshake) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._readyWaiter = null;
        resolve(false);
      }, timeoutMs);
      this._readyWaiter = () => {
        clearTimeout(timer);
        this._readyWaiter = null;
        resolve(true);
      };
      this.send('isready');
    });
  }

  /** Send a UCI command and wait for the next `bestmove`. */
  go(cmd, { timeoutMs = 12000, onInfo = null } = {}) {
    if (!this.ready || !this.worker) {
      return Promise.resolve(null);
    }

    // If a search is somehow still running, stop it and discard its result.
    if (this.pending) {
      const stale = this.pending;
      this.pending = null;
      clearTimeout(stale.timer);
      stale.resolve(null);
      this.send('stop');
    }

    return new Promise((resolve) => {
      // Monotonic id: any `bestmove` that arrives for an older search is
      // ignored, which prevents an aborted search from resolving the next one.
      const id = ++this._searchId;
      const timer = setTimeout(() => {
        if (this.pending && this.pending.id === id) {
          this.pending = null;
          // Tell the engine to stop working; its bestmove is discarded above.
          this.send('stop');
          resolve(null);
        }
      }, timeoutMs);
      this.pending = { id, resolve, timer, lines: [], onInfo };
      this.send(cmd);
    });
  }

  /** Cancel any in-flight search and drop its result. */
  stop() {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    this.send('stop');
    p.resolve(null);
  }

  async setOption(name, value) {
    this.send(`setoption name ${name} value ${value}`);
  }

  terminate() {
    if (this.worker) {
      try { this.send('quit'); } catch { /* ignore */ }
      try { this.worker.terminate(); } catch { /* ignore */ }
    }
    this.worker = null;
    this.ready = false;
    if (this.blobUrl) {
      try { URL.revokeObjectURL(this.blobUrl); } catch { /* ignore */ }
      this.blobUrl = null;
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(null);
      this.pending = null;
    }
  }
}

/* ========================================================================== */
/*  Public Engine class                                                       */
/* ========================================================================== */

export class Engine {
  /**
   * @param {object} deps  { Chess: chess.js class, getChess: () => Chess }
   */
  constructor(deps) {
    this.Chess = deps.Chess;
    this.getChess = deps.getChess;
    this.proc = null;
    this.kind = 'none';         // 'wasm' | 'asm' | 'pocket'
    this.fallbackReason = '';
    this.onStatus = deps.onStatus || (() => {});
  }

  get isNative() {
    return this.kind === 'wasm' || this.kind === 'asm';
  }

  /** Try every strategy in turn. Resolves with a status string. */
  async init() {
    // ---- 1 & 2: local, same-origin builds ----
    for (const build of LOCAL_BUILDS) {
      this.onStatus('loading', `Loading engine (${build.kind})…`);
      // eslint-disable-next-line no-await-in-loop
      const ok = await this.#tryBuild(build);
      if (ok) {
        this.kind = build.kind;
        await this.#configure();
        this.onStatus('ready', `Engine ready (${build.kind === 'wasm' ? 'WASM' : 'asm.js'}).`);
        return this.kind;
      }
    }

    // ---- 3: CDN builds via Blob ----
    for (const base of CDN_BASES) {
      for (const script of CDN_SCRIPTS) {
        this.onStatus('loading', `Loading engine from CDN (${script})…`);
        const build = {
          url: base + script,
          kind: script.includes('wasm') ? 'wasm' : 'asm',
          base,
          sameOrigin: false
        };
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.#tryBuild(build);
        if (ok) {
          this.kind = build.kind;
          await this.#configure();
          this.onStatus('ready', `Engine ready (${build.kind === 'wasm' ? 'WASM' : 'asm.js'}, CDN).`);
          return this.kind;
        }
      }
    }

    // ---- 4: built-in fallback ----
    this.kind = 'pocket';
    this.fallbackReason = 'Could not load Stockfish.';
    this.onStatus('fallback', 'Playing with the built-in Pocket Bot.');
    return this.kind;
  }

  /** @returns {Promise<boolean>} whether the build started and shook hands */
  async #tryBuild(build) {
    const p = new UciProcess(build.url, { base: build.base, sameOrigin: build.sameOrigin });
    const ok = await p.start();
    if (ok) {
      this.proc = p;
      return true;
    }
    return false;
  }

  async #configure() {
    // NOTE: this Stockfish (Multi-Variant) build *advertises* `Threads min 1
    // max 1` but sending `setoption name Threads value 1` wedges the worker —
    // after that command it never answers `isready` again and all searches
    // time out. Since the only legal value is already the default, we simply
    // do not send it.
    //
    // Hash is likewise capped at 16 MB in this build, so we stay at the
    // default rather than requesting a larger table.
    await this.setDifficulty('beginner');
    this.proc.send('setoption name Ponder value false');
    // Wait for readyok so we know the options were accepted before searching.
    await this.proc.isReady();
  }

  async setDifficulty(key) {
    const d = DIFFICULTIES[key] || DIFFICULTIES.casual;
    this.difficulty = key;
    this.preset = d;
    if (this.isNative && this.proc) {
      // `Skill Level` 0-20 is the reliable knob for this build. We deliberately
      // avoid UCI_Elo / UCI_LimitStrength, which this build does not list and
      // which have been observed to wedge the worker when sent anyway.
      this.proc.send(`setoption name Skill Level value ${d.skill}`);
    }
  }

  /**
   * Ask the engine for the best move in the current position.
   * @param {object} chess  Chess instance whose position is analysed
   * @param {object} opts   { difficulty, onInfo }
   * @returns {Promise<{from,to,promotion?}|null>}
   */
  async bestMove(chess, opts = {}) {
    const key = opts.difficulty || this.difficulty || 'casual';
    const preset = DIFFICULTIES[key] || DIFFICULTIES.casual;
    const fen = chess.fen();

    if (this.isNative && this.proc && this.proc.ready) {
      await this.setDifficulty(key);
      this.proc.send('ucinewgame');
      this.proc.send(`position fen ${fen}`);
      const limit = `go depth ${preset.depth} movetime ${preset.movetimeMs}`;
      const uci = await this.proc.go(limit, {
        timeoutMs: preset.movetimeMs + 9000,
        onInfo: opts.onInfo
      });
      const parsed = parseUci(uci);
      if (parsed && legalCheck(chess, parsed)) {
        return parsed;
      }
      // Engine gave an unusable answer — fall through to the pocket bot so
      // the game always continues.
    }

    // Pocket Bot path (also the fallback when an engine answer was invalid).
    await sleep(key === 'beginner' ? 260 : 380);
    const move = pocketBotMove(chess, {
      depth: key === 'challenger' ? 3 : key === 'casual' ? 2 : 1,
      blunderChance: preset.blunderChance
    });
    return move;
  }

  /**
   * Evaluate a position. Returns centipawns from WHITE's point of view.
   * Positive = White is better. Uses mate scores clamped to +/- 2000.
   */
  async evaluate(chess, { depth = 10, timeoutMs = 2500 } = {}) {
    const fen = chess.fen();
    if (this.isNative && this.proc && this.proc.ready) {
      // Cancel any in-flight move search so we can evaluate cleanly.
      this.proc.stop();
      this.proc.send(`position fen ${fen}`);
      let mate = null;
      let cp = null;
      await this.proc.go(`go depth ${depth}`, {
        timeoutMs,
        onInfo: (kind, val) => {
          if (kind === 'cp') { cp = val; mate = null; }
          if (kind === 'mate') { mate = val; cp = null; }
        }
      });
      if (mate !== null) {
        // Mate scores are reported from the side-to-move's perspective too;
        // `evaluate()` always returns White's point of view.
        const score = mate > 0 ? (2000 - Math.abs(mate) * 10) : (-2000 + Math.abs(mate) * 10);
        return chess.turn() === 'w' ? score : -score;
      }
      if (cp !== null) {
        return chess.turn() === 'w' ? cp : -cp;
      }
    }
    // Heuristic fallback
    const raw = evaluateBoard(chess);
    return raw;
  }

  /** Convenience: get a ranked list of candidate moves (for hints). */
  async rankedMoves(chess, { depth = 3, count = 1 } = {}) {
    const fen = chess.fen();
    const legal = chess.moves({ verbose: true });
    if (legal.length === 0) return [];

    if (this.isNative && this.proc && this.proc.ready) {
      this.proc.send(`position fen ${fen}`);
      this.proc.send(`setoption name MultiPV value ${Math.min(count, 5)}`);
      const first = await this.proc.go(`go depth ${depth}`, {
        timeoutMs: depth * 400 + 2500,
        onInfo: () => {}
      });
      this.proc.send('setoption name MultiPV value 1');
      const parsed = parseUci(first);
      if (parsed && legalCheck(chess, parsed)) return [parsed];
    }

    // Pocket fallback: score each root move and sort.
    const scored = [];
    for (const m of legal) {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      const s = -negamax(chess, Math.max(0, depth - 1), -Infinity, Infinity);
      chess.undo();
      scored.push({ move: toMove(m), score: s });
    }
    chess.load(fen);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((s) => s.move);
  }

  destroy() {
    if (this.proc) this.proc.terminate();
    this.proc = null;
  }
}

/* ============================== helpers ================================== */

function parseUci(uci) {
  if (!uci || uci === '(none)' || uci === '0000') return null;
  const m = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?/);
  if (!m) return null;
  return m[3] ? { from: m[1], to: m[2], promotion: m[3] } : { from: m[1], to: m[2] };
}

function legalCheck(chess, move) {
  const legal = chess.moves({ verbose: true });
  return legal.some(
    (m) => m.from === move.from && m.to === move.to &&
      (!move.promotion || m.promotion === move.promotion)
  );
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { evaluateBoard, pocketBotMove };
