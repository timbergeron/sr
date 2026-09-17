// State, saved setups, undo history and share links.
//
// Mirrors the native app's model so a setup behaves the same in the browser, on an
// iPhone and on an iPad. Nothing here touches the DOM: the page subscribes with
// onStateChange and draws whatever the state says.

const SHARE_HASH_PREFIX = 'sr=';
const SHARE_VERSION = 1;
const PLAYER_IDS = ['S', 'S1', 'S2', 'O1', 'O2', 'M1', 'M2', 'OP', 'L'];
const POSITION_ZONES = [1, 2, 3, 4, 5, 6];
const SETUP_STYLES = ['smart', 'courtPosition'];
// Links from other devices may carry names this long; typing is capped far shorter.
const MAX_LABEL_LENGTH = 64;
const MAX_NAME_ENTRY_LENGTH = 5;
const LIBRARY_KEY = 'serve-receive.setups.v1';
const UNDO_LIMIT = 30;
// Wider than a share link's three-decimal rounding, far below anything a finger does.
const PLACEMENT_EPSILON = 0.005;

const state = {
  system: '5-1',
  passerCount: 3,
  // The shared default selection. Older web clients read only this.
  passers: new Set(['L', 'O1', 'O2']),
  // Rotation index -> ids. Missing entries use `passers`; an empty list selects nobody.
  rotationPassers: {},
  // null keeps the original auto-placement of existing setups and links.
  setupStyle: null,
  rotationSetupStyles: {},
  playerLabels: {},
  playerNumbers: {},
  showHints: true,
  showBackrowMAsL: true,
  showSpotNumbers: false,
  rotations: []
};

const stateListeners = [];

function onStateChange(listener) {
  stateListeners.push(listener);
}

function notifyStateChange() {
  for (const listener of stateListeners) listener();
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function graphemes(value) {
  const text = String(value);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
  }
  return Array.from(text);
}

function rosterName(value) {
  return graphemes(value).slice(0, MAX_LABEL_LENGTH).join('');
}

function normalizedNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 2);
}

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
}

// ---- Share payload ----

function cleanedPlayerLabels(labels = state.playerLabels) {
  const cleaned = {};
  for (const id of PLAYER_IDS) {
    const label = String(labels[id] || '').trim();
    if (label) cleaned[id] = label;
  }
  return cleaned;
}

function cleanedPlayerNumbers(numbers = state.playerNumbers) {
  const cleaned = {};
  for (const id of PLAYER_IDS) {
    if (/^[0-9]{1,2}$/.test(numbers[id] || '')) cleaned[id] = numbers[id];
  }
  return cleaned;
}

function currentPositionPayload(round = true) {
  return state.rotations.map(rot => POSITION_ZONES.map(zone => {
    const p = rot.positions[zone];
    if (!p) return null;
    return round ? [roundCoord(p.x), roundCoord(p.y)] : [p.x, p.y];
  }));
}

// The same fields, in the same order, as the native app's link JSON.
function statePayload(round) {
  const payload = {
    v: SHARE_VERSION,
    system: state.system,
    passerCount: state.passerCount,
    passers: [...state.passers],
    labels: cleanedPlayerLabels(),
    display: {
      hints: state.showHints,
      backrowMAsL: state.showBackrowMAsL,
      spotNumbers: state.showSpotNumbers
    },
    positions: currentPositionPayload(round)
  };
  const numbers = cleanedPlayerNumbers();
  if (Object.keys(numbers).length) payload.numbers = numbers;
  const rotationKeys = Object.keys(state.rotationPassers).sort();
  if (rotationKeys.length) {
    payload.rotationPassers = Object.fromEntries(rotationKeys.map(k => [k, [...state.rotationPassers[k]]]));
  }
  if (state.setupStyle) payload.setupStyle = state.setupStyle;
  const styleKeys = Object.keys(state.rotationSetupStyles).sort();
  if (styleKeys.length) {
    payload.rotationSetupStyles = Object.fromEntries(styleKeys.map(k => [k, state.rotationSetupStyles[k]]));
  }
  return payload;
}

function buildSharePayload() {
  return statePayload(true);
}

// Unrounded, so undo puts players back exactly where they were.
function stateSnapshot() {
  return statePayload(false);
}

function payloadJSON(payload) {
  return JSON.stringify(roundedPayload(payload));
}

function roundedPayload(payload) {
  return {
    ...payload,
    positions: payload.positions.map(rotation => rotation.map(p => (p ? [roundCoord(p[0]), roundCoord(p[1])] : null)))
  };
}

