// Court is a 9 x 9 unit half-court (9m wide x 9m deep).
// y = 0 at net, y = 9 at endline. x = 0 at left sideline, x = 9 at right sideline.
// Attack line at y = 3.

const COURT_W = 9;
const COURT_D = 9;
const ATTACK_LINE = 3;
const PLAYER_R = 0.55; // visual radius in court units (used for clamp/separation)
const MIN_GAP = 0.35;  // minimum overlap-rule separation in court units

// Role definitions
const ROLES = {
  S:  { label: 'S',  cls: 'setter', tag: 'Setter' },
  S1: { label: 'S1', cls: 'setter', tag: 'Setter 1' },
  S2: { label: 'S2', cls: 'setter', tag: 'Setter 2' },
  O1: { label: 'O1', cls: 'oh',     tag: 'Outside 1' },
  O2: { label: 'O2', cls: 'oh',     tag: 'Outside 2' },
  M1: { label: 'M1', cls: 'mb',     tag: 'Middle 1' },
  M2: { label: 'M2', cls: 'mb',     tag: 'Middle 2' },
  OP: { label: 'OP', cls: 'op',     tag: 'Opposite' },
  L:  { label: 'L',  cls: 'lib',    tag: 'Libero' }
};

// Base rotation 1 lineup (zone -> position id)
// Opposites are 3 zones apart in the rotation cycle.
// Cycle order around the court: 1 -> 6 -> 5 -> 4 -> 3 -> 2 -> 1.
function baseLineup(system) {
  // R1: zones 1..6 going [z1, z2, z3, z4, z5, z6]
  if (system === '5-1') {
    // S in z1, then alternating role types: OH, MB, OP, OH, MB
    return { 1: 'S',  2: 'O1', 3: 'M1', 4: 'OP', 5: 'O2', 6: 'M2' };
  } else {
    return { 1: 'S1', 2: 'O1', 3: 'M1', 4: 'S2', 5: 'O2', 6: 'M2' };
  }
}

// Rotate lineup by N rotations. After R1 the player in z2 is now in z1, etc.
// Cycle: z2 -> z1 -> z6 -> z5 -> z4 -> z3 -> z2
function rotateLineup(base, rotations) {
  const cycle = [2, 1, 6, 5, 4, 3]; // each index moves to the next
  let lineup = { ...base };
  for (let r = 0; r < rotations; r++) {
    const next = {};
    for (let i = 0; i < cycle.length; i++) {
      const fromZone = cycle[i];
      const toZone = cycle[(i + 1) % cycle.length];
      next[toZone] = lineup[fromZone];
    }
    lineup = next;
  }
  return lineup;
}

// Returns lineup for rotation index 0..5 (R1..R6)
function lineupFor(system, rotationIdx) {
  return rotateLineup(baseLineup(system), rotationIdx);
}

// Zone -> column ('L', 'C', 'R') and row ('F', 'B')
const ZONE_GEOM = {
  4: { col: 'L', row: 'F' },
  3: { col: 'C', row: 'F' },
  2: { col: 'R', row: 'F' },
  5: { col: 'L', row: 'B' },
  6: { col: 'C', row: 'B' },
  1: { col: 'R', row: 'B' }
};

// Apply libero swap: L replaces whichever MB is in back row.
// Returns { zoneToPlayer, players: [{id, zone, role, isLibero}] }
function applyLibero(lineup, showBackrowMAsL = true) {
  const zoneToPlayer = { ...lineup };
  for (const z of [1, 5, 6]) {
    const pos = zoneToPlayer[z];
    if (pos === 'M1' || pos === 'M2') {
      // Track the libero slot. When hidden, display the middle while keeping
      // L as an eligible passer for placement.
      zoneToPlayer[z] = showBackrowMAsL ? `L:${pos}` : `${pos}:L`;
    }
  }
  return zoneToPlayer;
}

// Determine the "effective role" of a zone occupant.
// e.g. "L:M1" means libero in for M1.
function occupantInfo(occ) {
  if (occ.startsWith('L:')) {
    return { id: 'L', replacedRole: occ.slice(2), display: 'L', liberoSlot: true };
  }
  if (occ.endsWith(':L')) {
    const id = occ.slice(0, -2);
    return { id, replacedRole: null, display: id, liberoSlot: true };
  }
  return { id: occ, replacedRole: null, display: occ, liberoSlot: false };
}

