/**
 * scripts/serve.mjs — a tiny zero-dependency static server for local testing.
 *
 * The app is pure static files, so this is all you need to try it out:
 *
 *     npm run serve            # http://localhost:8899
 *     npm run serve -- 3000    # custom port
 *
 * It serves the `assets/` directory (the same directory Cloudflare uploads),
 * which guarantees what you test locally is what gets deployed.
 *
 * Note: `assets/vendor/stockfish.wasm` is served with the correct
 * `application/wasm` MIME type, which browsers require for
 * `WebAssembly.instantiateStreaming`. Getting that wrong is a classic reason
 * for a chess engine to silently fail to load.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'assets');

const PORT = Number(process.argv[2] || process.env.PORT || 8899);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

/** Resolve a URL path to a file inside ROOT, refusing to escape it. */
function resolveFile(urlPath) {
  let pathname = decodeURIComponent(urlPath.split('?')[0]);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const candidate = path.resolve(ROOT, '.' + pathname);
  // Path traversal guard.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;

  // Cloudflare parses assets/_headers itself and never serves it as a file.
  // Mirror that, and deliberately do NOT fall through to the SPA shell below:
  // a request for a metadata file should be a 404, not an HTML page.
  if (/_?headers$/i.test(path.basename(candidate))) return null;

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  // SPA-style fallback for extension-less routes.
  if (!path.extname(pathname)) {
    const index = path.join(ROOT, 'index.html');
    if (fs.existsSync(index)) return index;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      // No caching, so a refresh always picks up your latest edit.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  Chess Club is running:\n`);
  console.log(`    http://${shown}:${PORT}/\n`);
  console.log(`  Serving: ${ROOT}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try:  npm run serve -- 3000\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
