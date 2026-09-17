// What each player disc says, and where its label sits.
//
// Widths are measured from real glyphs rather than counted: "MWM" is wider than
// "CHLOE". Type on a disc is a fixed fraction of its diameter, so a label measured
// once fits the same way on a phone, a desktop court and an exported sheet.

const CHIP_FONT = 'ui-rounded, "SF Pro Rounded", "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// Keep a fifth of the diameter clear either side of a label.
const CHIP_TEXT_BUDGET = 0.60;
const CHIP_TEXT_MIN_SCALE = 0.78;
// One or two characters get the larger size: a jersey number is the most readable thing on a disc.
const NUMBER_CHIP_FONT_FRACTION = 0.40;
const NAME_CHIP_FONT_FRACTION = 0.22;
const ROLE_CHIP_FONT_FRACTION = 0.20;
const MIN_CHIP_FONT_FRACTION = NAME_CHIP_FONT_FRACTION * CHIP_TEXT_MIN_SCALE;

const chipWidthCache = new Map();
let chipMeasureContext = null;

function nominalChipFontFraction(text) {
  return graphemes(text).length <= 2 ? NUMBER_CHIP_FONT_FRACTION : NAME_CHIP_FONT_FRACTION;
}

// A label's rendered width as a fraction of the disc's diameter, at its nominal size.
function chipTextWidth(text) {
  if (chipWidthCache.has(text)) return chipWidthCache.get(text);
  if (!chipMeasureContext) chipMeasureContext = document.createElement('canvas').getContext('2d');
  const reference = 100;
  chipMeasureContext.font = `600 ${reference * nominalChipFontFraction(text)}px ${CHIP_FONT}`;
  const width = chipMeasureContext.measureText(text).width / reference;
  chipWidthCache.set(text, width);
  return width;
}

// The fraction of the diameter a label is drawn at, once shrunk to fit its budget.
function chipFontFraction(text) {
  return nominalChipFontFraction(text) * Math.min(1, CHIP_TEXT_BUDGET / Math.max(chipTextWidth(text), 0.0001));
}

function isLegibleOnChip(text) {
  return Boolean(text) && chipFontFraction(text) >= MIN_CHIP_FONT_FRACTION;
}

// Short names leave the role line looking low; lift it, tapering to nothing as a
// name fills its width.
function roleLiftFraction(text) {
  if (/^[0-9]+$/.test(text)) return 0;
  if (graphemes(text).length <= 2) return 0.06;
  const spare = CHIP_TEXT_BUDGET - chipTextWidth(text.toUpperCase());
  return 0.025 * Math.min(1, Math.max(0, spare / (CHIP_TEXT_BUDGET * 0.25)));
}

let chipLabelCache = { key: null, labels: null };

// What each player shows on a disc, guaranteed distinct.
function courtLabels() {
  const key = JSON.stringify([state.playerLabels, state.playerNumbers]);
  if (chipLabelCache.key === key) return chipLabelCache.labels;
  const token = {};
  for (const id of PLAYER_IDS) {
    const custom = String(state.playerLabels[id] || '').trim().toUpperCase();
    const number = state.playerNumbers[id];
    if (number) {
      token[id] = number;
    } else if (custom && isLegibleOnChip(custom)) {
      token[id] = custom;
    } else if (custom && /^[0-9]+$/.test(custom)) {
      // A long number is still a number, and no one wears more than two digits.
      token[id] = custom.slice(0, 2);
    } else if (custom && graphemes(custom).length <= MAX_NAME_ENTRY_LENGTH) {
      token[id] = SR.ROLES[id].label;
      const letters = graphemes(custom);
      while (letters.length > 1) {
        letters.pop();
        const abbreviated = `${letters.join('')}…`;
        if (isLegibleOnChip(abbreviated)) {
          token[id] = abbreviated;
          break;
        }
      }
    } else {
      token[id] = SR.ROLES[id].label;
    }
  }

  // Two players can land on the same token. Whoever isn't already on their own
  // role code moves to it; role codes are distinct, so this settles.
  for (let pass = 0; pass < PLAYER_IDS.length; pass++) {
    const counts = {};
    for (const value of Object.values(token)) counts[value.toLowerCase()] = (counts[value.toLowerCase()] || 0) + 1;
    let moved = false;
    for (const id of PLAYER_IDS) {
      if (counts[token[id].toLowerCase()] > 1 && token[id] !== SR.ROLES[id].label) {
        token[id] = SR.ROLES[id].label;
        moved = true;
      }
    }
    if (!moved) break;
  }
  chipLabelCache = { key, labels: token };
  return token;
}