function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeSharePayload(encoded) {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function shareHash() {
  return SHARE_HASH_PREFIX + encodeSharePayload(buildSharePayload());
}

function currentShareHref() {
  const url = new URL(window.location.href);
  url.hash = shareHash();
  return url.href;
}

// Links arrive pasted, edited by hand or truncated in transit, so nothing in one
// is trusted. Returns null when the payload can't describe a formation.
function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.system !== '5-1' && raw.system !== '6-2') return null;
  const system = raw.system;
  const valid = new Set(availablePassers(system));
  const selection = list => {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter(id => valid.has(id) && !seen.has(id) && seen.add(id)).slice(0, 6);
  };

  const passers = selection(raw.passers);
  const rotationPassers = {};
  for (const [key, value] of Object.entries(raw.rotationPassers || {})) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < 6 && Array.isArray(value)) {
      rotationPassers[index] = selection(value);
    }
  }
  const rotationSetupStyles = {};
  for (const [key, value] of Object.entries(raw.rotationSetupStyles || {})) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < 6 && SETUP_STYLES.includes(value)) {
      rotationSetupStyles[index] = value;
    }
  }

  const labels = {};
  for (const [id, value] of Object.entries(raw.labels || {})) {
    if (!SR.ROLES[id] || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) labels[id] = rosterName(trimmed);
  }
  const numbers = {};
  for (const [id, value] of Object.entries(raw.numbers || {})) {
    if (!SR.ROLES[id] || typeof value !== 'string') continue;
    const number = normalizedNumber(value);
    if (number) numbers[id] = number;
  }

  const rawCount = Number.isInteger(raw.passerCount) ? raw.passerCount : passers.length;
  const display = raw.display && typeof raw.display === 'object' ? raw.display : {};
  const positions = (Array.isArray(raw.positions) ? raw.positions : []).slice(0, 6).map(rotation => {
    const zones = (Array.isArray(rotation) ? rotation : []).slice(0, 6).map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      const [x, y] = pair.map(Number);
      if (typeof pair[0] !== 'number' || typeof pair[1] !== 'number') return null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [Math.min(Math.max(x, 0), SR.COURT_W), Math.min(Math.max(y, 0), SR.COURT_D)];
    });
    while (zones.length < 6) zones.push(null);
    return zones;
  });

  const payload = {
    v: SHARE_VERSION,
    system,
    passerCount: Math.min(5, Math.max(2, rawCount)),
    passers,
    labels,
    display: {
      hints: display.hints !== false,
      backrowMAsL: display.backrowMAsL !== false,
      spotNumbers: display.spotNumbers === true
    },
    positions
  };
  if (Object.keys(numbers).length) payload.numbers = numbers;
  if (Object.keys(rotationPassers).length) payload.rotationPassers = rotationPassers;
  if (SETUP_STYLES.includes(raw.setupStyle)) payload.setupStyle = raw.setupStyle;
  if (Object.keys(rotationSetupStyles).length) payload.rotationSetupStyles = rotationSetupStyles;
  return payload;
}

// Accepts a full link, a bare fragment, or just the sr= part.
function payloadFromText(text) {
  let fragment = String(text || '').trim();
  const hashIndex = fragment.indexOf('#');
  if (hashIndex >= 0) fragment = fragment.slice(hashIndex + 1);
  if (!fragment.startsWith(SHARE_HASH_PREFIX)) return null;
  try {
    return normalizePayload(decodeSharePayload(fragment.slice(SHARE_HASH_PREFIX.length)));
  } catch (_) {
    return null;
  }
}

function hasShareHash(text) {
  const hashIndex = String(text || '').indexOf('#');
  return hashIndex >= 0 && String(text).slice(hashIndex + 1).startsWith(SHARE_HASH_PREFIX);
}

// Reads the address bar's link into the state's fields. The page opens links
// through stageImport instead; codec tests adopt links through this entry point.
function loadSharedStateFromUrl() {
  const hash = window.location.hash || '';
  if (!hasShareHash(hash)) return { loaded: false, positions: null };
  const payload = payloadFromText(hash);
  if (!payload) return { loaded: false, positions: null, invalid: true };
  adoptPayloadFields(payload);
  return { loaded: true, positions: payload.positions, payload };
}

