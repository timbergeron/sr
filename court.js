// Renders one court SVG and wires up dragging.

const NS = 'http://www.w3.org/2000/svg';
const VIEW_PAD = 0.6; // padding around court for net band, labels

function svg(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function renderCourtCard(container, rotationData, opts) {
  const card = document.createElement('div');
  card.className = 'court-card';

  const header = document.createElement('div');
  header.className = 'court-header';
  const title = document.createElement('div');
  title.className = 'court-title';
  title.textContent = `Rotation ${rotationData.rotationIdx + 1}`;
  const sub = document.createElement('div');
  sub.className = 'court-sub';
  const setterLabel = rotationData.setter ? rotationData.setter.setterId : '';
  sub.textContent = `Setter: ${setterLabel} (zone ${rotationData.setter.setterZone})`;
  header.appendChild(title);
  header.appendChild(sub);
  card.appendChild(header);

  const W = SR.COURT_W;
  const D = SR.COURT_D;

  const root = svg('svg', {
    class: 'court-svg',
    viewBox: `${-VIEW_PAD} ${-VIEW_PAD} ${W + VIEW_PAD * 2} ${D + VIEW_PAD * 2}`,
    preserveAspectRatio: 'xMidYMid meet'
  });
  // The court is square (9x9 half), so this renders square.
  card.appendChild(root);

  drawCourt(root);
  defineMarkers(root);

  // Hints layer (drawn under players)
  const hintsGroup = svg('g', { class: 'overlap-hints' }, root);
  const hintPairs = computeHintPairs(rotationData, opts.passerSet);
  const hintEls = [];
  for (const pair of hintPairs) {
    const line = svg('line', {
      class: 'overlap-hint',
      'marker-end': 'url(#sr-arrow)'
    }, hintsGroup);
    hintEls.push({ line, pair });
  }

  // Render players (zones 1..6)
  const playersGroup = svg('g', { class: 'players-group' }, root);
  const playerEls = {};
  for (const z of [1,2,3,4,5,6]) {
    const occ = SR.occupantInfo(rotationData.lineupL[z]);
    const pos = rotationData.positions[z];
    const g = renderPlayer(playersGroup, z, occ, pos, opts);
    playerEls[z] = g;
  }

  // Initial hint positioning
  updateHints(hintEls, rotationData.positions);

  // Drag interactions
  attachDrag(root, playerEls, rotationData, hintEls, opts);

  container.appendChild(card);
  return { card, root, playerEls };
}

function drawCourt(root) {
  const W = SR.COURT_W, D = SR.COURT_D;

  // Wooden floor stripes for visual texture
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) continue;
    svg('rect', {
      class: 'floor-stripe',
      x: 0, y: i * (D / 6), width: W, height: D / 6
    }, root);
  }

  // Outer court boundary
  svg('rect', {
    class: 'court-line',
    x: 0, y: 0, width: W, height: D
  }, root);

  // Attack line (10ft / 3m line)
  svg('line', {
    class: 'court-line',
    x1: 0, y1: SR.ATTACK_LINE, x2: W, y2: SR.ATTACK_LINE
  }, root);

  // Net band at top (visual)
  svg('rect', {
    class: 'net-band',
    x: -0.15, y: -0.18, width: W + 0.3, height: 0.18
  }, root);
  // Net cable line
  svg('line', {
    class: 'net',
    x1: -0.15, y1: -0.09, x2: W + 0.15, y2: -0.09
  }, root);

  // Faint zone labels
  const ZL = {
    4: { x: 1.5, y: 1.5 }, 3: { x: 4.5, y: 1.5 }, 2: { x: 7.5, y: 1.5 },
    5: { x: 1.5, y: 6.0 }, 6: { x: 4.5, y: 6.0 }, 1: { x: 7.5, y: 6.0 }
  };
  for (const [z, p] of Object.entries(ZL)) {
    const t = svg('text', { class: 'zone-label', x: p.x, y: p.y, 'font-size': 0.6 }, root);
    t.textContent = z;
  }
}

function renderPlayer(parent, zone, occ, pos, opts) {
  const role = SR.ROLES[occ.id];
  const g = svg('g', {
    class: 'player',
    'data-zone': zone,
    transform: `translate(${pos.x}, ${pos.y})`
  }, parent);

  // Passer ring (drawn behind chip)
  const isPasser = opts.passerSet.has(occ.id);
  if (isPasser) {
    svg('circle', { class: 'ring', r: SR.PLAYER_R + 0.12 }, g);
  }

  svg('circle', {
    class: `chip ${role.cls}`,
    r: SR.PLAYER_R
  }, g);

  // Role tag (small, above) — shows the position the libero is in for
  if (occ.replacedRole) {
    const tag = svg('text', {
      class: 'role-tag',
      y: -SR.PLAYER_R - 0.18,
      'font-size': 0.28
    }, g);
    tag.textContent = `(${occ.replacedRole})`;
  }

  const label = svg('text', { class: 'label', 'font-size': 0.42 }, g);
  label.textContent = role.label;

  return g;
}

