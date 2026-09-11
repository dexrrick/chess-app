/**
 * Cloudflare Worker entry point.
 *
 * Cloudflare serves everything in the `assets` directory automatically via
 * the `[assets]` binding in wrangler.toml. This Worker only runs as a
 * fallback, when a request does not match a static file.
 *
 * We use it for two things:
 *   1. SPA-style fallback: unknown non-asset GETs return index.html so the
 *      app keeps working if the user navigates to a sub-path.
 *   2. Security headers that make the Web Worker + WASM engine load reliably
 *      (some strict CSP setups block WASM compilation; we allow it here).
 */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  // Allow the app to fetch chess.js/stockfish.js from CDNs, spawn blob/worker
  // scripts, and compile WebAssembly.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com",
    "worker-src 'self' blob: https://cdn.jsdelivr.net https://unpkg.com",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    'frame-ancestors \'none\''
  ].join('; ')
};

export default {
  /**
   * @param {Request} request
   * @param {{ASSETS: {fetch: (req: Request) => Promise<Response>}, ENVIRONMENT?: string}} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Let the assets binding handle real files first.
    let response = await env.ASSETS.fetch(request);

    // Fall back to the app shell for client-side routes.
    if (response.status === 404 && request.method === 'GET') {
      const accept = request.headers.get('Accept') || '';
      const looksLikeAsset = /\.[a-z0-9]+$/i.test(url.pathname);
      if (!looksLikeAsset && (accept.includes('text/html') || accept === '*/*')) {
        const indexReq = new Request(new URL('/index.html', url.origin), request);
        response = await env.ASSETS.fetch(indexReq);
      }
    }

    // Attach security headers without breaking streaming bodies.
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // Long cache for fingerprinted-ish static assets, none for HTML.
    if (/\.(css|js|svg|png|webp|woff2?)$/i.test(url.pathname)) {
      headers.set('Cache-Control', 'public, max-age=3600, must-revalidate');
    } else {
      headers.set('Cache-Control', 'no-cache');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
