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
function applyLibero(lineup) {
  const zoneToPlayer = { ...lineup };
  for (const z of [1, 5, 6]) {
    const pos = zoneToPlayer[z];
    if (pos === 'M1' || pos === 'M2') {
      // Track that L replaces this MB; we display L on court.
      zoneToPlayer[z] = `L:${pos}`; // L replacing MBx; we'll render label "L"
    }
  }
  return zoneToPlayer;
}

// Determine the "effective role" of a zone occupant.
// e.g. "L:M1" means libero in for M1.
function occupantInfo(occ) {
  if (occ.startsWith('L:')) {
    return { id: 'L', replacedRole: occ.slice(2), display: 'L' };
  }
  return { id: occ, replacedRole: null, display: occ };
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
    ids.push(occupantInfo(occ).id);
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

  // ----- Step 1: passers ~3/4 back (y=6.5), evenly distributed across width.
  const passerZones = [];
  for (const z of [1,2,3,4,5,6]) {
    if (passerSet.has(occByZone[z].id)) passerZones.push(z);
  }
  // Order passers left-to-right by their natural court column so the W-formation visually
  // matches who would naturally cover that area.
  const passerOrdered = passerZones.slice().sort((a, b) => {
    const colOrder = { L: 0, C: 1, R: 2 };
    const ga = ZONE_GEOM[a], gb = ZONE_GEOM[b];
    if (colOrder[ga.col] !== colOrder[gb.col]) return colOrder[ga.col] - colOrder[gb.col];
    // tie-break: front row passers tend to flank the formation (further out)
    return ga.row === 'F' ? -1 : 1;
  });

  const N = passerOrdered.length;
  const passLineY = 6.5;
  for (let i = 0; i < N; i++) {
    const z = passerOrdered[i];
    const x = ((i + 1) / (N + 1)) * COURT_W;
    // Stagger: front-row passers tucked slightly forward so column-pair overlap
    // (front-y < back-y) is satisfied when the same column has both a front and back passer.
    const dy = ZONE_GEOM[z].row === 'F' ? -0.6 : 0;
    positions[z] = { x, y: passLineY + dy };
  }

  // ----- Step 2: front-row players (non-passer, non-setter attackers, plus the front-row
  // setter if there is one). Each stands at their zone-default column at the net — they'll
  // run to their actual attack column AFTER the serve. Pre-serve they hold their zone.
  const setterZone = setter.setterZone;
  const isFrontSetter = ZONE_GEOM[setterZone].row === 'F';

  for (const z of [4, 3, 2]) {
    if (positions[z]) continue; // already a passer
    if (z === setterZone && isFrontSetter) {
      // 5-1 front-row setter — at net, biased right of center toward the set target
      if (z === 2)      positions[z] = { x: 6.5, y: 0.9 };
      else if (z === 3) positions[z] = { x: 5.5, y: 0.9 };
      else              positions[z] = { x: 3.0, y: 0.9 }; // z4
    } else {
      // Zone-default attack stance — column position at the net
      const col = ZONE_GEOM[z].col;
      const tx = col === 'L' ? 1.5 : col === 'C' ? 4.5 : 7.5;
      positions[z] = { x: tx, y: 1.2 };
    }
  }

  // ----- Step 3: back-row setter — first principles: as close to the net as overlap
  // allows, sitting just behind the column-adjacent front-row player (z1 behind z2,
  // z6 behind z3, z5 behind z4).
  //
  // Two cases for horizontal position:
  //   (a) The column-front player is an ATTACKER at the net: the setter sits at the
  //       same x, right behind them. They release a short distance to the set target.
  //   (b) The column-front player is a PASSER (peeled back to the receive line): the
  //       setter would otherwise be stuck at mid-back-court behind them. To keep the
  //       setter OUT of the middle of the court (so their route to the net target
  //       comes down a sideline), bias the setter toward the closer sideline.
  if (!isFrontSetter && !positions[setterZone]) {
    const colFront = setterZone === 1 ? 2 : setterZone === 6 ? 3 : 4;
    const refOcc = occByZone[colFront];
    const refIsPasser = passerSet.has(refOcc.id);
    const ref = positions[colFront];
    let tx;
    if (refIsPasser) {
      if (setterZone === 1)      tx = 7.5;       // back-right: hug the right sideline
      else if (setterZone === 5) tx = 1.5;       // back-left: hug the left sideline
      else                       tx = 7.0;       // z6: bias right toward z1 (overlap will relax)
    } else {
      tx = ref.x;
    }
    positions[setterZone] = { x: tx, y: ref.y + 0.5 };
  }

  // ----- Step 4: back-row non-passer, non-setter — tuck deep at their zone-column.
  for (const z of [5, 6, 1]) {
    if (positions[z]) continue;
    const col = ZONE_GEOM[z].col;
    const tx = col === 'L' ? 1.5 : col === 'C' ? 4.5 : 7.5;
    positions[z] = { x: tx, y: 7.8 };
  }

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
function buildRotation(system, rotationIdx, passerSet) {
  const lineup = lineupFor(system, rotationIdx);
  const setter = setterFor(system, lineup);
  const lineupL = applyLibero(lineup);
  const positions = autoPlace(lineupL, passerSet, system, setter);
  return { rotationIdx, lineup, lineupL, setter, positions };
}

window.SR = {
  ROLES, COURT_W, COURT_D, ATTACK_LINE, PLAYER_R,
  baseLineup, lineupFor, applyLibero, occupantInfo, setterFor,
  onCourtIds, autoPlace, enforceOverlap, validateOverlap,
  clampToCourt, buildRotation, ZONE_GEOM
};
