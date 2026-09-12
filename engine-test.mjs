/**
 * engine-test.mjs — unit tests for the engine layer (assets/src/engine.js).
 *
 * Runs in Node against a scriptable fake UCI Worker, so the UCI serialisation
 * can be tested deterministically — instantly, with no browser and no 600 KB
 * WebAssembly download.
 *
 * The property under test: the app now asks for the coach's evaluation and the
 * opponent's reply at the same time, but a UCI engine has exactly one search.
 * Overlapping requests must be queued, never cancelled, and a late `bestmove`
 * from an abandoned search must not be delivered to the next one.
 */

import { Engine, DIFFICULTIES, sleep } from './assets/src/engine.js';
import { Chess } from './assets/vendor/chess.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

/* ============================== test doubles ============================== */

/** Legal replies, handed out one per search so a mix-up is detectable. */
const ANSWERS = ['e2e4', 'g1f3', 'd2d4', 'b1c3'];

/**
 * A minimal UCI engine. Tracks how many searches were running at once, which
 * is how the tests detect anything running in parallel on one engine.
 */
class FakeWorker {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.commands = [];
    this.searches = [];        // { cmd, startedAt, endedAt, score, answer }
    this.live = 0;             // searches in flight right now
    this.maxLive = 0;          // high-water mark: must stay 1
    this.replyDelay = 30;
    this.failHandshake = false;
    this.neverAnswer = false;
    this.terminated = false;
    FakeWorker.last = this;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener() {}

  postMessage(cmd) {
    this.commands.push(cmd);
    if (cmd === 'uci') {
      if (this.failHandshake) this.#emitSoon('info string error not available');
      else this.#emitSoon('id name Fake SF\nuciok');
    } else if (cmd === 'isready') {
      this.#emitSoon('readyok');
    } else if (cmd.startsWith('go')) {
      this.#beginSearch(cmd);
    } else if (cmd === 'stop') {
      this.#finishSearch();
    }
    // setoption / ucinewgame / position / quit: nothing to emulate
  }

  terminate() { this.terminated = true; }

  emit(line) {
    for (const fn of this.listeners.get('message') || []) fn({ data: line });
  }

  emitError(message) {
    for (const fn of this.listeners.get('error') || []) fn({ message });
  }

  #emitSoon(text) {
    setTimeout(() => { for (const line of text.split('\n')) this.emit(line); }, 0);
  }

  #beginSearch(cmd) {
    const entry = { cmd, startedAt: Date.now(), endedAt: null };
    this.searches.push(entry);
    this.live++;
    this.maxLive = Math.max(this.maxLive, this.live);
    if (this.neverAnswer) return;
    entry.timer = setTimeout(() => this.#finishSearch(entry), this.replyDelay);
  }

  /** Emit the search result (also the reply a real engine gives to `stop`). */
  #finishSearch(wanted) {
    const entry = wanted || this.searches.find((s) => s.endedAt === null);
    if (!entry || entry.endedAt !== null) return;
    const index = this.searches.indexOf(entry);
    entry.score = 100 + index;
    entry.answer = ANSWERS[index % ANSWERS.length];
    entry.endedAt = Date.now();
    clearTimeout(entry.timer);
    this.emit(`info depth 1 score cp ${entry.score}`);
    this.emit(`bestmove ${entry.answer}`);
    this.live--;
  }
}

/** Build an Engine whose Worker is a FakeWorker. */
async function makeEngine(chess, workerOpts = {}) {
  let worker = null;
  globalThis.Worker = function () {
    worker = new FakeWorker('fake');
    Object.assign(worker, workerOpts);
    return worker;
  };
  const engine = new Engine({ Chess, getChess: () => chess, onStatus: () => {} });
  const kind = await engine.init();
  engine.testWorker = worker;
  engine.testKind = kind;
  return engine;
}

function isLegal(chess, move) {
  if (!move) return false;
  return chess.moves({ verbose: true }).some(
    (m) => m.from === move.from && m.to === move.to &&
      (!move.promotion || m.promotion === move.promotion)
  );
}

/* ================================== tests ================================= */

/* ---- 1. overlapping evaluate + bestMove are serialised, not corrupted ---- */
{
  const chess = new Chess();
  const engine = await makeEngine(chess);
  check('engine initialises against the fake UCI worker', engine.testKind === 'wasm',
    engine.testKind);

  const [cp, move] = await Promise.all([
    engine.evaluate(chess, { depth: 5, timeoutMs: 2000 }),
    engine.bestMove(chess, { difficulty: 'casual' })
  ]);

  const w = engine.testWorker;
  check('concurrent requests never run two searches at once', w.maxLive === 1,
    `maxLive=${w.maxLive}`);
  check('the evaluation still returns its own number', typeof cp === 'number',
    String(cp));
  check('the reply is the move the engine gave THAT search',
    move && `${move.from}${move.to}` === ANSWERS[1], JSON.stringify(move));
  check('the reply is legal', isLegal(chess, move));
  check('the search slot is clean afterwards', engine.proc.pending === null);
  engine.destroy();
}

