const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');

function app() {
  const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob,
    window: { matchMedia: () => ({ matches: false }) }, document: { addEventListener() {}, createElement(tag) {
      assert.equal(tag, 'canvas');
      return { getContext: () => ({ measureText: text => ({ width: text.length * 12 }) }) };
    } } });
  for (const file of ['formation.js', 'app.js', 'labels.js', 'court.js', 'export.js', 'ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    if (file === 'formation.js') context.SR = context.window.SR;
  }
  const run = code => vm.runInContext(code, context);
  run('state.rotations = buildRotations()');
  return run;
}
const clean = value => JSON.parse(JSON.stringify(value));

test('native display preferences survive adoption and sharing; legacy encoding stays unchanged', () => {
  const run = app();
  assert.equal(run("'positionBadges' in buildSharePayload().display"), false);
  assert.equal(run("'playerNamesAndNumbers' in buildSharePayload().display"), false);
  run(`const incoming = buildSharePayload();
    incoming.display.positionBadges = true;
    incoming.display.playerNamesAndNumbers = false;
    incoming.labels = { O1: 'Riley' }; incoming.numbers = { O1: '07' };
    applyState(normalizePayload(decodeSharePayload(encodeSharePayload(incoming))));`);
  assert.equal(run('buildSharePayload().display.positionBadges'), true);
  assert.equal(run('buildSharePayload().display.playerNamesAndNumbers'), false);
  assert.equal(run("courtLabel('O1')"), 'O1');
  assert.equal(run("rosterLabel('O1')"), 'RILEY · #07');
  const before = clean(run('stateSnapshot()'));
  run('setShowPositionBadges(false); setShowPlayerNamesAndNumbers(true)');
  assert.equal(run("courtLabel('O1')"), '07');
  assert.deepEqual(clean(run('stateSnapshot().positions')), before.positions);
  assert.equal(run('canUndo()'), false);
});

for (const system of ['4-2', '5-1', '6-2']) {
  for (const [action, style] of [['resetAllCourts', 'courtPosition'], ['smartArrangeAll', 'smart']]) {
    test(`${system}: ${action} keeps per-rotation receivers and undoes all courts in one step`, () => {
      const run = app();
      run(`state.system = '${system}'; state.setupStyle = 'smart';
        state.rotationSetupStyles = { 1: 'courtPosition' };
        state.rotationPassers = { 0: [], 1: ['L'], 2: ['O1', 'O2'] };
        state.rotations = buildRotations();
        state.rotations[4].positions[1].x += 0.123456789;`);
      const before = clean(run('stateSnapshot()'));
      run(`${action}()`);
      assert.equal(run('state.setupStyle'), style);
      assert.deepEqual(clean(run('state.rotationSetupStyles')), {});
      assert.deepEqual(clean(run('stateSnapshot().rotationPassers')), before.rotationPassers);
      assert.equal(run('undoStack.length'), 1);
      assert.equal(run(`state.rotations.every((r, i) => JSON.stringify(r.positions) === JSON.stringify(buildRotationAt(i).positions))`), true);
      run('setShowPositionBadges(true); undo()');
      const after = clean(run('stateSnapshot()'));
      assert.deepEqual(after.positions, before.positions);
      assert.deepEqual(after.rotationPassers, before.rotationPassers);
      assert.deepEqual(after.rotationSetupStyles, before.rotationSetupStyles);
      assert.equal(after.setupStyle, before.setupStyle);
      assert.equal(run('state.showPositionBadges'), true);
      assert.equal(run('canUndo()'), false);
    });
  }
}

test('exported SVG includes six position badges only when enabled', () => {
  const run = app();
  assert.doesNotMatch(run("courtSVGString(0, {size: 400, floorHref: ''})"), /class="position-badge"/);
  run('setShowPositionBadges(true)');
  const svg = run("courtSVGString(0, {size: 400, floorHref: ''})");
  assert.equal((svg.match(/class="position-badge"/g) || []).length, 6);
  for (let zone = 1; zone <= 6; zone++) assert.match(svg, new RegExp(`>${zone}</text>`));
});

test('court view choices and edit actions expose native parity controls', () => {
  const run = app();
  assert.deepEqual(clean(run('courtViewMenuItems(2).filter(x => x.checked !== undefined).map(x => x.label)')),
    ['Receive', 'Court Position', 'Player names & numbers', 'Position badges']);
  assert.ok(run("editMenuItems().some(x => x.label === 'Reset All Rotations')"));
  assert.ok(run("editMenuItems().some(x => x.label === 'Smart Arrange All Rotations')"));
});