function isSelectedPasser(occ, passerSet) {
  return passerSet.has(occ.id) || (occ.liberoSlot && passerSet.has('L'));
}

// Determine setter info: who sets this rotation.
// In 5-1: the setter (S) always sets, regardless of front/back.
// In 6-2: backrow setter sets; frontrow setter hits.
function setterFor(system, lineup) {
  if (system === '5-1') {
    for (const [z, id] of Object.entries(lineup)) {
      if (id === 'S') return { setterId: 'S', setterZone: +z };
    }
  } else {
    // pick whichever S is in back row (zones 1,5,6)
    for (const z of [1, 5, 6]) {
      const id = lineup[z];
      if (id === 'S1' || id === 'S2') return { setterId: id, setterZone: z };
    }
  }
  return null;
}

// Get the set of position ids on court (post-libero swap), as their canonical id (L for libero).
function onCourtIds(zoneToPlayerWithLibero) {
  const ids = [];
  for (const occ of Object.values(zoneToPlayerWithLibero)) {
    const info = occupantInfo(occ);
    ids.push(info.liberoSlot ? 'L' : info.id);
  }
  return ids;
}

// ---- Auto-placement (first principles) ----
//
// Inputs: lineup post-libero, set of passer ids (canonical ids: includes 'L'), system, setter info
// Output: { [zone]: { x, y } } in court units

