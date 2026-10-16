const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');

function app(saved = null) {
  const stored = new Map(saved ? [['serve-receive.setups.v1', saved]] : []);
  const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob,
    // Decoding is covered with actual raster files in the browser regressions.
    Image: class {
      set src(data) { this.complete = true; this.naturalWidth = data.endsWith('YmFk') ? 0 : 512;
        this.naturalHeight = this.naturalWidth;
        if (this.naturalWidth) this.onload?.(); else this.onerror?.(); }
    },
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
      matchMedia: () => ({ matches: false }) }, document: { addEventListener() {}, createElement(tag) {
      assert.equal(tag, 'canvas');
      return { getContext: () => ({ measureText: text => ({ width: text.length * 12 }) }) };
    } } });
  for (const file of ['formation.js', 'app.js', 'images.js', 'labels.js', 'court.js', 'export.js', 'ui.js']) {
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
    ['Receive', 'Court Position', 'Player names & numbers', 'Labels on photos', 'Position badges']);
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

const photo = 'data:image/png;base64,aGVsbG8=';
const source = 'data:image/jpeg;base64,c291cmNl';

test('crop geometry matches native framing, bounds and maximum zoom', () => {
  const run = app();
  assert.deepEqual(clean(run('photoCropRect({}, 1200, 800)')), { x: 200, y: 0, width: 800, height: 800 });
  assert.deepEqual(clean(run('photoCropRect({ centerX: 0.5, centerY: 0.5, zoom: 2 }, 800, 1200)')),
    { x: 200, y: 400, width: 400, height: 400 });
  for (const [w, h] of [[1200, 800], [800, 1200], [512, 512]]) {
    for (const zoom of [-1, 1, 2, 8, 99, NaN, Infinity]) {
      run(`var boundedCrop = photoCropRect({ centerX: -1, centerY: 2, zoom: ${zoom} }, ${w}, ${h})`);
      const rect = clean(run('boundedCrop'));
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= w && rect.y + rect.height <= h);
      assert.equal(rect.width, rect.height);
      assert.ok(rect.width >= Math.min(w, h) / 8 && rect.width <= Math.min(w, h));
    }
  }
  assert.deepEqual(clean(run('clampedPhotoCrop({centerX: NaN, zoom: Infinity}, 0, 800)')), { centerX: 0.5, centerY: 0.5, zoom: 1 });
  assert.deepEqual(clean(run('photoCropRect({}, Infinity, 800)')), { x: 0, y: 0, width: 0, height: 0 });
});

test('artwork survives reload, duplication and backups while links stay byte-identical', () => {
  const run = app();
  run('startApp(); const originalSetupID = library.currentID; const originalLink = shareHash()');
  run(`setPlayerImage('O1', '${photo}', '${source}', {centerX: 0.4, centerY: 0.6, zoom: 2});
    setTeamLogo('${photo}'); setWatermarkOpacity(0.23);`);
  const images = clean(run('state.images'));
  assert.equal(run('shareHash()'), run('originalLink'));
  assert.equal(run('canUndo()'), false);
  const saved = run('window.localStorage.getItem(LIBRARY_KEY)');
  const restored = app(saved);
  restored('startApp()');
  assert.deepEqual(clean(restored('state.images')), images);
  assert.deepEqual(JSON.parse(run('backupText()')).setups[0].images, images);
  run('duplicateCurrentSetup(); const duplicateID = library.currentID; setPlayerImage("O1", null)');
  assert.equal(run('state.images.players.O1'), undefined);
  run('switchToSetup(originalSetupID)');
  assert.deepEqual(clean(run('state.images')), images);
  run('switchToSetup(duplicateID)');
  assert.equal(run('state.images.players.O1'), undefined);
  assert.equal(run('state.images.playerSources.O1'), undefined);
  assert.equal(run('state.images.playerCrops.O1'), undefined);
  assert.equal(run('state.images.teamLogo'), photo);
  run('newSetup("Fresh", "6-2", "smart")');
  assert.deepEqual(clean(run('state.images')), { players: {}, playerSources: {}, playerCrops: {}, teamLogo: null, watermarkOpacity: 0.16 });
});

