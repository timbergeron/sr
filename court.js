// Renders one court SVG and wires up dragging.

const NS = 'http://www.w3.org/2000/svg';
const VIEW_PAD = 0.6; // padding around court for net band, labels
const ZONE_VIEW_ANIMATION_MS = 650;
const DROP_SETTLE_MS = 180;
const UNDO_TOAST_MS = 5200;
const ZONE_CENTERS = {
  4: { x: 1.5, y: 1.5 },
  3: { x: 4.5, y: 1.5 },
  2: { x: 7.5, y: 1.5 },
  5: { x: 1.5, y: 6.0 },
  6: { x: 4.5, y: 6.0 },
  1: { x: 7.5, y: 6.0 }
};
const playerAnimations = new WeakMap();
let undoToastTimer = null;

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
  header.appendChild(title);

  const zoneViewToggle = createZoneViewToggle(rotationData.rotationIdx);
  header.appendChild(zoneViewToggle.label);
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
  const tooltip = createOverlapTooltip(card);
  const viewState = { zoneView: false };

  drawCourt(root, opts);
  defineMarkers(root);

  // Hints layer (drawn under players)
  const hintsGroup = svg('g', { class: 'overlap-hints' }, root);
  const hintState = { group: hintsGroup, lines: [], activeZone: null };

  // Render players (zones 1..6)
  const playersGroup = svg('g', { class: 'players-group' }, root);
  const playerEls = {};
  for (const z of [1,2,3,4,5,6]) {
    const occ = SR.occupantInfo(rotationData.lineupL[z]);
    const pos = currentCourtPositions(rotationData, viewState)[z];
    const g = renderPlayer(playersGroup, z, occ, pos, opts);
    playerEls[z] = g;
  }

  zoneViewToggle.input.addEventListener('change', () => {
    const animationToken = (viewState.animationToken || 0) + 1;
    viewState.animationToken = animationToken;
    viewState.zoneViewAnimating = true;
    viewState.zoneView = zoneViewToggle.input.checked;
    card.classList.toggle('zone-view', viewState.zoneView);
    card.classList.add('zone-view-animating');
    hideOverlapTooltip(tooltip, hintState);
    updatePlayerPositions(playerEls, currentCourtPositions(rotationData, viewState), {
      animate: true,
      duration: ZONE_VIEW_ANIMATION_MS,
      onComplete: () => {
        if (viewState.animationToken !== animationToken) return;
        viewState.zoneViewAnimating = false;
        card.classList.remove('zone-view-animating');
      }
    });
  });

  attachOverlapTooltips(card, playerEls, rotationData, tooltip, hintState, viewState, opts.playerLabels || {});

  // Drag interactions
  attachDrag(root, playerEls, rotationData, hintState, opts, tooltip, viewState);

  container.appendChild(card);
  return { card, root, playerEls };
}

function createZoneViewToggle(rotationIdx) {
  const label = document.createElement('label');
  label.className = 'zone-view-toggle';

  const text = document.createElement('span');
  text.className = 'zone-view-label';
  text.textContent = 'Position Zone View:';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-label', `Toggle position zone view for rotation ${rotationIdx + 1}`);

  const track = document.createElement('span');
  track.className = 'switch-track';
  track.setAttribute('aria-hidden', 'true');

  label.appendChild(text);
  label.appendChild(input);
  label.appendChild(track);

  return { label, input };
}

function zoneCenterPositions() {
  const positions = {};
  for (const [zone, pos] of Object.entries(ZONE_CENTERS)) {
    positions[zone] = { ...pos };
  }
  return positions;
}

function currentCourtPositions(rotationData, viewState) {
  return viewState.zoneView ? zoneCenterPositions() : rotationData.positions;
}