function autoPlace(zoneToPlayerWithLibero, passerSet, system, setter) {
  const occByZone = {};
  for (const [z, occ] of Object.entries(zoneToPlayerWithLibero)) {
    occByZone[+z] = occupantInfo(occ);
  }

  const positions = {};

  // ----- Step 1: passers ~3/4 back (y=6.5), distributed across width.
  const passerZones = [];
  for (const z of [1,2,3,4,5,6]) {
    if (isSelectedPasser(occByZone[z], passerSet)) passerZones.push(z);
  }
  const N = passerZones.length;
  const isFrontRowHitterPasser = (z) => {
    const id = occByZone[z].id;
    return N === 3 && ZONE_GEOM[z].row === 'F' && id !== 'L' && !id.startsWith('S');
  };
  // Order passers left-to-right. In three-passer receive, a front-row hitter
  // passer gets left-side priority so their release path stays hitter-friendly.
  // Otherwise, natural court column determines the visual receive lane.
  const passerOrdered = passerZones.slice().sort((a, b) => {
    const aFrontHitter = isFrontRowHitterPasser(a);
    const bFrontHitter = isFrontRowHitterPasser(b);
    if (aFrontHitter !== bFrontHitter) return aFrontHitter ? -1 : 1;

    const colOrder = { L: 0, C: 1, R: 2 };
    const ga = ZONE_GEOM[a], gb = ZONE_GEOM[b];
    if (colOrder[ga.col] !== colOrder[gb.col]) return colOrder[ga.col] - colOrder[gb.col];
    // tie-break: front row passers tend to flank the formation (further out)
    return ga.row === 'F' ? -1 : 1;
  });

  const passLineY = 6.5;
  const rowGap = MIN_GAP + 0.05;
  const frontRowHitterPasserZone = passerOrdered.find(isFrontRowHitterPasser) || null;
  const frontRowPasserOffset = rowGap;

  if (N === 5) {
    const frontSlots = [
      { x: COURT_W * 0.20, y: ATTACK_LINE },
      { x: COURT_W * 0.50, y: ATTACK_LINE },
      { x: COURT_W * 0.80, y: ATTACK_LINE }
    ];
    const backSlots = [
      { x: (frontSlots[0].x + frontSlots[1].x) / 2, y: passLineY },
      { x: (frontSlots[1].x + frontSlots[2].x) / 2, y: passLineY }
    ];
    const frontOrder = new Map([[4, 0], [3, 1], [2, 2]]);
    const backOrder = new Map([[5, 0], [6, 1], [1, 2]]);
    const frontPassers = passerZones
      .filter(z => ZONE_GEOM[z].row === 'F')
      .sort((a, b) => frontOrder.get(a) - frontOrder.get(b));
    const backPassers = passerZones
      .filter(z => ZONE_GEOM[z].row === 'B')
      .sort((a, b) => backOrder.get(a) - backOrder.get(b));
    const frontLineZones = frontPassers.slice();
    const promotedBackZones = [];

    while (frontLineZones.length < 3 && backPassers.length > promotedBackZones.length) {
      const z = backPassers[backPassers.length - promotedBackZones.length - 1];
      promotedBackZones.unshift(z);
      frontLineZones.push(z);
    }

    const promotedBackSet = new Set(promotedBackZones);
    const backLineZones = backPassers.filter(z => !promotedBackSet.has(z));

    frontLineZones.slice(0, 3).forEach((z, i) => {
      positions[z] = {
        x: frontSlots[i].x,
        y: ZONE_GEOM[z].row === 'F' ? frontSlots[i].y : frontSlots[i].y + rowGap
      };
    });
    backLineZones.slice(0, 2).forEach((z, i) => {
      positions[z] = { ...backSlots[i] };
    });
  } else {
    for (let i = 0; i < N; i++) {
      const z = passerOrdered[i];
      const x = ((i + 1) / (N + 1)) * COURT_W;
      // Keep passer lanes even; only nudge front-row passers forward enough
      // to preserve front/back overlap legality when needed.
      const dy = ZONE_GEOM[z].row === 'F' ? -frontRowPasserOffset : 0;
      positions[z] = { x, y: passLineY + dy };
    }
  }

  // ----- Step 2: front-row players. Passers keep their receive lanes. A front-row
  // setter starts at the front-center target, and adjacent front-row players adjust
  // around them as overlap rules require.
  const setterZone = setter.setterZone;
  const isFrontSetter = ZONE_GEOM[setterZone].row === 'F';
  const frontRowOrder = [4, 3, 2];
  const frontRowHitterPasserIdx = frontRowOrder.indexOf(frontRowHitterPasserZone);
  const frontRowHitterPasserX = frontRowHitterPasserZone
    ? positions[frontRowHitterPasserZone].x
    : null;

  function adjustFrontRowX(z, tx) {
    if (frontRowHitterPasserIdx === -1) return tx;
    const idx = frontRowOrder.indexOf(z);
    if (idx === -1 || idx === frontRowHitterPasserIdx) return tx;

    const spacing = 0.75;
    const requiredX = frontRowHitterPasserX + (idx - frontRowHitterPasserIdx) * spacing;
    return idx < frontRowHitterPasserIdx
      ? Math.min(tx, requiredX)
      : Math.max(tx, requiredX);
  }

  function isPriorityFixed(z) {
    return positions[z] && (isSelectedPasser(occByZone[z], passerSet) || z === setterZone);
  }

  function pushRoleRightInRow(rowOrder, roleId) {
    if ([...Object.values(occByZone)].some(occ => occ.id === roleId && isSelectedPasser(occ, passerSet))) return;

    const roleZone = rowOrder.find(z => positions[z] && occByZone[z].id === roleId);
    if (!roleZone) return;

    const roleIdx = rowOrder.indexOf(roleZone);
    const courtMinX = PLAYER_R + 0.05;
    const courtMaxX = COURT_W - PLAYER_R - 0.05;
    let minX = courtMinX + roleIdx * rowGap;
    let maxX = courtMaxX - (rowOrder.length - 1 - roleIdx) * rowGap;

    for (let i = 0; i < roleIdx; i++) {
      const z = rowOrder[i];
      if (isPriorityFixed(z)) {
        minX = Math.max(minX, positions[z].x + (roleIdx - i) * rowGap);
      }
    }
    for (let i = roleIdx + 1; i < rowOrder.length; i++) {
      const z = rowOrder[i];
      if (isPriorityFixed(z)) {
        maxX = Math.min(maxX, positions[z].x - (i - roleIdx) * rowGap);
      }
    }

    const roleX = maxX >= minX ? maxX : Math.max(courtMinX, Math.min(courtMaxX, maxX));
    positions[roleZone].x = roleX;

    for (let i = roleIdx + 1; i < rowOrder.length; i++) {
      const z = rowOrder[i];
      if (isPriorityFixed(z)) continue;
      positions[z].x = positions[rowOrder[i - 1]].x + rowGap;
    }
    for (let i = roleIdx - 1; i >= 0; i--) {
      const z = rowOrder[i];
      if (isPriorityFixed(z)) continue;
      positions[z].x = positions[rowOrder[i + 1]].x - rowGap;
    }
  }

  for (const z of [4, 3, 2]) {
    if (positions[z]) continue; // already a passer
    let tx, ty;
    if (z === setterZone && isFrontSetter) {
      tx = COURT_W / 2;
      ty = 0.9;
    } else {
      // Zone-default attack stance — column position at the net
      const col = ZONE_GEOM[z].col;
      tx = col === 'L' ? 1.5 : col === 'C' ? 4.5 : 7.5;
      ty = 1.2;
    }
    positions[z] = { x: adjustFrontRowX(z, tx), y: ty };
  }
  pushRoleRightInRow(frontRowOrder, 'OP');
  if (isFrontSetter && positions[setterZone]) {
    const setterIdx = frontRowOrder.indexOf(setterZone);
    let minX = PLAYER_R + 0.05;
    let maxX = COURT_W - PLAYER_R - 0.05;

    for (let i = 0; i < setterIdx; i++) {
      const z = frontRowOrder[i];
      if (positions[z]) minX = Math.max(minX, positions[z].x + (setterIdx - i) * rowGap);
    }
    for (let i = setterIdx + 1; i < frontRowOrder.length; i++) {
      const z = frontRowOrder[i];
      if (positions[z]) maxX = Math.min(maxX, positions[z].x - (i - setterIdx) * rowGap);
    }

    positions[setterZone].x = minX <= maxX
      ? Math.max(minX, Math.min(maxX, COURT_W / 2))
      : Math.max(PLAYER_R + 0.05, Math.min(COURT_W - PLAYER_R - 0.05, minX));
  }

  // ----- Step 3: back-row setter — get as close to front-center as overlap allows.
  // The y position is bounded by their adjacent front-row player. The x position is
  // bounded only by adjacent back-row players, so the setter can slide toward center.
  if (!isFrontSetter && !positions[setterZone]) {
    const colFront = setterZone === 1 ? 2 : setterZone === 6 ? 3 : 4;
    const ref = positions[colFront];
    const backRowOrder = [5, 6, 1];
    const idx = backRowOrder.indexOf(setterZone);
    let minX = PLAYER_R + 0.05;
    let maxX = COURT_W - PLAYER_R - 0.05;
    const leftNeighbor = backRowOrder[idx - 1];
    const rightNeighbor = backRowOrder[idx + 1];

    if (leftNeighbor && positions[leftNeighbor]) {
      minX = positions[leftNeighbor].x + rowGap;
    }
    if (rightNeighbor && positions[rightNeighbor]) {
      maxX = positions[rightNeighbor].x - rowGap;
    }

    if (N === 2 && setterZone === 1) {
      const rightmostPasserX = Math.max(...passerOrdered.map(z => positions[z].x));
      minX = Math.max(minX, rightmostPasserX + PLAYER_R * 2 + 0.15);
    }
    if (N >= 4 && setterZone === 1 && positions[colFront]) {
      minX = Math.max(minX, positions[colFront].x + rowGap);
    }

    const tx = minX <= maxX
      ? Math.max(minX, Math.min(maxX, COURT_W / 2))
      : COURT_W / 2;
    positions[setterZone] = { x: tx, y: ref.y + rowGap };
  }

  // ----- Step 4: back-row non-passer, non-setter — tuck deep at their zone-column.
  for (const z of [5, 6, 1]) {
    if (positions[z]) continue;
    const col = ZONE_GEOM[z].col;
    const tx = col === 'L' ? 1.5 : col === 'C' ? 4.5 : 7.5;
    positions[z] = { x: tx, y: 7.8 };
  }
  pushRoleRightInRow([5, 6, 1], 'OP');

  // ----- Step 5: enforce overlap, anchoring passers (so the receive formation stays
  // intact) and the front-row setter (5-1 only — they're already at the set target).
  const anchored = new Set(passerOrdered);
  if (isFrontSetter && system === '5-1') anchored.add(setterZone);
  enforceOverlap(positions, anchored);
  clampToCourt(positions);
  return positions;
}