test('import previews exclude artwork and restore it on discard; formation undo preserves current photos', () => {
  const run = app();
  run(`startApp(); setPlayerImage('O1', '${photo}', '${source}', {zoom: 2}); setTeamLogo('${photo}');
    const originalImages = normalizedSetupImages(state.images); resetAllCourts();
    setWatermarkOpacity(0.3); undo();`);
  assert.equal(run('state.images.watermarkOpacity'), 0.3);
  assert.equal(run('state.images.players.O1'), photo);
  run('stageImport(buildSharePayload())');
  assert.deepEqual(clean(run('state.images.players')), {});
  run(`setPlayerImage('O1', '${photo}'); setTeamLogo('${photo}')`);
  assert.equal(run('state.images.teamLogo'), null);
  run('discardImport()');
  assert.equal(run('state.images.players.O1'), photo);
  assert.equal(run('state.images.watermarkOpacity'), 0.3);
  run('stageImport(buildSharePayload()); saveImportAsNewSetup("From coach")');
  assert.deepEqual(clean(run('state.images.players')), {});
  assert.equal(run('state.images.teamLogo'), null);
});

test('legacy setups open without images and storage failure retains artwork for backup and retry', () => {
  const run = app();
  run('startApp(); delete library.setups[0].images');
  const old = app(run('backupText()'));
  old('startApp()');
  assert.equal(old('persistenceIssue'), null);
  assert.equal(old('state.images.watermarkOpacity'), 0.16);
  run(`const originalSave = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    setPlayerImage('O1', '${photo}');`);
  assert.equal(run('persistenceIssue'), 'saveFailed');
  assert.equal(JSON.parse(run('backupText()')).setups[0].images.players.O1, photo);
  run('window.localStorage.setItem = originalSave; retryPersistence()');
  assert.equal(run('persistenceIssue'), null);
  assert.equal(JSON.parse(run('window.localStorage.getItem(LIBRARY_KEY)')).setups[0].images.players.O1, photo);
});

test('only local raster images are accepted and opacity uses native bounds', () => {
  const run = app();
  for (const invalid of ['https://example.com/photo.png', 'data:image/svg+xml;base64,YQ==', 'javascript:alert(1)', null]) {
    assert.equal(run(`localImage(${JSON.stringify(invalid)})`), null);
  }
  run(`state.images = normalizedSetupImages({players: {O1: '${photo}', BAD: '${photo}'},
    playerSources: {O1: '${source}', O2: '${source}'}, playerCrops: {O2: {zoom: 3}}, watermarkOpacity: 2});`);
  assert.deepEqual(Object.keys(clean(run('state.images.players'))), ['O1']);
  assert.deepEqual(Object.keys(clean(run('state.images.playerSources'))), ['O1']);
  assert.equal(run('state.images.watermarkOpacity'), 0.4);
  assert.equal(run('clampedWatermarkOpacity(-1)'), 0);
  assert.equal(run('clampedWatermarkOpacity(NaN)'), 0.16);
});

test('late image edits are invalid after changing setups, systems or incoming previews', () => {
  for (const transition of ['newSetup("Other", "5-1", "smart")', 'setSystem("6-2")',
    'duplicateCurrentSetup()', 'stageImport(buildSharePayload()); discardImport()']) {
    const run = app();
    run(`startApp(); const edit = imageEditContext('O1'); ${transition}`);
    assert.equal(run('imageEditIsCurrent(edit)'), false, transition);
  }
  const run = app();
  run(`startApp(); const photoEdit = imageEditContext('O1'); setPlayerImage('O1', '${photo}')`);
  assert.equal(run('imageEditIsCurrent(photoEdit)'), false, 'replacing a photo invalidates an older image request');
});

