import fs from 'node:fs';
const sw = fs.readFileSync('assets/sw.js', 'utf8');
const assets = [...sw.matchAll(/'\.\/(.*?)'/g)].map((m) => m[1]).filter((p) => p && !p.includes('index.html') && !p.includes('style.css') && !p.includes('app.js'));
const required = ['index.html', 'style.css', 'app.js', 'src/drills.js', 'src/practice/progress.js', 'src/practice/controller.js', 'src/practice/feedback.js', 'src/practice/session.js'];
let failures = 0;
for (const path of required) {
  const listed = sw.includes(`'./${path}'`);
  const exists = fs.existsSync(`assets/${path}`);
  console.log(`[${listed && exists ? 'PASS' : 'FAIL'}] ${path} is present and precached`);
  if (!listed || !exists) failures++;
}
for (const path of assets) if (!fs.existsSync(`assets/${path}`)) { console.log(`[FAIL] removed asset referenced: ${path}`); failures++; }
process.exit(failures ? 1 : 0);
