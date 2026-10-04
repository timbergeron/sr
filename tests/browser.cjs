// Check actual rendered pixels: SVG text can exist in the DOM but be blank in Safari.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { webkit, chromium } = require('playwright');
const { PNG } = require('pngjs');
const root = path.join(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/sr\//, '') || 'index.html';
    const file = path.resolve(root, name);
    if (!file.startsWith(root + '/') || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const target = fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(target)] || 'application/octet-stream');
    res.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = process.argv[2] || `http://127.0.0.1:${server.address().port}/sr/`;
  const browser = await ({ webkit, chromium }[process.env.SR_BROWSER || 'webkit']).launch({ headless: true });
  try {
    for (const width of [320, 390]) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => state.rotations.length === 6 && ui.courts.length === 6);
        const title = await page.locator('.setup-name').evaluate(el => ({ width: el.clientWidth, needed: el.scrollWidth }));
        assert.ok(title.width >= title.needed, `${width}px: default setup name is truncated (${title.width}px available, ${title.needed}px needed)`);
        await page.locator('#team-button').click();
        await page.waitForFunction(() => document.body.classList.contains('settings-open'));
        await page.locator('#settings-done').click();
        assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth), true);
        for (const system of ['4-2', '5-1', '6-2']) {
          await page.evaluate(system => {
            setSystem(system); state.playerLabels = { O1: 'RILEY' }; state.playerNumbers = { O1: '07' };
            resetAllCourts(); setShowPositionBadges(true);
          }, system);
          const svg = page.locator('.court-card[data-index="0"] .court-svg');
          await svg.scrollIntoViewIfNeeded();
          const boxes = await svg.evaluate(el => {
            const origin = el.getBoundingClientRect();
            return Array.from(el.querySelectorAll('.player-label text')).map(text => {
              const box = text.getBoundingClientRect();
              return { label: text.textContent, x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
            });
          });
          const png = PNG.sync.read(await svg.screenshot());
          for (const box of boxes) {
            let white = 0;
            for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(png.height, Math.ceil(box.y + box.height)); y++) {
              for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(png.width, Math.ceil(box.x + box.width)); x++) {
                const offset = (y * png.width + x) * 4;
                if (png.data[offset] > 225 && png.data[offset + 1] > 225 && png.data[offset + 2] > 225 && png.data[offset + 3] > 225) white++;
              }
            }
            assert.ok(white >= 4, `${system}, ${width}px, ${colorScheme}: ${box.label} is not painted (${white} white pixels)`);
          }
          assert.equal(boxes.length, 7); // Six identities, plus O1's separate role line.
        }
        assert.deepEqual(errors, []);
        console.log(`PASS: ${width}px ${colorScheme}: visible player labels in all systems, setup title, Team sheet and horizontal bounds`);
        await context.close();
      }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exit(1); });
