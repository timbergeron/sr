// Check actual rendered pixels: SVG text can exist in the DOM but be blank in Safari.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { webkit, chromium } = require('playwright');
const { PNG } = require('pngjs');
const { checkTouch } = require('./touch.cjs');
const root = path.join(__dirname, '..');

function pixelBounds(png, box, matches) {
  let count = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(png.height, Math.ceil(box.y + box.height)); y++) {
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(png.width, Math.ceil(box.x + box.width)); x++) {
      const offset = (y * png.width + x) * 4;
      if (!matches(png.data.subarray(offset, offset + 4))) continue;
      count++; left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { count, x: (left + right + 1) / 2, y: (top + bottom + 1) / 2 };
}

async function checkText(svg, description, selector = '.player-label text, .position-badge text') {
  const boxes = await svg.evaluate((el, selector) => {
    const origin = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll(selector)).map(text => {
      const box = text.getBoundingClientRect();
      const center = new DOMPoint(0, text.y.baseVal.length ? text.y.baseVal.getItem(0).value : 0).matrixTransform(text.getScreenCTM());
      const position = Boolean(text.closest('.position-badge'));
      const layer = position ? 'position' : text.previousElementSibling?.tagName === 'text' ? 'role' : 'name';
      return { label: text.textContent, position, layer,
        x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height,
        centerX: center.x - origin.x, centerY: center.y - origin.y };
    });
  }, selector);
  const png = PNG.sync.read(await svg.screenshot());
  // Isolate glyphs for alignment checks so a nearby white position circle or
  // player rim cannot be mistaken for part of a letter.
  await svg.evaluate(el => {
    // A separate copy prevents a normal app redraw from replacing our test styles.
    const box = el.getBoundingClientRect();
    const copy = el.cloneNode(true); copy.id = 'test-ink-court'; copy.classList.add('test-ink');
    // Glyphs use solid paints. Do not duplicate IDs for the live court's gradients.
    copy.querySelectorAll('defs, filter').forEach(node => node.remove());
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.style.cssText = `position:fixed;top:0;left:0;z-index:9999;width:${box.width}px;height:${box.height}px;background:#000`;
    copy.querySelectorAll('text').forEach(text => {
      const layer = text.closest('.position-badge') ? 'position' : text.previousElementSibling?.tagName === 'text' ? 'role' : 'name';
      text.classList.add(`test-ink-${layer}`);
    });
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.classList.add('test-ink-style'); copy.appendChild(style);
    document.body.appendChild(copy);
  });
  const copy = svg.page().locator('#test-ink-court');
  const isolated = {};
  try {
    for (const layer of ['name', 'role', 'position']) {
      await copy.evaluate((el, layer) => {
        el.querySelector('.test-ink-style').textContent = `
          .test-ink circle, .test-ink path, .test-ink image, .test-ink line, .test-ink rect { visibility: hidden; }
          .test-ink text { visibility: hidden; }
          .test-ink .test-ink-${layer} { visibility: visible; fill: #fff; }`;
      }, layer);
      isolated[layer] = PNG.sync.read(await copy.screenshot());
    }
  } finally {
    await copy.evaluate(el => el.remove());
  }
  for (const box of boxes) {
    const visible = pixelBounds(png, box, box.position
      ? ([r, g, b, a]) => r < 120 && g < 120 && b > r && a > 225
      : ([r, g, b, a]) => r > 225 && g > 225 && b > 225 && a > 225);
    assert.ok(visible.count >= 4, `${description}: ${box.label} is not painted (${visible.count} pixels)`);
    const ink = pixelBounds(isolated[box.layer], box, ([r, g, b, a]) => r > 225 && g > 225 && b > 225 && a > 225);
    assert.ok(ink.count >= 4, `${description}: ${box.label} has no visible glyphs`);
    assert.ok(Math.abs(ink.y - box.centerY) <= 2, `${description}: ${box.position ? 'position' : 'player'} ${box.label} is vertically off-center by ${(ink.y - box.centerY).toFixed(2)}px`);
    assert.ok(Math.abs(ink.x - box.centerX) <= 2, `${description}: ${box.label} is horizontally off-center`);
  }
  return boxes.filter(box => !box.position).length;
}

async function checkOverlappingBodies(svg, description) {
  const players = await svg.evaluate(el => {
    const origin = el.getBoundingClientRect();
    return courtPlayers(0, { positions: state.rotations[0].positions }).map(player => {
      const center = new DOMPoint(player.position.x, player.position.y).matrixTransform(el.getScreenCTM());
      const radius = SR.PLAYER_R * el.getScreenCTM().a;
      return { role: player.role, color: ROLE_COLORS[player.family].slice(1).match(/../g).map(hex => parseInt(hex, 16)),
        x: center.x - origin.x - radius, y: center.y - origin.y - radius, width: radius * 2, height: radius * 2 };
    });
  });
  const png = PNG.sync.read(await svg.screenshot());
  for (const player of players) {
    const ink = pixelBounds(png, player, pixel => player.color.every((channel, i) => Math.abs(channel - pixel[i]) < 18));
    assert.ok(ink.count >= 15, `${description}: ${player.role}'s overlapping circle is missing (${ink.count} colored pixels)`);
  }
}

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
          assert.equal(await checkText(svg, `${system}, ${width}px, ${colorScheme}`), 7); // Six identities, plus O1's separate role line.
          await page.evaluate(() => { state.playerNumbers = {}; render(); });
          assert.equal(await checkText(svg, `${system} names, ${width}px, ${colorScheme}`), 7);
        }
        for (const name of ['AL', 'ÅSA']) {
          await page.evaluate(name => { state.playerLabels = { O1: name }; render(); }, name);
          assert.equal(await checkText(page.locator('.court-card[data-index="0"] .court-svg'), `${name}, ${width}px, ${colorScheme}`), 7);
        }
        await page.evaluate(() => {
          setSystem('5-1'); state.playerLabels = {}; state.playerNumbers = {}; smartArrangeAll();
        });
        const svg = page.locator('.court-card[data-index="0"] .court-svg');
        for (const selectedZone of [null, 3, 1]) {
          await page.evaluate(zone => selectPlayer(0, zone), selectedZone);
          await checkOverlappingBodies(svg, `${width}px, ${colorScheme}, selected ${selectedZone}`);
        }
        await page.evaluate(() => {
          resetAllCourts(); state.playerNumbers = { O1: '07' }; render();
          const container = document.createElement('div'); container.id = 'test-export';
          container.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#000';
          container.innerHTML = courtSVGString(0, { size: 300, floorHref: 'assets/floor.jpg' });
          document.body.appendChild(container);
        });
        assert.equal(await checkText(page.locator('#test-export svg'), `export, ${width}px, ${colorScheme}`, 'text'), 7);
        await page.locator('#test-export').evaluate(el => el.remove());
        assert.deepEqual(errors, []);
        console.log(`PASS: ${width}px ${colorScheme}: centered player/position text, overlapping circles, setup title, Team sheet and horizontal bounds`);
        await context.close();
      }
    }
    await checkTouch(browser, url, process.env.SR_BROWSER || 'webkit');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exit(1); });