test('inactive roster roles do not steal visible names or numbers, including cached system changes', () => {
  const run = app();
  run(`state.playerNumbers = { S: '07', S1: '07', OP: '12', S2: '12' };
    state.playerLabels = { S: 'SAM', S1: 'SAM' };`);
  assert.equal(run("courtLabel('S')"), '07');
  assert.equal(run("courtLabel('OP')"), '12');
  for (const system of ['4-2', '6-2', '5-1']) {
    run(`setSystem('${system}')`);
    assert.equal(run("courtLabel(state.system === '5-1' ? 'S' : 'S1')"), '07');
    assert.equal(run("courtLabel(state.system === '5-1' ? 'OP' : 'S2')"), '12');
    assert.equal(run('Object.keys(courtLabels()).length'), 7);
    run('applyState(normalizePayload(decodeSharePayload(encodeSharePayload(buildSharePayload()))))');
    assert.deepEqual(clean(run('buildSharePayload().numbers')), { S: '07', S1: '07', S2: '12', OP: '12' });
  }
  run(`state.playerNumbers = {}; state.system = '6-2'`);
  assert.equal(run("courtLabel('S1')"), 'SAM');
  run(`state.playerLabels.O1 = 'SAM'`);
  assert.equal(run("courtLabel('S1')"), 'S1');
  assert.equal(run("courtLabel('O1')"), 'O1');
});

test('unsupported share versions fail without changing the current document, preview or undo', () => {
  const run = app();
  run(`startApp(); stageImport(buildSharePayload()); nudgePlayer(0, 1, 1, 0);
    const savedPreview = pendingImport; const incomingVersion = buildSharePayload();`);
  const before = clean(run('[stateSnapshot(), undoStack, pendingImport, library]'));
  for (const version of ['undefined', 'null', "'1'", 'true', 'false', '0', '-1', '2', '999', '1.5']) {
    run(`incomingVersion.v = ${version}`);
    assert.equal(run('payloadFromText("sr=" + encodeSharePayload(incomingVersion))'), null, version);
    assert.deepEqual(clean(run('[stateSnapshot(), undoStack, pendingImport, library]')), before, version);
    assert.equal(run('pendingImport === savedPreview'), true);
  }
  run('incomingVersion.v = 1.0');
  assert.equal(run('payloadFromText("sr=" + encodeSharePayload(incomingVersion)).v'), 1);
});

test('share rounding keeps edge ties legal, bounded and stable after repeated adoption', () => {
  const run = app();
  for (const xs of [[8.3998, 8.3999, 8.4], [0.6, 0.6001, 0.6002], [4.3998, 4.3999, 4.4]]) {
    run(`state.rotations = buildRotations();
      [4, 3, 2].forEach((z, i) => { state.rotations[0].positions[z] = { x: ${JSON.stringify(xs)}[i], y: 2 }; });
      [5, 6, 1].forEach((z, i) => { state.rotations[0].positions[z] = { x: i + 2, y: 7 }; });
      applyState(normalizePayload(buildSharePayload()));`);
    assert.deepEqual(clean(run('SR.validateOverlap(state.rotations[0].positions)')), []);
    assert.equal(run('Object.values(state.rotations[0].positions).every(p => p.x >= SR.PLAYER_R + 0.05 && p.x <= 9 - (SR.PLAYER_R + 0.05))'), true);
    const adopted = clean(run('stateSnapshot().positions'));
    run('applyState(normalizePayload(buildSharePayload()))');
    assert.deepEqual(clean(run('stateSnapshot().positions')), adopted);
  }
  for (const y of [0.6, 8.4]) {
    run(`var verticalTies = { 4: {x: 2, y: ${y}}, 5: {x: 2, y: ${y}} };
      SR.separateTies(verticalTies);`);
    assert.equal(run('verticalTies[4].y < verticalTies[5].y'), true);
    assert.equal(run('verticalTies[4].y >= SR.PLAYER_R + 0.05 && verticalTies[5].y <= 9 - (SR.PLAYER_R + 0.05)'), true);
  }
});

test('tie repair respects a close distinct neighbour and retains reversed arrangements', () => {
  const run = app();
  run(`const closeTies = { 4: {x: 4.4, y: 2}, 3: {x: 4.4, y: 2}, 2: {x: 4.4001, y: 2} };
    SR.separateTies(closeTies);`);
  assert.equal(run('closeTies[4].x < closeTies[3].x && closeTies[3].x < closeTies[2].x'), true);
  run(`const reversed = { 4: {x: 6, y: 2}, 3: {x: 5, y: 2}, 2: {x: 4, y: 2} }`);
  const before = clean(run('reversed'));
  run('SR.separateTies(reversed)');
  assert.deepEqual(clean(run('reversed')), before);
});