// ---- Overlap rule enforcement ----
//
// Constraints:
// (1) Front-back column pairs: z4.y < z5.y, z3.y < z6.y, z2.y < z1.y.
// (2) Same-row left/middle/right ordering by x:
//       z4.x < z3.x < z2.x  (front row)
//       z5.x < z6.x < z1.x  (back row)
//
// "anchored" is a Set of zone numbers that should NOT move (their positions are fixed).
// When a constraint between an anchored zone and a non-anchored one is violated, only
// the non-anchored player moves. When both are anchored, the violation is left alone.

const COL_PAIRS = [[4,5], [3,6], [2,1]];   // [front, back]
const ROW_TRIOS = [[4,3,2], [5,6,1]];      // left, mid, right

function enforceOverlap(positions, anchored = null) {
  const fixed = anchored instanceof Set
    ? anchored
    : (anchored == null ? new Set() : new Set([anchored]));

  for (let iter = 0; iter < 80; iter++) {
    let changed = false;

    for (const [f, b] of COL_PAIRS) {
      if (!positions[f] || !positions[b]) continue;
      if (positions[f].y + MIN_GAP > positions[b].y) {
        const need = (positions[f].y + MIN_GAP) - positions[b].y;
        const fF = fixed.has(f), fB = fixed.has(b);
        if (fF && fB) continue;
        if (fF) positions[b].y += need;
        else if (fB) positions[f].y -= need;
        else { positions[f].y -= need / 2; positions[b].y += need / 2; }
        changed = true;
      }
    }

    for (const trio of ROW_TRIOS) {
      const [l, m, r] = trio;
      if (!positions[l] || !positions[m] || !positions[r]) continue;
      const fL = fixed.has(l), fM = fixed.has(m), fR = fixed.has(r);
      if (positions[l].x + MIN_GAP > positions[m].x) {
        const need = (positions[l].x + MIN_GAP) - positions[m].x;
        if (!(fL && fM)) {
          if (fL) positions[m].x += need;
          else if (fM) positions[l].x -= need;
          else { positions[l].x -= need/2; positions[m].x += need/2; }
          changed = true;
        }
      }
      if (positions[m].x + MIN_GAP > positions[r].x) {
        const need = (positions[m].x + MIN_GAP) - positions[r].x;
        if (!(fM && fR)) {
          if (fM) positions[r].x += need;
          else if (fR) positions[m].x -= need;
          else { positions[m].x -= need/2; positions[r].x += need/2; }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  clampToCourt(positions);
}

function clampToCourt(positions) {
  const pad = PLAYER_R + 0.05;
  for (const z of Object.keys(positions)) {
    const p = positions[z];
    p.x = Math.max(pad, Math.min(COURT_W - pad, p.x));
    p.y = Math.max(pad, Math.min(COURT_D - pad, p.y));
  }
}

// Validates current positions against overlap rules. Returns array of violation strings (empty = valid).
function validateOverlap(positions) {
  const errs = [];
  for (const [f, b] of COL_PAIRS) {
    if (positions[f] && positions[b] && positions[f].y >= positions[b].y) {
      errs.push(`z${f} not in front of z${b}`);
    }
  }
  for (const trio of ROW_TRIOS) {
    const [l, m, r] = trio;
    if (positions[l] && positions[m] && positions[l].x >= positions[m].x) errs.push(`z${l} not left of z${m}`);
    if (positions[m] && positions[r] && positions[m].x >= positions[r].x) errs.push(`z${m} not left of z${r}`);
  }
  return errs;
}

// Build full per-rotation data including setter info, occupants, positions.
function buildRotation(system, rotationIdx, passerSet, opts = {}) {
  const lineup = lineupFor(system, rotationIdx);
  const setter = setterFor(system, lineup);
  const lineupL = applyLibero(lineup, opts.showBackrowMAsL !== false);
  const positions = autoPlace(lineupL, passerSet, system, setter);
  return { rotationIdx, lineup, lineupL, setter, positions };
}

window.SR = {
  ROLES, COURT_W, COURT_D, ATTACK_LINE, PLAYER_R,
  baseLineup, lineupFor, applyLibero, occupantInfo, setterFor,
  isSelectedPasser, onCourtIds, autoPlace, enforceOverlap, validateOverlap,
  clampToCourt, buildRotation, ZONE_GEOM
};