test('crop controls pan the retained source and Use Photo saves a square; cancel preserves artwork', () => {
  const run = app();
  run(`startApp();
    const controls = {};
    class ImageControl {
      constructor() { this.handlers = {}; this.style = {}; this.value = ''; this.clientWidth = 200; }
      addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
      emit(name, fields = {}) { const event = { target: this, preventDefault() {}, ...fields };
        for (const callback of this.handlers[name] || []) callback(event); }
      setAttribute() {} focus() {} setPointerCapture() {}
      getBoundingClientRect() { return { left: 0, top: 0 }; }
      close() { this.emit('close'); }
    }
    document.getElementById = id => controls[id] ||= new ImageControl();
    const cropDraws = [];
    document.createElement = () => ({ width: 0, height: 0,
      getContext: () => ({ drawImage(...args) { cropDraws.push(args.slice(1)); },
        getImageData: () => ({data: [1, 2, 3, 255]}) }), toDataURL: () => '${photo}' });
    wireImageControls();
    photoDraft = {edit: imageEditContext('O1'), source: '${source}',
      image: {naturalWidth: 900, naturalHeight: 450}, crop: {centerX: 0.5, centerY: 0.5, zoom: 1}};
    controls['photo-zoom'].value = '2'; controls['photo-zoom'].emit('input');
    controls['photo-viewport'].emit('pointerdown', {pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100});
    controls['photo-viewport'].emit('pointermove', {pointerId: 1, clientX: 120, clientY: 110});
    controls['photo-viewport'].emit('pointerup', {pointerId: 1});
    controls['photo-editor-form'].emit('submit');`);
  const args = clean(run('cropDraws[0]'));
  assert.ok(Math.abs(args[0] - 315) < 1e-9);
  assert.ok(Math.abs(args[1] - 101.25) < 1e-9);
  assert.deepEqual(args.slice(2), [225, 225, 0, 0, 512, 512]);
  assert.equal(run('state.images.players.O1'), photo);
  assert.equal(run('state.images.playerSources.O1'), source);
  assert.equal(run('state.images.playerCrops.O1.zoom'), 2);
  assert.equal(run('photoDraft'), null);
  const saved = clean(run('state.images'));
  run(`photoDraft = {edit: imageEditContext('O1'), source: '${source}',
    image: {naturalWidth: 900, naturalHeight: 450}, crop: {zoom: 8}};
    controls['photo-reset'].emit('click'); controls['photo-editor'].close();`);
  assert.deepEqual(clean(run('state.images')), saved);
});

test('print rendering clips photos to discs and draws the transparent watermark before court lines', () => {
  const run = app();
  run(`state.images = normalizedSetupImages({watermarkOpacity: 0.3});
    const printImages = [], printOrder = [];
    const photoBitmap = {naturalWidth: 512, naturalHeight: 512};
    const logoBitmap = {naturalWidth: 200, naturalHeight: 100};
    const artworkContext = {save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
      stroke() {}, arc() {}, fill() {}, fillText() {}, strokeText() {}, measureText: text => ({width: text.length * 5}),
      strokeRect() { printOrder.push('lines'); }, clip() { printOrder.push('clip'); },
      drawImage(image, ...args) { printOrder.push(image === logoBitmap ? 'logo' : 'photo'); printImages.push(args); }};
    drawPrintCourt(artworkContext, 0, 0, 0, 180, 180, {players: {O1: photoBitmap}, teamLogo: logoBitmap});`);
  assert.deepEqual(clean(run('printOrder')), ['logo', 'lines', 'clip', 'photo']);
  clean(run('printImages[0]')).forEach((value, i) => assert.ok(Math.abs(value - [32.4, 61.2, 115.2, 57.6][i]) < 1e-9));
  assert.equal(run('artworkContext.globalAlpha'), 0.3);
});

test('court SVG places logos beneath lines and follows the displayed roster through all systems', () => {
  const run = app();
  run(`setPlayerImage('O1', '${photo}'); setPlayerImage('L', '${photo}'); setTeamLogo('${photo}')`);
  for (const system of ['4-2', '5-1', '6-2']) {
    run(`setSystem('${system}')`);
    for (let rotation = 0; rotation < 6; rotation++) {
      const svg = run(`courtSVGString(${rotation}, {size: 400, floorHref: ''})`);
      assert.equal((svg.match(/class="player-photo"/g) || []).length, 2);
      assert.equal((svg.match(/class="team-logo"/g) || []).length, 1);
      assert.doesNotMatch(svg, /class="photo-caption"/);
      assert.ok(svg.indexOf('class="team-logo"') < svg.indexOf('<line x1="0"'));
    }
  }
  run('setShowBackrowMAsL(false)');
  assert.equal((run("courtSVGString(0, {size: 400, floorHref: ''})").match(/class="player-photo"/g) || []).length, 1);
  run('setWatermarkOpacity(0)');
  assert.doesNotMatch(run("courtSVGString(0, {size: 400, floorHref: ''})"), /class="team-logo"/);
});