function prefersReducedMotion() {
  return window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function drawCourt(root, opts = {}) {
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

  if (!opts.showSpotNumbers) return;

  // Faint zone labels
  for (const [z, p] of Object.entries(ZONE_CENTERS)) {
    const t = svg('text', { class: 'zone-label', x: p.x, y: p.y, 'font-size': 0.6 }, root);
    t.textContent = z;
  }
}

function playerDisplayLabel(id, labels = {}) {
  const custom = (labels[id] || '').trim();
  return custom || SR.ROLES[id].label;
}

function playerTitle(id, labels = {}) {
  const label = playerDisplayLabel(id, labels);
  const roleLabel = SR.ROLES[id].label;
  return label === roleLabel ? roleLabel : `${label} (${roleLabel})`;
}

function chipFontSize(label) {
  if (label.length <= 2) return 0.42;
  if (label.length <= 3) return 0.34;
  if (label.length <= 5) return 0.27;
  return 0.22;
}

function renderPlayer(parent, zone, occ, pos, opts) {
  const role = SR.ROLES[occ.id];
  const playerLabels = opts.playerLabels || {};
  const displayLabel = playerDisplayLabel(occ.id, playerLabels);
  const g = svg('g', {
    class: 'player',
    'data-zone': zone,
    tabindex: '0',
    role: 'img',
    'aria-label': `${playerTitle(occ.id, playerLabels)} zone ${zone}`,
    transform: `translate(${pos.x}, ${pos.y})`
  }, parent);
  setPlayerTransform(g, pos);
  const visual = svg('g', { class: 'player-visual' }, g);

  // Passer ring (drawn behind chip)
  const isPasser = SR.isSelectedPasser(occ, opts.passerSet);
  if (isPasser) {
    svg('circle', { class: 'ring', r: SR.PLAYER_R + 0.12 }, visual);
  }

  svg('circle', {
    class: `chip ${role.cls}`,
    r: SR.PLAYER_R
  }, visual);

  const label = svg('text', {
    class: 'label',
    y: '0.04',
    'font-size': chipFontSize(displayLabel)
  }, visual);
  label.textContent = displayLabel;

  return g;
}

function createOverlapTooltip(card) {
  const tooltip = document.createElement('div');
  tooltip.className = 'overlap-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  card.appendChild(tooltip);
  return tooltip;
}

function playerLabel(rotationData, zone, labels = {}) {
  const occ = SR.occupantInfo(rotationData.lineupL[zone]);
  const role = SR.ROLES[occ.id];
  const title = occ.replacedRole
    ? `${playerTitle(occ.id, labels)} / ${playerDisplayLabel(occ.replacedRole, labels)}`
    : playerTitle(occ.id, labels);
  return {
    label: playerDisplayLabel(occ.id, labels),
    title,
    tag: role.tag,
    zone
  };
}

function adjacentOverlapRules(rotationData, zone, positions = rotationData.positions, labels = {}) {
  const rules = [];
  const colPair = { 4: [4, 5], 5: [4, 5], 3: [3, 6], 6: [3, 6], 2: [2, 1], 1: [2, 1] };
  const rowOrder = SR.ZONE_GEOM[zone].row === 'F' ? [4, 3, 2] : [5, 6, 1];
  const rowIdx = rowOrder.indexOf(zone);

  const [front, back] = colPair[zone];
  const columnOther = zone === front ? back : front;
  const columnOtherLabel = playerLabel(rotationData, columnOther, labels);
  rules.push({
    axis: 'Front/back',
    relation: zone === front ? 'In front of' : 'Behind',
    other: columnOtherLabel,
    ok: zone === front
      ? positions[zone].y < positions[columnOther].y
      : positions[zone].y > positions[columnOther].y
  });

  if (rowIdx > 0) {
    const leftZone = rowOrder[rowIdx - 1];
    rules.push({
      axis: 'Side-to-side',
      relation: 'Right of',
      other: playerLabel(rotationData, leftZone, labels),
      ok: positions[zone].x > positions[leftZone].x
    });
  }

  if (rowIdx < rowOrder.length - 1) {
    const rightZone = rowOrder[rowIdx + 1];
    rules.push({
      axis: 'Side-to-side',
      relation: 'Left of',
      other: playerLabel(rotationData, rightZone, labels),
      ok: positions[zone].x < positions[rightZone].x
    });
  }

  return rules;
}

function renderTooltipContent(tooltip, rotationData, zone, positions, labels) {
  tooltip.innerHTML = '';

  const player = playerLabel(rotationData, zone, labels);
  const kicker = document.createElement('div');
  kicker.className = 'tooltip-kicker';
  kicker.textContent = 'Adjacent overlaps';

  const title = document.createElement('div');
  title.className = 'tooltip-title';
  title.textContent = player.title;

  const meta = document.createElement('span');
  meta.textContent = `Zone ${zone}`;
  title.appendChild(meta);

  const list = document.createElement('div');
  list.className = 'tooltip-list';

  for (const rule of adjacentOverlapRules(rotationData, zone, positions, labels)) {
    const item = document.createElement('div');
    item.className = 'tooltip-rule';

    const axis = document.createElement('span');
    axis.className = 'tooltip-axis';
    axis.textContent = rule.axis;

    const text = document.createElement('span');
    text.className = 'tooltip-rule-text';
    text.textContent = `${rule.relation} ${rule.other.title}`;

    const zoneTag = document.createElement('span');
    zoneTag.className = 'tooltip-zone';
    zoneTag.textContent = `Z${rule.other.zone}`;
    text.appendChild(zoneTag);

    const state = document.createElement('span');
    state.className = rule.ok ? 'tooltip-state ok' : 'tooltip-state warn';
    state.textContent = rule.ok ? 'OK' : 'Check';

    item.appendChild(axis);
    item.appendChild(text);
    item.appendChild(state);
    list.appendChild(item);
  }

  tooltip.appendChild(kicker);
  tooltip.appendChild(title);
  tooltip.appendChild(list);
}

function positionTooltip(card, tooltip, event) {
  const cardRect = card.getBoundingClientRect();
  const courtRect = card.querySelector('.court-svg').getBoundingClientRect();
  const gap = 12;
  const edgePad = 8;
  const w = tooltip.offsetWidth;
  const h = tooltip.offsetHeight;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const cursorY = event.clientY || courtRect.top + courtRect.height / 2;
  const cursorX = event.clientX || courtRect.left + courtRect.width / 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  let x;
  let y;
  if (courtRect.right + gap + w <= viewportW - edgePad) {
    x = courtRect.right + gap;
    y = clamp(cursorY - h / 2, edgePad, viewportH - h - edgePad);
  } else if (courtRect.left - gap - w >= edgePad) {
    x = courtRect.left - gap - w;
    y = clamp(cursorY - h / 2, edgePad, viewportH - h - edgePad);
  } else if (courtRect.bottom + gap + h <= viewportH - edgePad) {
    x = clamp(cursorX - w / 2, edgePad, viewportW - w - edgePad);
    y = courtRect.bottom + gap;
  } else {
    x = clamp(cursorX - w / 2, edgePad, viewportW - w - edgePad);
    y = courtRect.top - gap - h;
  }

  tooltip.style.transform = `translate(${x - cardRect.left}px, ${y - cardRect.top}px)`;
}

function showOverlapTooltip(card, tooltip, rotationData, zone, event, hintState, viewState, labels) {
  const positions = currentCourtPositions(rotationData, viewState);
  renderTooltipContent(tooltip, rotationData, zone, positions, labels);
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  showOverlapHints(hintState, rotationData, zone, positions, labels);
  positionTooltip(card, tooltip, event);
}

function hideOverlapTooltip(tooltip, hintState) {
  tooltip.classList.remove('visible');
  tooltip.setAttribute('aria-hidden', 'true');
  clearOverlapHints(hintState);
}

function attachOverlapTooltips(card, playerEls, rotationData, tooltip, hintState, viewState, labels) {
  for (const [zStr, g] of Object.entries(playerEls)) {
    const zone = parseInt(zStr, 10);
    g.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      showOverlapTooltip(card, tooltip, rotationData, zone, e, hintState, viewState, labels);
    });
    g.addEventListener('pointermove', (e) => {
      if (!tooltip.classList.contains('visible')) return;
      positionTooltip(card, tooltip, e);
    });
    g.addEventListener('pointerleave', () => hideOverlapTooltip(tooltip, hintState));
    g.addEventListener('focus', (e) => {
      const rect = g.getBoundingClientRect();
      showOverlapTooltip(card, tooltip, rotationData, zone, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }, hintState, viewState, labels);
    });
    g.addEventListener('blur', () => hideOverlapTooltip(tooltip, hintState));
  }
}

