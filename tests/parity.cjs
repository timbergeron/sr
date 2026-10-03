const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');

function app() {
  const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob,
    window: {}, document: { addEventListener() {}, createElement(tag) {
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
    ['Receive', 'Zones (Court Position)', 'Player names & numbers', 'Position badges']);
  assert.ok(run("editMenuItems().some(x => x.label === 'Reset All Rotations')"));
  assert.ok(run("editMenuItems().some(x => x.label === 'Smart Arrange All Rotations')"));
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
