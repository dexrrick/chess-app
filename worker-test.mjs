/**
 * worker-test.mjs — unit-tests the Cloudflare Worker (src/index.js) in Node
 * with a fake ASSETS binding. This avoids depending on `wrangler dev`, which
 * hangs in some sandboxed environments.
 *
 * Verifies:
 *   - real files are passed through with their status/MIME
 *   - a missing asset with an extension stays a 404 (no HTML masquerading as JS)
 *   - an extension-less path falls back to index.html (deep links work)
 *   - security headers are attached, including a WASM-friendly CSP
 *   - cache-control differs for hashed assets vs HTML
 */

import fs from 'node:fs';
import worker from './src/index.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`);
}

const HTML = '<!DOCTYPE html><html><body>Chess Club</body></html>';

/** Minimal stand-in for Cloudflare's static asset binding. */
function makeAssets(files) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const body = files[url.pathname];
      if (body === undefined) {
        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response(body.body, {
        status: 200,
        headers: { 'Content-Type': body.type }
      });
    }
  };
}

const files = {
  '/index.html': { body: HTML, type: 'text/html; charset=utf-8' },
  '/style.css': { body: 'body{}', type: 'text/css; charset=utf-8' },
  '/app.js': { body: 'export default 1;', type: 'text/javascript; charset=utf-8' },
  '/vendor/stockfish.wasm': { body: new Uint8Array([0, 97, 115, 109]), type: 'application/wasm' }
};

const env = { ASSETS: makeAssets(files) };

async function req(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (!headers.has('Accept')) headers.set('Accept', opts.accept || 'text/html');
  const request = new Request('https://chess.example.com' + path, {
    method: opts.method || 'GET',
    headers
  });
  const res = await worker.fetch(request, env, {});
  return res;
}

/* ---------------------------------------------------------------- 1. files */
{
  const res = await req('/');
  check('root serves the app shell', res.status === 200);
  const ct = res.headers.get('Content-Type') || '';
  check('root is HTML', ct.includes('text/html'), ct);
}

{
  const res = await req('/app.js');
  const ct = res.headers.get('Content-Type') || '';
  check('JS asset served with JS content-type', res.status === 200 && ct.includes('javascript'), ct);
}

{
  const res = await req('/vendor/stockfish.wasm');
  const ct = res.headers.get('Content-Type') || '';
  check('wasm asset served with application/wasm', ct.includes('wasm'), ct);
}

/* ------------------------------------------------- 2. missing asset => 404 */
{
  const res = await req('/vendor/nope.wasm');
  check('missing .wasm stays a 404 (not HTML)', res.status === 404, String(res.status));
}
{
  const res = await req('/missing.js');
  check('missing .js stays a 404 (not HTML)', res.status === 404, String(res.status));
}
{
  const res = await req('/nope.css');
  check('missing .css stays a 404', res.status === 404, String(res.status));
}

/* ------------------------------------------------- 3. deep links => shell */
{
  const res = await req('/play/computer/beginner');
  const body = await res.text();
  check('extension-less deep link returns the app shell',
    res.status === 200 && body.includes('Chess Club'), String(res.status));
}
{
  const res = await req('/settings', { accept: 'text/html,application/xhtml+xml' });
  check('deep link with a real Accept header returns the shell', res.status === 200);
}

/* -------------------------------------------------------- 4. headers */
{
  const res = await req('/play');
  const csp = res.headers.get('Content-Security-Policy') || '';
  check('CSP is attached to fallback responses', csp.length > 0);
  check('CSP allows WebAssembly compilation', csp.includes('wasm-unsafe-eval'), csp.slice(0, 80));
  check('CSP allows worker scripts', /worker-src[^;]*blob:/i.test(csp));
  check('CSP allows the chess.js/stockfish CDNs',
    csp.includes('cdn.jsdelivr.net') && csp.includes('unpkg.com'));
  check('CSP forbids framing', csp.includes("frame-ancestors 'none'"));
  check('X-Content-Type-Options is nosniff',
    res.headers.get('X-Content-Type-Options') === 'nosniff');
  check('Referrer-Policy set', !!res.headers.get('Referrer-Policy'));
}

/* ------------------------------------------------------ 5. cache headers */
{
  const res = await req('/app.js');
  const cc = res.headers.get('Cache-Control') || '';
  check('static assets get a cacheable Cache-Control', /max-age=\d+/.test(cc), cc);
}
{
  const res = await req('/');
  const cc = res.headers.get('Cache-Control') || '';
  check('HTML is not long-cached', cc.includes('no-cache'), cc);
}

/* -------------------------------------------------------- 6. non-GET */
{
  const res = await req('/play', { method: 'POST' });
  check('non-GET to a missing route does not return the shell',
    res.status === 404, String(res.status));
}

/* ------------------------------------------------- 7. body passthrough */
{
  const res = await req('/style.css');
  const body = await res.text();
  check('response body is passed through intact', body === 'body{}', JSON.stringify(body));
}

/* ------------------------------ 8. _headers ↔ Worker parity --------------- */
/*
 * Because `run_worker_first = false`, requests for real files never reach the
 * Worker — so the security headers that actually protect the site are the ones
 * in assets/_headers (see the comments in that file). The Worker repeats them
 * for the responses it generates itself. This block keeps the two in step.
 */
{
  const headersText = fs.readFileSync(new URL('./assets/_headers', import.meta.url), 'utf8');

  /** Parse the `_headers` format: a pattern line plus indented `Name: value`s. */
  function parseHeadersFile(text) {
    const rules = [];
    let rule = null;
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      if (!/^\s/.test(raw)) {
        rule = { pattern: raw.trim(), headers: {} };
        rules.push(rule);
        continue;
      }
      const m = raw.match(/^\s+([A-Za-z0-9-]+):\s*(.*)$/);
      if (m && rule) rule.headers[m[1].toLowerCase()] = m[2].trim();
    }
    return rules;
  }

  const rules = parseHeadersFile(headersText);
  const catchAll = rules.find((r) => r.pattern === '/*');
  check('_headers covers every asset with a /* rule', !!catchAll,
    rules.map((r) => r.pattern).join(', ') || '(no rules parsed)');

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const assetCsp = catchAll ? catchAll.headers['content-security-policy'] || '' : '';
  check('_headers sets a Content-Security-Policy', assetCsp.length > 0);

  // Compare the file against what the Worker sends for the very same asset.
  const res = await req('/app.js');
  const workerCsp = res.headers.get('Content-Security-Policy') || '';
  check('_headers CSP matches the Worker CSP exactly',
    norm(assetCsp) === norm(workerCsp),
    norm(assetCsp) === norm(workerCsp) ? '' : 'the two policies have drifted');

  for (const name of ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy']) {
    const fromFile = catchAll ? catchAll.headers[name] || '' : '';
    const fromWorker = res.headers.get(name) || '';
    check(`_headers "${name}" matches the Worker's`, fromFile === fromWorker,
      fromFile === fromWorker ? fromFile : `file="${fromFile}" worker="${fromWorker}"`);
  }

  // These two are what make the engine work. The asset-layer policy is the one
  // that actually runs in production, so assert them on it directly.
  check('_headers CSP permits WebAssembly compilation', assetCsp.includes('wasm-unsafe-eval'));
  check('_headers CSP permits blob workers', /worker-src[^;]*blob:/i.test(assetCsp));
}

console.log('\n========================================');
console.log(failures === 0 ? '  ALL WORKER TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);
