const assert = require('node:assert/strict');

async function checkTouch(browser, url, engine) {
  const context = await browser.newContext({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.route('https://**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => ui.courts.length === 6);
    await page.evaluate(() => { resetAllCourts(); forgetHistory(); });
    const svg = page.locator('.court-card[data-index="0"] .court-svg');
    await svg.scrollIntoViewIfNeeded();
    const point = await svg.evaluate(el => {
      window.testTouchStart = null;
      document.addEventListener('touchstart', event => {
        window.testTouchStart = { connected: event.target.isConnected, blocked: event.defaultPrevented,
          zone: Number(event.target.closest('.player')?.dataset.zone) };
      }, { once: true, passive: true });
      const p = state.rotations[0].positions[2];
      const point = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.touchscreen.tap(point.x, point.y);
    assert.deepEqual(await page.evaluate(() => window.testTouchStart), { connected: true, blocked: true, zone: 2 }, 'native touchstart lost its target or allowed scrolling');
    // Replay Safari's pointer/touch ordering with the original touched element.
    // WebKit's automation protocol exposes taps, but not native touch swipes.
    const result = await svg.evaluate(async el => {
      const initial = JSON.stringify(stateSnapshot().positions);
      const p = state.rotations[0].positions[2];
      const point = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
      const touched = document.elementFromPoint(point.x, point.y);
      const pointer = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 42, pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
      const touch = (type, target) => {
        const event = new Event(type, { bubbles: true, cancelable: true }); target.dispatchEvent(event); return event.defaultPrevented;
      };
      touched.dispatchEvent(pointer('pointerdown', point.x, point.y));
      const connected = touched.isConnected && el.contains(touched);
      const startBlocked = touch('touchstart', touched);
      el.dispatchEvent(pointer('pointermove', point.x - 25, point.y + 25));
      await new Promise(requestAnimationFrame);
      const moveBlocked = touch('touchmove', touched);
      const connectedAfterMove = touched.isConnected && el.contains(touched);
      el.dispatchEvent(pointer('pointerup', point.x - 25, point.y + 25));
      const changed = JSON.stringify(stateSnapshot().positions) !== initial;
      const undoCount = undoStack.length;
      const released = !touch('touchmove', touched) && !ui.courts[0].isDragging();
      undo();
      const restored = JSON.stringify(stateSnapshot().positions) === initial;
      const floor = el.querySelector('.court-floor rect');
      const floorAllowed = !touch('touchstart', floor);
      setZoneView(0, true);
      const staticAllowed = !touch('touchstart', touched);
      setZoneView(0, false);
      stageImport(buildSharePayload());
      const previewAllowed = !touch('touchstart', touched);
      discardImport();
      return { connected, connectedAfterMove, startBlocked, moveBlocked, changed, undoCount, released, restored, floorAllowed, staticAllowed, previewAllowed };
    });
    assert.deepEqual(result, { connected: true, connectedAfterMove: true, startBlocked: true, moveBlocked: true, changed: true, undoCount: 1, released: true, restored: true, floorAllowed: true, staticAllowed: true, previewAllowed: true });

    if (engine === 'chromium') {
      // Send real touch input through the browser, so its scrolling and pointer
      // cancellation behavior are exercised rather than simulated DOM defaults.
      const session = await context.newCDPSession(page);
      const swipe = async (point, dx, dy) => {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
        for (let step = 1; step <= 6; step++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + dx * step / 6, y: point.y + dy * step / 6, id: 1 }] });
          await page.waitForTimeout(20);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const prepare = async zone => page.evaluate(zone => {
        setRotation(0); setZoneView(0, false); resetAllCourts(); forgetHistory(); window.scrollTo(0, 40);
        const el = ui.courts[0].element;
        const p = zone ? state.rotations[0].positions[zone] : { x: 4.5, y: 4 };
        const point = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
        return { point: { x: point.x, y: point.y }, positions: JSON.stringify(stateSnapshot().positions),
          y: window.scrollY, x: document.querySelector('.courts-inner').scrollLeft };
      }, zone);
      for (const [zone, dx, dy] of [[5, 0, -60], [6, -70, 0]]) {
        const before = await prepare(zone);
        await swipe(before.point, dx, dy);
        const after = await page.evaluate(() => ({ positions: JSON.stringify(stateSnapshot().positions), undoCount: undoStack.length,
          dragging: ui.courts[0].isDragging(), rotation: ui.rotation, y: window.scrollY, x: document.querySelector('.courts-inner').scrollLeft }));
        assert.notEqual(after.positions, before.positions, 'native touch drag did not move a player');
        assert.equal(after.undoCount, 1); assert.equal(after.dragging, false); assert.equal(after.rotation, 0);
        assert.ok(Math.abs(after.y - before.y) <= 1, 'player drag scrolled the page');
        assert.ok(Math.abs(after.x - before.x) <= 1, 'player drag swiped to another rotation');
        await page.evaluate(() => undo());
        assert.equal(await page.evaluate(() => JSON.stringify(stateSnapshot().positions)), before.positions);
      }
      const before = await prepare(null);
      await swipe(before.point, 0, -60);
      await page.waitForFunction(y => window.scrollY > y + 2, before.y);
      const floor = await prepare(null);
      await swipe(floor.point, -100, 0);
      await page.waitForFunction(() => ui.rotation === 1);
      await session.detach();
    }
    console.log(`PASS: ${engine}: native touchstart stays attached and blocks scrolling; drag releases cleanly and undoes once; empty/static courts allow scrolling`);
  } finally { await context.close(); }
}

module.exports = { checkTouch };