function courtLabel(id) {
  return courtLabels()[id] || SR.ROLES[id].label;
}

function hasTwoLineLabels(rotation) {
  const labels = courtLabels();
  return POSITION_ZONES.some(zone => {
    const occ = occupantAt(rotation, zone);
    return labels[occ.id] !== SR.ROLES[occ.id].label;
  });
}

// ---- Label layout ----

const LABEL_MIN_HORIZONTAL_GAP = SR.PLAYER_R * 2 * CHIP_TEXT_BUDGET;
const LABEL_MIN_VERTICAL_GAP = 0.34;
// How far a covered player's name slides toward the part of them still showing.
const LABEL_UNCOVER_DISTANCE = SR.PLAYER_R * 0.5;
// Overlap handling must not spend the padding reserved around the text.
const LABEL_MAX_OFFSET = SR.PLAYER_R * 0.10;

// Label nudges in court units, keyed by zone. `order` is the drawing order, back
// to front, so a half-hidden player's name moves onto the part still showing.
function labelOffsets(positions, order = POSITION_ZONES, twoLineLabels = false) {
  const minimumVerticalGap = twoLineLabels ? SR.PLAYER_R * 2 * 0.80 : LABEL_MIN_VERTICAL_GAP;
  const zones = POSITION_ZONES.filter(z => positions[z]);
  if (zones.length <= 1) return {};

  const nudges = {};
  const anchors = { ...positions };
  const touching = SR.PLAYER_R * 2;
  for (const zone of zones) {
    const here = positions[zone];
    const index = order.indexOf(zone);
    if (index < 0) continue;
    let vx = 0;
    let vy = 0;
    for (const other of order.slice(index + 1)) {
      const there = positions[other];
      if (!there) continue;
      const dx = here.x - there.x;
      const dy = here.y - there.y;
      const distance = Math.hypot(dx, dy);
      if (distance < touching && distance > 0.0001) {
        vx += dx / distance;
        vy += dy / distance;
      }
    }
    const length = Math.hypot(vx, vy);
    if (length <= 0.0001) continue;
    const nudge = { dx: vx / length * LABEL_UNCOVER_DISTANCE, dy: vy / length * LABEL_UNCOVER_DISTANCE };
    nudges[zone] = nudge;
    anchors[zone] = { x: here.x + nudge.dx, y: here.y + nudge.dy };
  }

  const collides = (a, b) => Math.abs(anchors[a].x - anchors[b].x) < LABEL_MIN_HORIZONTAL_GAP
    && Math.abs(anchors[a].y - anchors[b].y) < minimumVerticalGap;

  // Union-find over all pairs, so a cluster is never split by a player between two others.
  const parent = Object.fromEntries(zones.map(z => [z, z]));
  const find = z => {
    let root = z;
    while (parent[root] !== root) root = parent[root];
    let walk = z;
    while (parent[walk] !== root) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  zones.forEach((a, i) => {
    for (const b of zones.slice(i + 1)) {
      if (!collides(a, b)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
  });

  const groups = {};
  for (const z of zones) (groups[find(z)] = groups[find(z)] || []).push(z);
  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;
    const ordered = group.slice().sort((a, b) => (anchors[a].y - anchors[b].y) || (anchors[a].x - anchors[b].x) || (a - b));
    const spread = minimumVerticalGap * (ordered.length - 1);
    const capped = Math.min(spread, (twoLineLabels ? minimumVerticalGap : 0.44) * (ordered.length - 1));
    const step = capped / (ordered.length - 1);
    const centreY = ordered.reduce((sum, z) => sum + anchors[z].y, 0) / ordered.length;
    ordered.forEach((zone, i) => {
      const target = centreY - capped / 2 + step * i;
      nudges[zone] = nudges[zone] || { dx: 0, dy: 0 };
      nudges[zone].dy += target - anchors[zone].y;
    });
  }

  // Prefer a centred label over pushing text against its own circle's rim.
  for (const [zone, nudge] of Object.entries(nudges)) {
    const distance = Math.hypot(nudge.dx, nudge.dy);
    if (distance > LABEL_MAX_OFFSET) {
      const scale = LABEL_MAX_OFFSET / distance;
      nudges[zone] = { dx: nudge.dx * scale, dy: nudge.dy * scale };
    }
  }
  return nudges;
}