function clearOverlapHints(hintState) {
  while (hintState.group.firstChild) {
    hintState.group.removeChild(hintState.group.firstChild);
  }
  hintState.lines = [];
  hintState.activeZone = null;
}

function showOverlapHints(hintState, rotationData, zone, positions, labels) {
  clearOverlapHints(hintState);
  hintState.activeZone = zone;

  for (const rule of adjacentOverlapRules(rotationData, zone, positions, labels)) {
    const line = svg('line', {
      class: 'overlap-hint',
      'marker-end': 'url(#sr-arrow)'
    }, hintState.group);
    hintState.lines.push({
      line,
      pair: { from: zone, to: rule.other.zone }
    });
  }

  updateHints(hintState.lines, positions);
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
    fill: '#ff1f3d',
    opacity: '0.95'
  }, m);
}

function updateHints(hintEls, positions) {
  const R = SR.PLAYER_R + 0.08;
  for (const { line, pair } of hintEls) {
    const a = positions[pair.from];
    const b = positions[pair.to];
    if (!a || !b) {
      line.style.display = 'none';
      continue;
    }
    line.style.display = '';
    // Trim the line so it starts and ends outside the player chips.
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

function currentPasserZones(rotationData, passerSet) {
  const zones = [];
  for (const z of [1, 2, 3, 4, 5, 6]) {
    const occ = SR.occupantInfo(rotationData.lineupL[z]);
    if (SR.isSelectedPasser(occ, passerSet)) zones.push(z);
  }
  return zones;
}

function attachDrag(root, playerEls, rotationData, hintState, opts, tooltip, viewState) {
  let dragState = null;
  const passerZones = currentPasserZones(rotationData, opts.passerSet);
  const passerZoneSet = new Set(passerZones);
  const playerLabels = opts.playerLabels || {};

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
      if (viewState.zoneView || viewState.zoneViewAnimating) return;
      e.preventDefault();
      hideOverlapTooltip(tooltip, hintState);
      g.setPointerCapture(e.pointerId);
      if (g.parentNode) g.parentNode.appendChild(g);
      g.classList.remove('drop-settle');
      g.classList.add('dragging');
      const p = svgPoint(e);
      const cur = rotationData.positions[zone];
      dragState = {
        zone,
        offsetX: cur.x - p.x,
        offsetY: cur.y - p.y,
        pointerId: e.pointerId,
        before: clonePositions(rotationData.positions)
      };
    });
    g.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      const p = svgPoint(e);
      const newX = p.x + dragState.offsetX;
      const newY = p.y + dragState.offsetY;
      rotationData.positions[dragState.zone] = { x: newX, y: newY };
      // Non-passers resolve around fixed SR lanes; dragging an SR player lets the rest adjust.
      const anchors = passerZoneSet.has(dragState.zone)
        ? new Set([dragState.zone])
        : new Set(passerZones);
      SR.enforceOverlap(rotationData.positions, anchors);
      updatePlayerPositions(playerEls, rotationData.positions);
      if (hintState.activeZone) updateHints(hintState.lines, rotationData.positions);
    });
    g.addEventListener('pointerup', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      try { g.releasePointerCapture(e.pointerId); } catch(_) {}
      const finishedDrag = dragState;
      dragState = null;
      g.classList.remove('dragging');
      const after = clonePositions(rotationData.positions);
      const moved = positionsChanged(finishedDrag.before, after);
      if (moved) {
        playDropSettle(g);
        if (opts.onPositionsChange) opts.onPositionsChange(rotationData);
        showUndoToast(moveLabel(rotationData, finishedDrag.zone, playerLabels), () => {
          restorePositions(rotationData.positions, finishedDrag.before);
          updatePlayerPositions(playerEls, rotationData.positions, {
            animate: true,
            duration: 220
          });
          if (hintState.activeZone) updateHints(hintState.lines, rotationData.positions);
          if (opts.onPositionsChange) opts.onPositionsChange(rotationData);
        });
      }
    });
    g.addEventListener('pointercancel', () => {
      if (!dragState) return;
      playerEls[dragState.zone].classList.remove('dragging');
      dragState = null;
      if (opts.onPositionsChange) opts.onPositionsChange(rotationData);
    });
  }
}