/* ---- 2. the opposite issue order behaves the same ---- */
{
  const chess = new Chess();
  const engine = await makeEngine(chess);

  const [move, cp] = await Promise.all([
    engine.bestMove(chess, { difficulty: 'casual' }),
    engine.evaluate(chess, { depth: 5, timeoutMs: 2000 })
  ]);

  const w = engine.testWorker;
  check('issue order reversed: still one search at a time', w.maxLive === 1,
    `maxLive=${w.maxLive}`);
  check('issue order reversed: the reply matches its own search',
    move && `${move.from}${move.to}` === ANSWERS[0], JSON.stringify(move));
  check('issue order reversed: the evaluation matches its own search', cp === 101,
    String(cp));
  engine.destroy();
}

/* ---- 3. a late bestmove from an abandoned search must not leak ---- */
{
  const chess = new Chess();
  const engine = await makeEngine(chess);
  const w = engine.testWorker;
  w.replyDelay = 250;

  // Start a search, then abandon it the way the UI does when it moves on.
  const first = engine.evaluate(chess, { depth: 5, timeoutMs: 5000 });
  await sleep(30);
  engine.proc.stop();
  const firstValue = await first;
  check('the abandoned evaluation resolves (heuristic fallback)',
    typeof firstValue === 'number', String(firstValue));

  // This search must get its OWN answer, not the abandoned search's late one.
  const move = await engine.bestMove(chess, { difficulty: 'casual' });
  check('the next search is not resolved by the abandoned one',
    move && `${move.from}${move.to}` === ANSWERS[1], JSON.stringify(move));
  check('still only one search at a time after an abandon', w.maxLive === 1,
    `maxLive=${w.maxLive}`);
  engine.destroy();
}

/* ---- 4. a timeout abandons cleanly and the queue keeps moving ---- */
{
  const chess = new Chess();
  const engine = await makeEngine(chess);
  engine.testWorker.replyDelay = 400;   // far longer than the timeout below

  const timedOut = await engine.evaluate(chess, { depth: 5, timeoutMs: 40 });
  check('a timed-out evaluation degrades instead of hanging',
    typeof timedOut === 'number', String(timedOut));

  const move = await engine.bestMove(chess, { difficulty: 'casual' });
  check('the engine is still usable after a timeout', isLegal(chess, move),
    JSON.stringify(move));
  engine.destroy();
}

/* ---- 5. a burst of requests is served one at a time ---- */
{
  const chess = new Chess();
  const engine = await makeEngine(chess);
  engine.testWorker.replyDelay = 10;

  const values = await Promise.all([
    engine.evaluate(chess, { depth: 2, timeoutMs: 2000 }),
    engine.evaluate(chess, { depth: 2, timeoutMs: 2000 }),
    engine.evaluate(chess, { depth: 2, timeoutMs: 2000 }),
    engine.evaluate(chess, { depth: 2, timeoutMs: 2000 })
  ]);
  check('every queued request completes', values.every((v) => typeof v === 'number'),
    values.join(', '));
  check('a burst is still serialised to one search at a time',
    engine.testWorker.maxLive === 1, `maxLive=${engine.testWorker.maxLive}`);
  engine.destroy();
}

/* ---- 6. a worker error fails the search without hanging the app ---- */
{
  const chess = new Chess();
  const engine = await makeEngine(chess);
  const w = engine.testWorker;
  w.replyDelay = 5000;         // never answers in time

  const pending = engine.evaluate(chess, { depth: 5, timeoutMs: 5000 });
  await sleep(20);
  w.emitError('worker died');
  const value = await pending;
  check('a worker error resolves the in-flight search', typeof value === 'number',
    String(value));

  w.replyDelay = 10;
  const move = await engine.bestMove(chess, { difficulty: 'casual' });
  check('the engine recovers after a worker error', isLegal(chess, move),
    JSON.stringify(move));
  engine.destroy();
}

/* ---- 7. no engine at all: degrade to the Pocket Bot ---- */
{
  const chess = new Chess();
  globalThis.Worker = function () {
    const w = new FakeWorker('fake');
    w.failHandshake = true;
    return w;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('offline'));
  const engine = new Engine({ Chess, getChess: () => chess, onStatus: () => {} });
  const kind = await engine.init();
  globalThis.fetch = realFetch;

  check('all builds failing degrades to the pocket bot', kind === 'pocket', kind);
  const move = await engine.bestMove(chess, { difficulty: 'beginner' });
  check('the pocket bot still returns a legal move', isLegal(chess, move),
    JSON.stringify(move));
  const cp = await engine.evaluate(chess, { depth: 4 });
  check('the fallback evaluation is a number', typeof cp === 'number', String(cp));
  engine.destroy();
}

/* ---- 8. the difficulty presets are untouched ---- */
{
  check('three difficulty tiers are still defined',
    Object.keys(DIFFICULTIES).length === 3, Object.keys(DIFFICULTIES).join(','));
  check('challenger still searches deepest',
    DIFFICULTIES.challenger.depth > DIFFICULTIES.casual.depth
    && DIFFICULTIES.casual.depth > DIFFICULTIES.beginner.depth);
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL ENGINE TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);