for (const [name, transition] of [
  ['switch', 'switchToSetup(otherID)'],
  ['switch away and back', 'switchToSetup(otherID); switchToSetup(originalID)'],
  ['duplicate', 'duplicateCurrentSetup()'],
  ['new setup', "newSetup('Fresh', '6-2', 'smart')"],
  ['delete', 'deleteCurrentSetup()'],
  ['system change', "setSystem('6-2')"],
  ['state adoption', 'applyState(buildSharePayload())'],
  ['incoming preview', 'stageImport(buildSharePayload())'],
  ['save incoming preview', "stageImport(buildSharePayload()); saveImportAsNewSetup('Imported')"],
  ['discard incoming preview', 'stageImport(buildSharePayload()); discardImport()']
]) {
  test(`a stale drag cannot move players or add undo after ${name}`, () => {
    const run = app();
    run(`startApp(); const originalID = library.currentID;
      newSetup('Other', '5-1', 'courtPosition'); const otherID = library.currentID;
      switchToSetup(originalID); const gesture = beginPlayerDrag(0, 1);
      updatePlayerDrag(gesture, {x: 7, y: 7}); ${transition};`);
    const before = clean(run('[stateSnapshot(), undoStack, library]'));
    assert.equal(run('isCurrentPlayerDrag(gesture)'), false);
    assert.equal(run('updatePlayerDrag(gesture, {x: 2, y: 2})'), false);
    assert.equal(run('finishPlayerDrag(gesture)'), false);
    assert.deepEqual(clean(run('[stateSnapshot(), undoStack, library]')), before);
  });
}

test('a current drag has one scoped undo while untouched drags ignore edits on other courts', () => {
  const run = app();
  run('const untouched = beginPlayerDrag(0, 1); nudgePlayer(1, 1, 1, 0)');
  assert.equal(run('finishPlayerDrag(untouched)'), false);
  assert.equal(run('undoStack.length'), 1);
  const before = clean(run('stateSnapshot().positions[0]'));
  run('const currentGesture = beginPlayerDrag(0, 1); updatePlayerDrag(currentGesture, {x: 7, y: 7})');
  assert.equal(run('finishPlayerDrag(currentGesture)'), true);
  assert.equal(run('undoStack.length'), 2);
  const other = clean(run('stateSnapshot().positions[1]'));
  run('undo()');
  assert.deepEqual(clean(run('stateSnapshot().positions[0]')), before);
  assert.deepEqual(clean(run('stateSnapshot().positions[1]')), other);
  for (const args of ['-1, 1', '6, 1', '0.5, 1', '0, 7']) assert.equal(run(`beginPlayerDrag(${args})`), null);
});

test('settings and court menus invoke the same Smart Arrange behavior', () => {
  const run = app();
  run("state.setupStyle = 'courtPosition'; state.rotations = buildRotations(); ui.rotation = 2; handleAction('smart-arrange')");
  assert.equal(run('setupStyleFor(2)'), 'smart');
  assert.equal(run('setupStyleFor(0)'), 'courtPosition');
  run("handleAction('smart-arrange-all')");
  assert.equal(run('state.setupStyle'), 'smart');
  assert.deepEqual(clean(run('state.rotationSetupStyles')), {});
});

test('local script and stylesheet URLs carry their current content hashes', () => {
  const { createHash } = require('node:crypto');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([a-z-]+(?:\.min)?\.(?:js|css))(\?[^"]*)?"/g)) {
    const hash = createHash('sha256').update(fs.readFileSync(path.join(root, match[1]))).digest('hex').slice(0, 12);
    assert.equal(match[2], `?v=${hash}`, match[1]);
  }
});

test('print court shows role codes and six position badges while retaining roster details', () => {
  const run = app();
  run(`state.playerLabels = { O1: 'Riley' }; state.playerNumbers = { O1: '07' };
    setShowPlayerNamesAndNumbers(false); setShowPositionBadges(true);
    const printedText = [];
    const printContext = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      strokeRect() {}, arc() {}, fill() {}, fillText(text) { printedText.push(text); } };
    drawPrintCourt(printContext, 0, 0, 0, 180, 180);`);
  assert.deepEqual(clean(run('printedText')), ['S', 'O1', 'M1', 'OP', 'O2', 'L', '1', '2', '3', '4', '5', '6']);
  assert.equal(run("rosterLabel('O1')"), 'RILEY · #07');
});
