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

console.log('\n========================================');
console.log(failures === 0 ? '  ALL WORKER TESTS PASSED' : `  ${failures} CHECK(S) FAILED`);
console.log('========================================\n');
process.exit(failures ? 1 : 0);
