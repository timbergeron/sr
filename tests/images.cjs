const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { PNG } = require('pngjs');
const { localURL, routeSite, launchBrowser } = require('./site.cjs');

function fixture(width, height, colorAt) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    png.data.set(colorAt(x, y), offset);
  }
  return PNG.sync.write(png);
}
const portrait = { name: 'player.png', mimeType: 'image/png', buffer: fixture(900, 450,
  x => x < 300 ? [240, 30, 30, 255] : x < 600 ? [30, 220, 40, 255] : [30, 40, 240, 255]) };
const logo = { name: 'logo.png', mimeType: 'image/png', buffer: fixture(200, 100,
  (x, y) => x >= 40 && x < 160 && y >= 20 && y < 80 ? [20, 40, 230, 255] : [0, 0, 0, 0]) };

async function choose(page, button, file) {
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await picker.setFiles(file);
}

async function setRange(locator, value) {
  await locator.evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

async function main() {
  const engine = process.env.SR_BROWSER || 'webkit';
  const browser = await launchBrowser({ chromium, webkit }[engine]);
  try {
    for (const width of [320, 1100]) {
      const context = await browser.newContext({ viewport: { width, height: 844 },
        colorScheme: width === 320 ? 'dark' : 'light', reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await routeSite(page, localURL);
      await page.goto(localURL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => ui.courts.length === 6);
      if (width < 1100) await page.locator('#team-button').click();
      const playerButton = page.locator('.roster-row[data-id="O1"] .image-button');
      const originalLink = await page.evaluate(() => shareHash());
      const originalSetup = await page.evaluate(() => library.currentID);
      await choose(page, playerButton, portrait);
      await page.locator('#photo-editor').waitFor({ state: 'visible' });
      assert.deepEqual(await page.evaluate(() => photoDraft.crop), { centerX: 0.5, centerY: 0.5, zoom: 1 });
      await setRange(page.locator('#photo-zoom'), 2);
      const viewport = page.locator('#photo-viewport');
      const box = await viewport.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 4 });
      await page.mouse.up();
      const dragged = await page.evaluate(() => photoDraft.crop);
      assert.ok(dragged.centerX < 0.5 && dragged.centerY < 0.5, 'drag must reframe the source');
      await viewport.press('ArrowRight');
      assert.ok(await page.evaluate(x => photoDraft.crop.centerX > x, dragged.centerX));
      // WebKit exposes taps but no multitouch automation. Replay both fingers to
      // verify combined pan and zoom; mouse input above checks pointer capture.
      const zoom = await viewport.evaluate(el => {
        const capture = el.setPointerCapture; el.setPointerCapture = () => {};
        const box = el.getBoundingClientRect();
        const pointer = (type, id, x) => el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id,
          clientX: box.left + box.width * x, clientY: box.top + box.height / 2
        }));
        try {
          pointer('pointerdown', 101, 0.4); pointer('pointerdown', 102, 0.6);
          pointer('pointermove', 101, 0.3); pointer('pointermove', 102, 0.7);
          pointer('pointerup', 101, 0.3); pointer('pointerup', 102, 0.7);
          return photoDraft.crop.zoom;
        } finally { el.setPointerCapture = capture; }
      });
      assert.ok(zoom > 3.9 && zoom < 4.1, 'pinch must double the zoom');
      await page.locator('#photo-reset').click();
      assert.equal(await page.evaluate(() => photoDraft.crop.zoom), 1);
      await setRange(page.locator('#photo-zoom'), 2);
      await page.locator('#photo-use').click();
      await page.locator('#photo-editor').waitFor({ state: 'hidden' });
      const saved = await page.evaluate(() => ({ ...state.images.playerCrops.O1 }));
      const savedPhoto = await page.evaluate(() => state.images.players.O1);
      assert.equal(saved.zoom, 2);
      assert.equal(await page.evaluate(() => shareHash()), originalLink);
      assert.equal(await page.locator('.court-svg .player-photo').count(), 6);
      assert.equal(await page.locator('.court-svg .photo-caption').count(), 6);
      await playerButton.click();
      await page.getByRole('menuitem', { name: 'Adjust crop', exact: true }).click();
      await page.locator('#photo-editor').waitFor({ state: 'visible' });
      assert.deepEqual(await page.evaluate(() => photoDraft.crop), saved);
      assert.equal(await page.evaluate(() => photoDraft.image.naturalWidth), 900, 'editor must retain the original source');
      await setRange(page.locator('#photo-zoom'), 1);
      await page.locator('#photo-editor [data-close]').click();
      assert.equal(await page.evaluate(() => state.images.players.O1), savedPhoto);
      await choose(page, page.locator('#team-logo-button'), logo);
      await page.waitForFunction(() => Boolean(state.images.teamLogo));
      await setRange(page.locator('#watermark-opacity'), 0.3);
      assert.equal(await page.locator('.court-svg .team-logo').count(), 6);
      assert.equal(await page.locator('.court-svg .team-logo').first().getAttribute('opacity'), '0.3');
      assert.equal(await page.locator('#watermark-opacity-value').textContent(), '30%');
      const transparency = await page.evaluate(async () => {
        const image = await loadImage(state.images.teamLogo), canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 100;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, 1, 1).data[3];
      });
      assert.equal(transparency, 0);
      // Exercise actual SVG rasterization, PNG delivery and the PDF print canvas.
      const exports = await page.evaluate(async () => {
        resetAllCourts();
        const image = await courtImage(0, 500), canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const pngPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let green = 0;
        for (let i = 0; i < pngPixels.length; i += 4) if (pngPixels[i + 1] > 160 && pngPixels[i] < 100 && pngPixels[i + 2] < 100) green++;
        const delivered = [];
        const deliver = deliverFile;
        deliverFile = async (blob, filename) => delivered.push({ type: blob.type, size: blob.size, filename });
        let pdfGreen = 0, pdfBlue = 0;
        const originalPDF = window.jspdf;
        window.jspdf = { jsPDF: class {
          addImage(canvas) {
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i + 1] > 140 && pixels[i] < 100 && pixels[i + 2] < 100) pdfGreen++;
              if (pixels[i + 2] > pixels[i] + 15 && pixels[i + 2] > pixels[i + 1] + 15) pdfBlue++;
            }
          }
          output() { return new Blob(['print-test'], { type: 'application/pdf' }); }
        } };
        try { await exportImage(); await exportPrintPDF(); }
        finally { deliverFile = deliver; window.jspdf = originalPDF; }
        return { green, pdfGreen, pdfBlue, delivered };
      });
      assert.ok(exports.green > 200, 'PNG court must contain the player photo');
      assert.ok(exports.pdfGreen > 200, 'PDF canvas must contain player photos');
      assert.ok(exports.pdfBlue > 200, 'PDF canvas must contain the team watermark');
      assert.deepEqual(exports.delivered.map(file => file.type), ['image/png', 'application/pdf']);
      assert.ok(exports.delivered[0].size > 1000);
      const images = await page.evaluate(() => state.images);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => ui.courts.length === 6);
      assert.deepEqual(await page.evaluate(() => state.images), images);
      await page.evaluate(() => { duplicateCurrentSetup(); setPlayerImage('O1', null); });
      await page.evaluate(id => switchToSetup(id), originalSetup);
      assert.deepEqual(await page.evaluate(() => state.images), images);
      await page.evaluate(() => { stageImport(buildSharePayload()); });
      assert.equal(await page.locator('.court-svg .player-photo').count(), 0);
      await page.evaluate(() => discardImport());
      assert.equal(await page.locator('.court-svg .player-photo').count(), 6);
      if (width < 1100) await page.locator('#team-button').click();
      await playerButton.click();
      await page.getByRole('menuitem', { name: 'Adjust crop', exact: true }).click();
      await page.locator('#photo-editor').waitFor({ state: 'visible' });
      await page.evaluate(() => newSetup('Fresh', '5-1', 'smart'));
      await page.locator('#photo-editor').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => state.images.teamLogo), null);
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${engine} ${width}px: upload, pan, pinch, keyboard, crop cancel/re-edit, transparent watermark, saved artwork, SVG/PNG/PDF rendering and edit isolation`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