test('photo label preference survives saved setups, links and undo without changing artwork or formations', () => {
  const run = app();
  assert.equal(run("'photoLabels' in buildSharePayload().display"), false);
  run(`startApp(); setPlayerImage('O1', '${photo}'); const beforePhotoLabels = stateSnapshot();
    setShowPhotoLabels(false); resetAllCourts(); undo();`);
  assert.equal(run('buildSharePayload().display.photoLabels'), false);
  assert.deepEqual(clean(run('stateSnapshot().positions')), clean(run('beforePhotoLabels.positions')));
  assert.equal(run('state.images.players.O1'), photo);
  const reload = app(run('backupText()')); reload('startApp()');
  assert.equal(reload('state.showPhotoLabels'), false);
  assert.equal(reload('state.images.players.O1'), photo);
  run('applyState(normalizePayload(decodeSharePayload(encodeSharePayload(buildSharePayload()))))');
  assert.equal(run('state.showPhotoLabels'), false);
  run(`const legacyPhotoDisplay = buildSharePayload(); delete legacyPhotoDisplay.display.photoLabels;
    applyState(normalizePayload(legacyPhotoDisplay));`);
  assert.equal(run('state.showPhotoLabels'), true);
});

test('photo-only courts hide labels and position badges only for readable photos across all systems', () => {
  const run = app();
  run(`setPlayerImage('O1', '${photo}'); setPlayerImage('O2', 'data:image/png;base64,YmFk');
    setShowPositionBadges(true); setShowPhotoLabels(false);`);
  for (const system of ['4-2','5-1','6-2']) {
    run(`setSystem('${system}')`);
    for (let rotation = 0; rotation < 6; rotation++) {
      const players = run(`courtPlayers(${rotation}, {positions: state.rotations[${rotation}].positions})`);
      assert.equal(players.filter(p => p.showsLabels === false).length, 1);
      const svg = run(`courtSVGString(${rotation}, {size: 400, floorHref: ''})`);
      assert.equal((svg.match(/class="position-badge"/g) || []).length, 5);
      assert.equal((svg.match(/class="player-photo"/g) || []).length, 1);
    }
  }
  assert.equal(run("showsCourtLabels('O1')"), false);
  assert.equal(run("showsCourtLabels('O2')"), true);
  run("setPlayerImage('O1', null)");
  assert.equal(run("showsCourtLabels('O1')"), true);
});

test('photo labels use outlined glyphs instead of a backing capsule', () => {
  const run = app();
  run(`setPlayerImage('O1', '${photo}'); state.playerNumbers = {O1: '07'};`);
  const markup = run("labelTextMarkup(courtPlayers(0, {positions: state.rotations[0].positions}).find(p => p.occ.id === 'O1'))");
  assert.doesNotMatch(markup, /<rect/);
  assert.match(markup, /stroke-opacity="1"/);
  assert.match(markup, /paint-order="stroke fill"/);
});

test('reset control reflects saved court positions and resets only its own rotation', () => {
  const run = app();
  run('startApp(); resetAllCourts(); forgetHistory()');
  assert.equal(run('positionsAlreadyInZones(2)'), true);
  run('state.rotations[2].positions[1].x -= 0.2');
  assert.equal(run('positionsAlreadyInZones(2)'), false);
  const before = clean(run('stateSnapshot()'));
  run('resetCourtFromControls(2)');
  assert.equal(run('positionsAlreadyInZones(2)'), true);
  assert.equal(run('ui.zoneView.has(2)'), false);
  assert.equal(run('undoStack.length'), 1);
  run('undo()');
  assert.deepEqual(clean(run('stateSnapshot()')), before);
});