function adoptPayloadFields(payload) {
  state.system = payload.system;
  state.passerCount = payload.passerCount;
  state.passers = new Set(payload.passers.filter(id => availablePassers(payload.system).includes(id)));
  state.rotationPassers = Object.fromEntries(Object.entries(payload.rotationPassers || {}).map(([k, v]) => [k, [...v]]));
  state.setupStyle = payload.setupStyle || null;
  state.rotationSetupStyles = { ...(payload.rotationSetupStyles || {}) };
  state.playerLabels = { ...payload.labels };
  state.playerNumbers = { ...(payload.numbers || {}) };
  state.showHints = payload.display.hints;
  state.showBackrowMAsL = payload.display.backrowMAsL;
  state.showSpotNumbers = payload.display.spotNumbers;
}

// Overlays hand-placed positions carried by a link or a saved setup.
function applySharedPositions(positionPayload) {
  if (!Array.isArray(positionPayload)) return;
  for (let i = 0; i < state.rotations.length; i++) {
    const rotationPositions = positionPayload[i];
    if (!Array.isArray(rotationPositions)) continue;
    const positions = state.rotations[i].positions;
    POSITION_ZONES.forEach((zone, idx) => {
      const pair = rotationPositions[idx];
      if (!Array.isArray(pair) || pair.length !== 2) return;
      const x = Number(pair[0]);
      const y = Number(pair[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      positions[zone] = { x, y };
    });
    // Three-decimal rounding can collapse a legal gap onto a tie.
    SR.separateTies(positions);
  }
}

function applyState(payload) {
  adoptPayloadFields(payload);
  state.rotations = buildRotations();
  applySharedPositions(payload.positions);
}

// ---- Rotations ----

function availablePassers(system = state.system) {
  return system === '5-1'
    ? ['S', 'O1', 'O2', 'M1', 'M2', 'OP', 'L']
    : ['S1', 'S2', 'O1', 'O2', 'M1', 'M2', 'L'];
}

function defaultPassers(system, count) {
  const n = Math.min(5, Math.max(2, count));
  if (system === '5-1' && n === 5) return ['L', 'O1', 'O2', 'OP', 'M1', 'M2'];
  return passerPriority(system).slice(0, n);
}

function passerPriority(system = state.system) {
  return system === '5-1'
    ? ['L', 'O1', 'O2', 'OP', 'M1', 'M2', 'S']
    : ['L', 'O1', 'O2', 'M1', 'M2', 'S1', 'S2'];
}

function passersFor(index) {
  return state.rotationPassers[index] ? [...state.rotationPassers[index]] : [...state.passers];
}

function passerSetFor(index) {
  return new Set(passersFor(index));
}

function setupStyleFor(index) {
  return state.rotationSetupStyles[index] || state.setupStyle || undefined;
}

function buildRotationAt(index, passers = passerSetFor(index), style = setupStyleFor(index)) {
  return SR.buildRotation(state.system, index, passers, {
    showBackrowMAsL: state.showBackrowMAsL,
    setupStyle: style
  });
}

function buildRotations() {
  return [0, 1, 2, 3, 4, 5].map(index => buildRotationAt(index));
}

function occupantAt(rotation, zone) {
  return SR.occupantInfo(rotation.lineupL[zone]);
}

function isRotationLegal(index) {
  const rotation = state.rotations[index];
  return !rotation || SR.validateOverlap(rotation.positions).length === 0;
}

function rotationsNeedingAttention() {
  return state.rotations.map((_, i) => i).filter(i => !isRotationLegal(i));
}

// The first player breaking an overlap rule in this rotation, if any.
function problemZone(index) {
  const rotation = state.rotations[index];
  if (!rotation) return null;
  return POSITION_ZONES.find(zone => SR.constraintsFor(zone, rotation.positions).some(c => !c.satisfied)) || null;
}

// ---- Receivers ----

// The receivers actually on this court, using L even when its chip shows a middle.
function availablePassersIn(index) {
  const rotation = state.rotations[index];
  if (!rotation) return [];
  const onCourt = new Set(SR.onCourtIds(rotation.lineupL));
  return availablePassers().filter(id => onCourt.has(id));
}

// One choice per on-court player. A covered middle is never a second libero choice.
function passerOptions(index, includeSetter = true) {
  const rotation = state.rotations[index];
  if (!rotation) return [];
  const liberoSlot = POSITION_ZONES.map(z => occupantAt(rotation, z)).find(occ => occ.liberoSlot);
  const liberoLabel = liberoSlot ? liberoSlot.id : 'L';
  const selected = passerSetFor(index);
  return availablePassersIn(index)
    .filter(id => includeSetter || state.system !== '5-1' || id !== 'S' || selected.has(id))
    .map(id => ({ id, displayId: id === 'L' ? liberoLabel : id }));
}

function onCourtPasserCount(index) {
  const rotation = state.rotations[index];
  if (!rotation) return 0;
  const selected = passerSetFor(index);
  return POSITION_ZONES.filter(zone => SR.isSelectedPasser(occupantAt(rotation, zone), selected)).length;
}

function receiversPerRotation() {
  return state.rotations.map((_, i) => onCourtPasserCount(i));
}

function receiverCountsSummary() {
  return receiversPerRotation().map((count, i) => `R${i + 1}: ${count}`).join(' · ');
}

function rotationNames(indices) {
  const names = [...indices].sort((a, b) => a - b).map(i => `R${i + 1}`);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

// Chosen middles who are off court because the libero came in for them.
function selectedButCovered(index) {
  const rotation = state.rotations[index];
  if (!rotation) return [];
  const selected = passerSetFor(index);
  return POSITION_ZONES.map(zone => occupantAt(rotation, zone))
    .filter(occ => occ.liberoSlot)
    .map(occ => occ.replacedRole || occ.id)
    .filter(middle => middle !== 'L' && selected.has(middle));
}

// One statement about who receives, written for the rotation on screen.
function receivingSummary(index) {
  const counts = receiversPerRotation();
  if (index < 0 || index >= counts.length) return { here: 0, count: '', detail: null, tone: 'plain' };
  const here = counts[index];
  const count = `${here} receiving`;

  const short = counts.map((c, i) => i).filter(i => counts[i] < 2);
  if (short.length) {
    const detail = short.length === 1 && short[0] === index
      ? 'Fewer than two can receive here'
      : `Fewer than two can receive in ${rotationNames(short)}`;
    return { here, count, detail, tone: 'problem' };
  }

  const differing = counts.map((c, i) => i).filter(i => counts[i] !== here);
  if (differing.length) {
    const others = new Set(differing.map(i => counts[i]));
    const detail = others.size === 1
      ? `${[...others][0]} in ${rotationNames(differing)}`
      : `Differs in ${rotationNames(differing)}`;
    return { here, count, detail, tone: 'caution' };
  }

  const covered = selectedButCovered(index);
  if (here !== passersFor(index).length && covered.length) {
    const names = covered.map(id => label(id));
    const detail = names.length === 1
      ? `${names[0]} is covered by the libero`
      : `${names.join(' and ')} are covered by the libero`;
    return { here, count, detail, tone: 'caution' };
  }
  return { here, count, detail: null, tone: 'plain' };
}

// ---- Names ----

function hasCustomLabel(id) {
  return Boolean(String(state.playerLabels[id] || '').trim());
}

function label(id) {
  const custom = String(state.playerLabels[id] || '').trim().toUpperCase();
  if (custom) return custom;
  return state.playerNumbers[id] ? `#${state.playerNumbers[id]}` : SR.ROLES[id].label;
}

function rosterLabel(id) {
  const name = label(id);
  const number = state.playerNumbers[id];
  return number && hasCustomLabel(id) ? `${name} · #${number}` : name;
}

function setPlayerLabel(id, value) {
  const next = rosterName(value);
  if ((state.playerLabels[id] || '') === next) return;
  if (next) state.playerLabels[id] = next;
  else delete state.playerLabels[id];
  bumpShare();
}

function setPlayerNumber(id, value) {
  const next = normalizedNumber(value);
  if ((state.playerNumbers[id] || '') === next) return;
  if (next) state.playerNumbers[id] = next;
  else delete state.playerNumbers[id];
  bumpShare();
}

// ---- Display ----

function setShowHints(value) {
  state.showHints = Boolean(value);
  bumpShare();
}

function setShowSpotNumbers(value) {
  state.showSpotNumbers = Boolean(value);
  bumpShare();
}

// Purely a display change: refresh the drawn names, keep every position.
function setShowBackrowMAsL(value) {
  if (state.showBackrowMAsL === Boolean(value)) return;
  state.showBackrowMAsL = Boolean(value);
  state.rotations = state.rotations.map((rotation, index) => {
    const fresh = buildRotationAt(index);
    fresh.positions = rotation.positions;
    return fresh;
  });
  bumpShare();
}

// ---- Placement ----

function clonePositions(positions) {
  const clone = {};
  for (const zone of POSITION_ZONES) {
    if (positions[zone]) clone[zone] = { x: positions[zone].x, y: positions[zone].y };
  }
  return clone;
}

function isHandPlaced(p, auto) {
  return Math.abs(p.x - auto.x) > PLACEMENT_EPSILON || Math.abs(p.y - auto.y) > PLACEMENT_EPSILON;
}

// Zones the coach has moved, per rotation, against auto-placement for these receivers.
function handPlacedZones(sharedPassers = new Set(state.passers)) {
  const result = {};
  state.rotations.forEach((rotation, index) => {
    const passers = state.rotationPassers[index] ? new Set(state.rotationPassers[index]) : sharedPassers;
    const auto = buildRotationAt(index, passers);
    const moved = new Set(POSITION_ZONES.filter(zone => rotation.positions[zone] && auto.positions[zone]
      && isHandPlaced(rotation.positions[zone], auto.positions[zone])));
    if (moved.size) result[index] = moved;
  });
  return result;
}

function handPlacedCount() {
  return Object.values(handPlacedZones()).reduce((sum, zones) => sum + zones.size, 0);
}

function passerZonesIn(index) {
  const rotation = state.rotations[index];
  const selected = passerSetFor(index);
  return new Set(POSITION_ZONES.filter(zone => SR.isSelectedPasser(occupantAt(rotation, zone), selected)));
}

// Dragging a passer holds their lane and lets everyone else resolve around them;
// dragging anyone else keeps the receive formation intact.
function setPosition(index, zone, point) {
  const rotation = state.rotations[index];
  if (!rotation) return;
  const positions = clonePositions(rotation.positions);
  const bounds = SR.draggableBounds(zone);
  positions[zone] = {
    x: Math.min(Math.max(point.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(point.y, bounds.minY), bounds.maxY)
  };
  const passerZones = passerZonesIn(index);
  SR.enforceOverlap(positions, passerZones.has(zone) ? new Set([zone]) : passerZones);
  rotation.positions = positions;
}

// Moves a player by a fixed step, for keyboards and assistive technology.
function nudgePlayer(index, zone, dx, dy) {
  const rotation = state.rotations[index];
  if (!rotation || !rotation.positions[zone]) return;
  const current = rotation.positions[zone];
  pushUndo(`Move ${label(occupantAt(rotation, zone).id)}`, stateSnapshot(), { rotation: index });
  setPosition(index, zone, { x: current.x + dx * 0.25, y: current.y + dy * 0.25 });
  bumpShare();
}

function commitDrag(index, zone, snapshot) {
  const rotation = state.rotations[index];
  pushUndo(`Move ${label(occupantAt(rotation, zone).id)}`, snapshot, { rotation: index });
  bumpShare();
}

// ---- Edits ----

function setSystem(system) {
  if (system === state.system || (system !== '5-1' && system !== '6-2')) return;
  pushUndo('System');
  state.system = system;
  const valid = new Set(availablePassers(system));
  const filtered = [...state.passers].filter(id => valid.has(id));
  state.passers = new Set(filtered.length === state.passerCount || state.passers.size < 2
    ? filtered
    : defaultPassers(system, state.passerCount));
  for (const key of Object.keys(state.rotationPassers)) {
    state.rotationPassers[key] = state.rotationPassers[key].filter(id => valid.has(id));
  }
  state.rotations = buildRotations();
  noteRearrangement(`Switched to ${system} · all six rearranged`);
  bumpShare();
}

function canTogglePasser(id, index) {
  if (!state.rotations[index]) return false;
  return passersFor(index).includes(id)
    || (availablePassersIn(index).includes(id) && onCourtPasserCount(index) < 6);
}

// Receiver edits on a court change only that rotation.
function togglePasser(id, index) {
  if (!canTogglePasser(id, index)) return;
  let selection = passersFor(index);
  if (selection.includes(id)) {
    selection = selection.filter(p => p !== id);
  } else {
    // Older shared selections can include a covered middle; drop off-court entries.
    const eligible = availablePassersIn(index);
    selection = selection.filter(p => eligible.includes(p));
    selection.push(id);
  }
  setPassersInRotation(selection, index);
}

// Count presets keep the coach's choices and fill from the libero/outside-first order.
function setPasserCount(count, index) {
  if (!state.rotations[index]) return;
  const n = Math.min(6, Math.max(0, count));
  if (onCourtPasserCount(index) === n) return;
  const eligible = availablePassersIn(index);
  const current = passersFor(index).filter(id => eligible.includes(id));
  const additions = passerPriority().filter(id => eligible.includes(id) && !current.includes(id));
  setPassersInRotation([...current, ...additions].slice(0, n), index);
}

function setPassersInRotation(selection, index) {
  const existing = passersFor(index);
  if (selection.length === existing.length && selection.every((id, i) => id === existing[i])) return;
  pushUndo('Passers', stateSnapshot(), { rotation: index, restoresPassers: true });
  // Hand-placed players stay exactly where they are; everyone else re-places around them.
  const manual = handPlacedZones()[index] || new Set();
  state.rotationPassers[index] = selection;
  const fresh = buildRotationAt(index, new Set(selection));
  for (const zone of manual) fresh.positions[zone] = { ...state.rotations[index].positions[zone] };
  SR.enforceOverlap(fresh.positions, manual);
  state.rotations[index] = fresh;
  noteRearrangement(`Receivers updated in R${index + 1}`);
  bumpShare();
}

function arrangeRotation(index, style, undoLabel) {
  if (!state.rotations[index]) return;
  pushUndo(undoLabel, stateSnapshot(), { rotation: index, restoresSetupStyle: true });
  state.rotationSetupStyles[index] = style;
  state.rotations[index] = buildRotationAt(index, passerSetFor(index), style);
  noteRearrangement(style === 'smart' ? `Smart arranged R${index + 1}` : `Reset R${index + 1} to court positions`);
  bumpShare();
}

function resetCourt(index) {
  arrangeRotation(index, 'courtPosition', 'Reset rotation');
}

function smartArrange(index) {
  arrangeRotation(index, 'smart', 'Smart Arrange');
}

// Puts the suggested formation back for one court, keeping its placement style.
function autoArrange(index) {
  if (!state.rotations[index]) return;
  pushUndo('Reset rotation', stateSnapshot(), { rotation: index });
  state.rotations[index].positions = buildRotationAt(index).positions;
  bumpShare();
}

function autoArrangeAll() {
  pushUndo('Reset');
  state.rotations = buildRotations();
  noteRearrangement('All six rotations reset');
  bumpShare();
}

// ---- Undo ----

const undoStack = [];
// A change that rearranged courts the coach may not be looking at.
let lastRearrangement = null;
let lastUndo = null;

function canUndo() {
  return undoStack.length > 0;
}

function undoActionLabel() {
  const entry = undoStack[undoStack.length - 1];
  if (!entry) return 'Undo';
  return `Undo ${entry.label}${entry.rotation !== null ? ` in R${entry.rotation + 1}` : ''}`;
}

function pushUndo(undoLabel, snapshot = stateSnapshot(), opts = {}) {
  lastUndo = null;
  undoStack.push({
    id: uid(),
    label: undoLabel,
    state: snapshot,
    rotation: Number.isInteger(opts.rotation) ? opts.rotation : null,
    replacesWholeSetup: Boolean(opts.replacesWholeSetup),
    restoresPassers: Boolean(opts.restoresPassers),
    restoresSetupStyle: Boolean(opts.restoresSetupStyle)
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  invalidateRearrangementIfStale();
}

function noteRearrangement(what) {
  const top = undoStack[undoStack.length - 1];
  lastRearrangement = { id: uid(), what, undoId: top ? top.id : null };
}

function canUndoRearrangement() {
  const top = undoStack[undoStack.length - 1];
  return Boolean(lastRearrangement && top && lastRearrangement.undoId === top.id);
}

function invalidateRearrangementIfStale() {
  const top = undoStack[undoStack.length - 1];
  if (lastRearrangement && lastRearrangement.undoId !== (top ? top.id : null)) lastRearrangement = null;
}

function clearRearrangement() {
  lastRearrangement = null;
  notifyStateChange();
}

function clearUndoNotice() {
  lastUndo = null;
  notifyStateChange();
}

function forgetHistory() {
  undoStack.length = 0;
  lastRearrangement = null;
  lastUndo = null;
}

function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  const r = entry.rotation;
  if (r !== null && state.rotations[r] && Array.isArray(entry.state.positions[r])) {
    // Scoped: put back only the court this edit touched.
    if (entry.restoresPassers) {
      const saved = (entry.state.rotationPassers || {})[r];
      if (saved) state.rotationPassers[r] = [...saved];
      else delete state.rotationPassers[r];
      state.rotations[r] = buildRotationAt(r);
    }
    if (entry.restoresSetupStyle) {
      const saved = (entry.state.rotationSetupStyles || {})[r];
      if (saved) state.rotationSetupStyles[r] = saved;
      else delete state.rotationSetupStyles[r];
    }
    POSITION_ZONES.forEach((zone, i) => {
      const p = entry.state.positions[r][i];
      if (p) state.rotations[r].positions[zone] = { x: p[0], y: p[1] };
    });
  } else if (entry.replacesWholeSetup) {
    applyState(entry.state);
  } else {
    // A formation change never edited the roster or view preferences.
    const current = stateSnapshot();
    applyState({ ...entry.state, labels: current.labels, numbers: current.numbers, display: current.display });
  }
  invalidateRearrangementIfStale();

  const actions = {
    'Passers': 'Undid receiver change',
    'System': 'Undid system change',
    'Reset rotation': 'Restored positions',
    'Smart Arrange': 'Undid Smart Arrange',
    'Reset': 'Restored positions in all six rotations'
  };
  const action = entry.label.startsWith('Move ')
    ? `Undid moving ${entry.label.slice(5)}`
    : actions[entry.label] || `Undid ${entry.label}`;
  const notice = { id: uid(), text: action + (r !== null ? ` in R${r + 1}` : ''), rotation: r };
  bumpShare();
  lastUndo = notice;
  notifyStateChange();
}

// ---- Saved setups ----

let library = { setups: [], currentID: null };
// null | 'unreadableLibrary' | 'saveFailed'
let persistenceIssue = null;
let persistenceEnabled = false;
let unreadableLibraryText = null;
// A shared link on screen before the coach decides whether to keep it.
let pendingImport = null;

function storage() {
  try {
    return window.localStorage || null;
  } catch (_) {
    return null;
  }
}

function currentSetup() {
  return library.setups.find(s => s.id === library.currentID) || library.setups[0] || null;
}

function currentSetupName() {
  const setup = currentSetup();
  return setup ? setup.name : 'My formation';
}

function setupPayload(setup) {
  try {
    return normalizePayload(JSON.parse(setup.json));
  } catch (_) {
    return null;
  }
}

// Only an absent library is a first visit. Unreadable saved work is never replaced.
function readLibrary() {
  const store = storage();
  if (!store) return { library: null };
  let text;
  try {
    text = store.getItem(LIBRARY_KEY);
  } catch (_) {
    return { library: null };
  }
  if (text === null) return { library: null };
  try {
    const parsed = JSON.parse(text);
    const setups = Array.isArray(parsed.setups) ? parsed.setups : [];
    const ids = new Set(setups.map(s => s && s.id));
    const valid = setups.length > 0 && ids.size === setups.length && setups.every(s => s
      && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.json === 'string'
      && setupPayload(s));
    if (!valid) return { unreadable: true, text };
    return { library: { setups, currentID: typeof parsed.currentID === 'string' ? parsed.currentID : setups[0].id } };
  } catch (_) {
    return { unreadable: true, text };
  }
}

function saveLibrary() {
  if (!persistenceEnabled || persistenceIssue === 'unreadableLibrary') return;
  try {
    const store = storage();
    if (!store) throw new Error('Storage unavailable');
    store.setItem(LIBRARY_KEY, JSON.stringify({ version: 1, currentID: library.currentID, setups: library.setups }));
    persistenceIssue = null;
  } catch (_) {
    persistenceIssue = 'saveFailed';
  }
}

// Every change is written into the setup that is open, straight away.
function persist() {
  if (!persistenceEnabled || persistenceIssue === 'unreadableLibrary' || pendingImport) return;
  const setup = currentSetup();
  if (!setup) return;
  const json = payloadJSON(buildSharePayload());
  if (setup.json !== json) {
    setup.json = json;
    setup.modified = new Date().toISOString();
  }
  saveLibrary();
}

function bumpShare() {
  persist();
  notifyStateChange();
}

function retryPersistence() {
  if (persistenceIssue === 'unreadableLibrary') {
    const read = readLibrary();
    if (read.library) {
      library = read.library;
      persistenceIssue = null;
      persistenceEnabled = true;
      unreadableLibraryText = null;
      applyState(setupPayload(currentSetup()));
      forgetHistory();
    }
  } else {
    persist();
  }
  notifyStateChange();
}

// Every setup, including edits that couldn't be saved. During recovery, the
// original text exactly as it was stored.
function backupText() {
  if (persistenceIssue === 'unreadableLibrary' && unreadableLibraryText !== null) return unreadableLibraryText;
  return JSON.stringify({ version: 1, currentID: library.currentID, setups: library.setups }, null, 2);
}

function uniqueSetupName(wanted, excludingID = null) {
  const base = String(wanted || '').trim() || 'Untitled';
  const others = library.setups.filter(s => s.id !== excludingID);
  if (!others.some(s => s.name === base)) return base;
  let n = 2;
  while (others.some(s => s.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function addSetup(name, json) {
  const setup = { id: uid(), name: uniqueSetupName(name), json, modified: new Date().toISOString() };
  library.setups.push(setup);
  library.currentID = setup.id;
  return setup;
}

function startApp() {
  const read = readLibrary();
  if (read.unreadable) {
    persistenceIssue = 'unreadableLibrary';
    unreadableLibraryText = read.text;
    state.rotations = buildRotations();
    return;
  }
  persistenceEnabled = true;
  if (read.library) {
    library = read.library;
    applyState(setupPayload(currentSetup()));
  } else {
    state.rotations = buildRotations();
    addSetup('My formation', payloadJSON(buildSharePayload()));
    saveLibrary();
  }
}

function switchToSetup(id) {
  const target = library.setups.find(s => s.id === id);
  if (!target || target.id === (currentSetup() || {}).id) return;
  persist();
  library.currentID = id;
  saveLibrary();
  applyState(setupPayload(target));
  forgetHistory();
  bumpShare();
}

function freshPayload(system, style) {
  return {
    v: SHARE_VERSION,
    system,
    passerCount: 3,
    passers: ['L', 'O1', 'O2'],
    labels: {},
    display: { hints: true, backrowMAsL: true, spotNumbers: false },
    positions: [0, 1, 2, 3, 4, 5].map(index => {
      const rotation = SR.buildRotation(system, index, new Set(['L', 'O1', 'O2']), { setupStyle: style });
      return POSITION_ZONES.map(zone => [rotation.positions[zone].x, rotation.positions[zone].y]);
    }),
    setupStyle: style
  };
}

function newSetup(name, system, style) {
  persist();
  const fresh = freshPayload(system, style);
  addSetup(String(name || '').trim() || 'New formation', payloadJSON(fresh));
  saveLibrary();
  applyState(fresh);
  forgetHistory();
  bumpShare();
}

// The copy opens straight away, so the next edit lands on it and the original is safe.
function duplicateCurrentSetup() {
  persist();
  const current = currentSetup();
  if (!current) return;
  addSetup(`${current.name} copy`, current.json);
  saveLibrary();
  forgetHistory();
  bumpShare();
}

function renameCurrentSetup(name) {
  const current = currentSetup();
  if (!current || !String(name || '').trim()) return;
  const resolved = uniqueSetupName(name, current.id);
  if (resolved === current.name) return;
  current.name = resolved;
  current.modified = new Date().toISOString();
  saveLibrary();
  notifyStateChange();
}

// Deleting never leaves the library empty.
function deleteCurrentSetup() {
  const current = currentSetup();
  if (!current || library.setups.length < 2) return;
  const index = library.setups.indexOf(current);
  library.setups.splice(index, 1);
  library.currentID = library.setups[Math.min(index, library.setups.length - 1)].id;
  saveLibrary();
  applyState(setupPayload(currentSetup()));
  forgetHistory();
  bumpShare();
}

// ---- Incoming links ----

function importName(payload) {
  const names = PLAYER_IDS.map(id => String(payload.labels[id] || '').trim()).filter(Boolean);
  if (!names.length) return 'Shared formation';
  return names.length > 1 ? `${names[0]} + ${names.length - 1} more` : names[0];
}

// Someone else's formation arrives as something to look at. It never lands on
// top of the setup in progress; saving it is the only way in.
function stageImport(payload) {
  if (persistenceIssue === 'unreadableLibrary') return false;
  persist();
  pendingImport = { payload, suggestedName: importName(payload) };
  applyState(payload);
  forgetHistory();
  notifyStateChange();
  return true;
}

function saveImportAsNewSetup(name) {
  if (!pendingImport) return;
  const { payload, suggestedName } = pendingImport;
  pendingImport = null;
  addSetup(String(name || '').trim() || suggestedName, payloadJSON(payload));
  saveLibrary();
  applyState(payload);
  forgetHistory();
  bumpShare();
}

function discardImport() {
  if (!pendingImport) return;
  pendingImport = null;
  const setup = currentSetup();
  if (setup) applyState(setupPayload(setup));
  forgetHistory();
  notifyStateChange();
}

// The page itself lives in ui.js, which loads after this file.
function init() {
  initPage();
}

document.addEventListener('DOMContentLoaded', init);
