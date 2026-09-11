import puppeteer from 'puppeteer';
import fs from 'node:fs';

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
const pg = await b.newPage();
fs.mkdirSync('shots', { recursive: true });

async function shot(w, h, name, playMoves = false) {
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await pg.goto('http://localhost:8899/index.html', { waitUntil: 'networkidle2' });
  await pg.waitForFunction(
    () => /ready|Pocket Bot/i.test(document.querySelector('#status-text')?.textContent || ''),
    { timeout: 60000 }
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  if (playMoves) {
    // Play a short opening so the coach panel has content to show.
    for (const [from, to] of [['e2', 'e4'], ['g1', 'f3'], ['f1', 'c4']]) {
      const turnOk = await pg.evaluate((f) => {
        const s = window.__chessClub.state;
        return s.chess.turn() === s.playerColor && s.chess.get(f)?.color === s.playerColor;
      }, from);
      if (!turnOk) { await new Promise((r) => setTimeout(r, 2500)); }
      await pg.click(`.square[data-square="${from}"]`).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      await pg.click(`.square[data-square="${to}"]`).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  await pg.screenshot({ path: `shots/${name}.png`, fullPage: false });
  console.log('saved shots/' + name + '.png');
}

await shot(1280, 900, '1-desktop', true);
await shot(820, 1180, '2-ipad-portrait', true);
await shot(1180, 820, '3-ipad-landscape', true);
await shot(390, 844, '4-phone-portrait', true);

await b.close();