function moveLabel(rotationData, zone, labels) {
  const occ = SR.occupantInfo(rotationData.lineupL[zone]);
  return playerDisplayLabel(occ.id, labels);
}

function clonePositions(positions) {
  const clone = {};
  for (const z of [1, 2, 3, 4, 5, 6]) {
    const p = positions[z];
    if (p) clone[z] = { x: p.x, y: p.y };
  }
  return clone;
}

function restorePositions(target, source) {
  for (const z of [1, 2, 3, 4, 5, 6]) {
    if (!source[z]) continue;
    target[z] = { x: source[z].x, y: source[z].y };
  }
}

function positionsChanged(a, b) {
  for (const z of [1, 2, 3, 4, 5, 6]) {
    if (!a[z] || !b[z]) continue;
    if (Math.hypot(a[z].x - b[z].x, a[z].y - b[z].y) > 0.01) return true;
  }
  return false;
}

function playDropSettle(g) {
  if (prefersReducedMotion()) return;
  g.classList.remove('drop-settle');
  void g.getBoundingClientRect();
  g.classList.add('drop-settle');
  window.setTimeout(() => {
    g.classList.remove('drop-settle');
  }, DROP_SETTLE_MS);
}

function ensureUndoToast() {
  let toast = document.querySelector('.undo-toast');
  if (toast) return toast;

  toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-hidden', 'true');

  const message = document.createElement('span');
  message.className = 'undo-toast-message';

  const button = document.createElement('button');
  button.className = 'undo-toast-action';
  button.type = 'button';
  button.tabIndex = -1;
  button.textContent = 'Undo';

  toast.appendChild(message);
  toast.appendChild(button);
  document.body.appendChild(toast);
  return toast;
}

