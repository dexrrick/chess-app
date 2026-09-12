/**
 * test-all.mjs — runs the whole test suite against a freshly started server.
 *
 *   npm test
 *
 * Starts the local static server on a spare port, waits for it to answer,
 * runs the worker unit tests plus the browser suites, then shuts the server
 * down and reports a single pass/fail result.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.TEST_PORT || '8912';
const BASE = `http://127.0.0.1:${PORT}`;

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: __dirname,
      stdio: 'inherit',
      // No shell: `process.execPath` may contain spaces (e.g. "C:\Program
      // Files\nodejs\node.exe"), which a shell would split on.
      env: { ...process.env, ...env }
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const server = spawn(process.execPath, [path.join(__dirname, 'scripts', 'serve.mjs'), PORT], {
  cwd: __dirname,
  stdio: 'ignore'
});

let exitCode = 0;

try {
  const up = await waitForServer(`${BASE}/index.html`);
  if (!up) {
    console.error(`\n  Could not start the test server on port ${PORT}.\n`);
    process.exit(1);
  }
  console.log(`\n  Test server ready at ${BASE}\n`);

  const suites = [
    ['Worker unit tests', 'worker-test.mjs'],
    ['Engine unit tests', 'engine-test.mjs'],
    ['Coach unit tests', 'coach-test.mjs'],
    ['Browser smoke tests', 'smoke-test.mjs'],
    ['End-to-end scenarios', 'e2e-test.mjs']
  ];

  const results = [];
  for (const [label, file] of suites) {
    console.log(`\n${'='.repeat(60)}\n  ${label}\n${'='.repeat(60)}\n`);
    const code = await run(process.execPath, [path.join(__dirname, file)], { TEST_URL: `${BASE}/index.html` });
    results.push([label, code]);
    if (code !== 0) exitCode = 1;
  }

  console.log(`\n${'='.repeat(60)}\n  SUMMARY\n${'='.repeat(60)}`);
  for (const [label, code] of results) {
    console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${label}`);
  }
  console.log('');
} finally {
  server.kill();
  // Give the child a moment to release the port.
  await new Promise((r) => setTimeout(r, 300));
}

process.exit(exitCode);
