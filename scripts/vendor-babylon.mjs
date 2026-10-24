import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST_DIR = path.resolve(ROOT, 'assets', 'vendor', 'babylon');

fs.mkdirSync(DEST_DIR, { recursive: true });

console.log('1. Copying Havok assets...');
const havokEsmDir = path.resolve(ROOT, 'node_modules', '@babylonjs', 'havok', 'lib', 'esm');
fs.copyFileSync(
  path.resolve(havokEsmDir, 'HavokPhysics.wasm'),
  path.resolve(DEST_DIR, 'HavokPhysics.wasm')
);
fs.copyFileSync(
  path.resolve(havokEsmDir, 'HavokPhysics_es.js'),
  path.resolve(DEST_DIR, 'HavokPhysics_es.js')
);
console.log('   HavokPhysics.wasm and HavokPhysics_es.js copied.');

console.log('2. Bundling Babylon.js ESM...');
const entryContent = `
export * from '@babylonjs/core';
`;

await esbuild.build({
  stdin: {
    contents: entryContent,
    resolveDir: ROOT,
    loader: 'js'
  },
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2022'],
  outfile: path.resolve(DEST_DIR, 'babylon.js'),
  sourcemap: false
});

console.log('   assets/vendor/babylon/babylon.js bundled successfully.');