// Define a single arrow marker per court SVG (id "sr-arrow"). Each court has its own.
function defineMarkers(root) {
  const defs = svg('defs', {}, root);
  const m = svg('marker', {
    id: 'sr-arrow',
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '5',
    markerHeight: '5',
    orient: 'auto-start-reverse',
    markerUnits: 'strokeWidth'
  }, defs);
  const path = svg('path', {
    d: 'M0,0 L10,5 L0,10 z',
    fill: '#f85149',
    opacity: '0.85'
  }, m);
}

// The seven overlap rules (zones, in court coordinates):
//   Column pairs (front-y < back-y): [4,5], [3,6], [2,1]
//   Same-row x order: [4,3,2] front, [5,6,1] back
//
// We surface only the non-obvious traps:
//   1. The setter's column constraint with the column's other end. Setters
//      tend to drift toward the net and can violate this without realizing.
//   2. Each front-row passer's column constraint with their back-row counterpart.
//      OHs peeling back to receive often end up behind their back-row teammate.
//
// Returns an array of { from, to } zone pairs (line drawn from front to back).
function computeHintPairs(rotationData, passerSet) {
  const colPair = { 4:[4,5], 5:[4,5], 3:[3,6], 6:[3,6], 2:[2,1], 1:[2,1] };
  const seen = new Set();
  const pairs = [];

  function add(front, back) {
    const key = `${front}-${back}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ from: front, to: back });
  }

  // Setter column pair
  const sZ = rotationData.setter.setterZone;
  const [sf, sb] = colPair[sZ];
  add(sf, sb);

  // Front-row passers
  for (const z of [4, 3, 2]) {
    const occ = SR.occupantInfo(rotationData.lineupL[z]);
    if (passerSet.has(occ.id)) {
      const [f, b] = colPair[z];
      add(f, b);
    }
  }

  return pairs;
}

function updateHints(hintEls, positions) {
  const R = SR.PLAYER_R + 0.08;
  for (const { line, pair } of hintEls) {
    const a = positions[pair.from];
    const b = positions[pair.to];
    if (!a || !b) continue;
    // Trim the line so the arrowhead lands just outside the back chip and
    // the tail starts just outside the front chip.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    line.setAttribute('x1', a.x + ux * R);
    line.setAttribute('y1', a.y + uy * R);
    line.setAttribute('x2', b.x - ux * R);
    line.setAttribute('y2', b.y - uy * R);
  }
}

function attachDrag(root, playerEls, rotationData, hintEls, opts) {
  let dragState = null;

  function svgPoint(e) {
    const rect = root.getBoundingClientRect();
    const vbX = parseFloat(root.getAttribute('viewBox').split(' ')[0]);
    const vbY = parseFloat(root.getAttribute('viewBox').split(' ')[1]);
    const vbW = parseFloat(root.getAttribute('viewBox').split(' ')[2]);
    const vbH = parseFloat(root.getAttribute('viewBox').split(' ')[3]);
    const x = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
    const y = vbY + ((e.clientY - rect.top) / rect.height) * vbH;
    return { x, y };
  }

  for (const [zStr, g] of Object.entries(playerEls)) {
    const zone = parseInt(zStr, 10);
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const p = svgPoint(e);
      const cur = rotationData.positions[zone];
      dragState = { zone, offsetX: cur.x - p.x, offsetY: cur.y - p.y, pointerId: e.pointerId };
    });
    g.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      const p = svgPoint(e);
      const newX = p.x + dragState.offsetX;
      const newY = p.y + dragState.offsetY;
      rotationData.positions[dragState.zone] = { x: newX, y: newY };
      SR.enforceOverlap(rotationData.positions, dragState.zone);
      updatePlayerPositions(playerEls, rotationData.positions);
      updateHints(hintEls, rotationData.positions);
    });
    g.addEventListener('pointerup', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      try { g.releasePointerCapture(e.pointerId); } catch(_) {}
      dragState = null;
    });
    g.addEventListener('pointercancel', () => { dragState = null; });
  }
}

function updatePlayerPositions(playerEls, positions) {
  for (const [zStr, g] of Object.entries(playerEls)) {
    const z = parseInt(zStr, 10);
    const p = positions[z];
    if (p) g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
  }
}

window.Court = { renderCourtCard, updatePlayerPositions };