function hideUndoToast() {
  const toast = document.querySelector('.undo-toast');
  if (!toast) return;
  const button = toast.querySelector('.undo-toast-action');
  window.clearTimeout(undoToastTimer);
  toast.classList.remove('visible');
  toast.setAttribute('aria-hidden', 'true');
  if (button) button.tabIndex = -1;
}

function showUndoToast(label, onUndo) {
  const toast = ensureUndoToast();
  const message = toast.querySelector('.undo-toast-message');
  const button = toast.querySelector('.undo-toast-action');

  window.clearTimeout(undoToastTimer);
  message.textContent = `Moved ${label}`;
  button.tabIndex = 0;
  button.onclick = () => {
    hideUndoToast();
    onUndo();
  };
  toast.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => {
    toast.classList.add('visible');
  });
  undoToastTimer = window.setTimeout(hideUndoToast, UNDO_TOAST_MS);
}

function updatePlayerPositions(playerEls, positions, opts = {}) {
  const shouldAnimate = opts.animate && !prefersReducedMotion();
  const entries = Object.entries(playerEls).filter(([zStr]) => {
    const z = parseInt(zStr, 10);
    return Boolean(positions[z]);
  });

  if (!entries.length) {
    if (opts.onComplete) opts.onComplete();
    return;
  }

  let remaining = entries.length;
  const done = () => {
    remaining -= 1;
    if (remaining === 0 && opts.onComplete) opts.onComplete();
  };

  for (const [zStr, g] of entries) {
    const z = parseInt(zStr, 10);
    const p = positions[z];
    if (shouldAnimate) {
      animatePlayerTo(g, p, {
        duration: opts.duration || ZONE_VIEW_ANIMATION_MS,
        onComplete: done
      });
    } else {
      cancelPlayerAnimation(g);
      setPlayerTransform(g, p);
      done();
    }
  }
}

function setPlayerTransform(g, p) {
  g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
  g.setAttribute('data-x', p.x);
  g.setAttribute('data-y', p.y);
}

function currentPlayerTransform(g) {
  const rawX = g.getAttribute('data-x');
  const rawY = g.getAttribute('data-y');
  const x = rawX === null ? NaN : Number(rawX);
  const y = rawY === null ? NaN : Number(rawY);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };

  const match = (g.getAttribute('transform') || '').match(/translate\(\s*([-+]?\d*\.?\d+)\s*[, ]\s*([-+]?\d*\.?\d+)\s*\)/);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function cancelPlayerAnimation(g) {
  const animation = playerAnimations.get(g);
  if (!animation) return;
  cancelAnimationFrame(animation.frameId);
  playerAnimations.delete(g);
  g.classList.remove('is-animating');
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animatePlayerTo(g, target, opts = {}) {
  const from = currentPlayerTransform(g) || target;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const distance = Math.hypot(dx, dy);

  cancelPlayerAnimation(g);

  if (distance < 0.001) {
    setPlayerTransform(g, target);
    if (opts.onComplete) opts.onComplete();
    return;
  }

  const duration = Math.max(120, opts.duration || ZONE_VIEW_ANIMATION_MS);
  const startedAt = performance.now();
  const animation = { frameId: 0 };
  g.classList.add('is-animating');

  const step = (now) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = easeInOutCubic(t);
    setPlayerTransform(g, {
      x: from.x + dx * eased,
      y: from.y + dy * eased
    });

    if (t < 1) {
      animation.frameId = requestAnimationFrame(step);
      return;
    }

    setPlayerTransform(g, target);
    playerAnimations.delete(g);
    g.classList.remove('is-animating');
    if (opts.onComplete) opts.onComplete();
  };

  animation.frameId = requestAnimationFrame(step);
  playerAnimations.set(g, animation);
}

window.Court = {
  renderCourtCard,
  updatePlayerPositions,
  dismissUndoToast: hideUndoToast
};
