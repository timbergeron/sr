// Draws one rotation as SVG, and handles selecting, dragging and nudging players.
//
// The same markup draws the court on screen and in exported images, so a badge
// looks identical in both. Everything is in court units: the half court is 9 x 9,
// with the net at y = 0.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NET_HEADROOM = 0.22;
// Room for a selected, lifted badge's rings beside a sideline.
const RING_MARGIN = SR.PLAYER_R * 1.38 * 1.10 - (SR.PLAYER_R + 0.05);
const COURT_VIEW = {
  x: -RING_MARGIN,
  y: -NET_HEADROOM,
  width: SR.COURT_W + RING_MARGIN * 2,
  height: SR.COURT_D + NET_HEADROOM + RING_MARGIN
};
// The court is a physical object, so it keeps one palette in light and dark.
const COURT_COLORS = {
  floor: '#D8AC78',
  line: '#FBF8F2',
  netBand: '#E8E4DA',
  netBody: '#4A4E56',
  hintOK: '#1769AA',
  hintBad: '#E5484D'
};
// Orange and charcoal replace the old red/green pair; labels and rings carry
// identity and state without relying on hue.
const ROLE_COLORS = {
  setter: '#A84B00',
  oh: '#3777BE',
  mb: '#895CD2',
  op: '#454A54',
  lib: '#8F7028'
};
const DIAMETER = SR.PLAYER_R * 2;
// Every badge measurement is a fraction of its diameter. Halo floors are in CSS
// pixels: a hairline stays a hairline on a small court.
const BADGE = {
  rim: 0.055,
  edge: 0.023,
  indicatorInset: 0.070,
  indicatorStroke: 0.031,
  haloGap: 0.041, minHaloGap: 2.5,
  haloStroke: 0.027, minHaloStroke: 1.5,
  glowWidth: 0.066, minGlowWidth: 3,
  glowBlur: 0.125, minGlowBlur: 6,
  bloomWidth: 0.105, minBloomWidth: 5,
  bloomBlur: 0.22, minBloomBlur: 10
};
const FLOOR_TEXTURE = 'assets/floor.jpg';
let courtSerial = 0;

function fmt(value) {
  return Number(value.toFixed(4));
}

function escapeXML(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

// ---- Colour ----

function hexToHSV(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255;
  const g = (n >> 8 & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return '#' + [r, g, b].map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
}

// The same hue with a fixed amount of brightness added, so a dark fill shades as
// visibly as a light one.
function liftColor(hex, delta) {
  const hsv = hexToHSV(hex);
  return hsvToHex({ ...hsv, v: Math.min(1, Math.max(0, hsv.v + delta)) });
}

// The solid ring that closes a badge: three quarters of the brightness, a little
// more saturation so the deeper colour doesn't go grey.
function roleEdgeColor(family) {
  const hsv = hexToHSV(ROLE_COLORS[family]);
  return hsvToHex({ h: hsv.h, s: Math.min(1, hsv.s * 1.08), v: hsv.v * 0.75 });
}

// ---- Markup ----

function courtDefsMarkup(id) {
  const gradients = Object.keys(ROLE_COLORS).map(family => `
    <linearGradient id="${id}-grad-${family}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${liftColor(ROLE_COLORS[family], 0.035)}"/>
      <stop offset="1" stop-color="${liftColor(ROLE_COLORS[family], -0.035)}"/>
    </linearGradient>`).join('');
  const shadow = (name, dy, blur, opacity) => `
    <filter id="${id}-${name}" filterUnits="userSpaceOnUse" x="-2" y="-2" width="4" height="4" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="${fmt(dy)}" stdDeviation="${fmt(blur / 2)}" flood-color="#000" flood-opacity="${opacity}"/>
    </filter>`;
  const reach = Math.max(SR.COURT_W, SR.COURT_D);
  const vignetteStart = 0.35 / 0.9;
  return `<defs>${gradients}
    ${shadow('shadow', DIAMETER * 0.04, DIAMETER * 0.08, 0.20)}
    ${shadow('shadow-selected', DIAMETER * 0.06, DIAMETER * 0.12, 0.28)}
    ${shadow('shadow-dragging', DIAMETER * 0.14, DIAMETER * 0.26, 0.38)}
    ${shadow('text-shadow', 0, DIAMETER * 0.035, 0.30)}
    <radialGradient id="${id}-light" gradientUnits="userSpaceOnUse" cx="${SR.COURT_W / 2}" cy="${fmt(SR.COURT_D * 0.42)}" r="${reach * 0.75}">
      <stop offset="0" stop-color="#fff" stop-opacity="0.06"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.02"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-wash" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SR.COURT_D}">
      <stop offset="0" stop-color="#fff" stop-opacity="0.03"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.02"/>
    </linearGradient>
    <radialGradient id="${id}-vignette" gradientUnits="userSpaceOnUse" cx="${SR.COURT_W / 2}" cy="${SR.COURT_D / 2}" r="${reach * 0.9}">
      <stop offset="${fmt(vignetteStart)}" stop-color="#000" stop-opacity="0"/>
      <stop offset="${fmt(vignetteStart + (1 - vignetteStart) / 2)}" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.03"/>
    </radialGradient>
    <linearGradient id="${id}-net-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d1d1d1"/>
      <stop offset="1" stop-color="#fff"/>
    </linearGradient>
  </defs>`;
}

// Floor, lighting, lines and net. The texture repeats every 4.5 court units, so
// boards keep their proportions at every size.
function courtFloorMarkup(id, floorHref) {
  const W = SR.COURT_W;
  const D = SR.COURT_D;
  const tile = 4.5;
  let tiles = '';
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      tiles += `<image href="${escapeXML(floorHref)}" x="${col * tile}" y="${row * tile}" width="${tile + 0.004}" height="${tile + 0.004}" preserveAspectRatio="none"/>`;
    }
  }
  const lineWidth = 0.055;
  return `<g class="court-floor">
    <rect x="0" y="0" width="${W}" height="${D}" fill="${COURT_COLORS.floor}"/>
    ${tiles}
    <rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}-light)"/>
    <rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}-wash)"/>
    <rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}-vignette)"/>
    <rect x="0" y="0" width="${W}" height="0.16" fill="url(#${id}-net-shade)" style="mix-blend-mode:multiply"/>
    <line x1="0" y1="${SR.ATTACK_LINE}" x2="${W}" y2="${SR.ATTACK_LINE}" stroke="${COURT_COLORS.line}" stroke-opacity="0.9" stroke-width="${lineWidth}"/>
    <rect x="0" y="0" width="${W}" height="${D}" fill="none" stroke="${COURT_COLORS.line}" stroke-width="${lineWidth}"/>
    <rect x="0" y="-0.13" width="${W}" height="0.13" fill="${COURT_COLORS.netBody}"/>
    <rect x="0" y="-0.13" width="${W}" height="0.07" rx="0.035" fill="${COURT_COLORS.netBand}"/>
  </g>`;
}

function watermarkMarkup(name) {
  return `<text x="${SR.COURT_W - 0.25}" y="${fmt(SR.COURT_D - 0.2 - 0.17)}" text-anchor="end" font-family='${CHIP_FONT}' font-weight="700" font-size="0.8" fill="#000" fill-opacity="0.22">${escapeXML(name)}</text>`;
}

function spotNumbersMarkup() {
  const centres = SR.courtPositions();
  return POSITION_ZONES.map(zone => `<text x="${centres[zone].x}" y="${centres[zone].y}" text-anchor="middle" dominant-baseline="central" font-family='${CHIP_FONT}' font-weight="700" font-size="0.62" fill="#fff" fill-opacity="0.22">${zone}</text>`).join('');
}

// Lines from the active player to every neighbour that constrains them: dashed
// blue where the rule holds, solid red where it doesn't.
function hintsMarkup(positions, zone, unitsPerPx) {
  const me = positions[zone];
  if (!me) return '';
  const width = Math.max(1.5 * unitsPerPx, 0.045);
  return SR.constraintsFor(zone, positions).map(c => {
    const other = positions[c.otherZone];
    if (!other) return '';
    const color = c.satisfied ? COURT_COLORS.hintOK : COURT_COLORS.hintBad;
    const dash = c.satisfied ? ' stroke-dasharray="0.22 0.18"' : '';
    return `<line x1="${fmt(me.x)}" y1="${fmt(me.y)}" x2="${fmt(other.x)}" y2="${fmt(other.y)}" stroke="${color}" stroke-opacity="${c.satisfied ? 0.85 : 0.95}" stroke-width="${fmt(width)}" stroke-linecap="round"${dash}/>
      <circle cx="${fmt(other.x)}" cy="${fmt(other.y)}" r="0.09" fill="${color}"/>`;
  }).join('');
}

// A short arc near the badge's edge: at twelve o'clock for the front row, six for the back.
function rowArcPath(radius, row, spanDegrees = 26) {
  const centre = row === 'F' ? -Math.PI / 2 : Math.PI / 2;
  const half = spanDegrees * Math.PI / 360;
  const sx = radius * Math.cos(centre - half);
  const sy = radius * Math.sin(centre - half);
  const ex = radius * Math.cos(centre + half);
  const ey = radius * Math.sin(centre + half);
  return `M${fmt(sx)} ${fmt(sy)}A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(ex)} ${fmt(ey)}`;
}

// A thin white ring floating clear of the badge, with a soft glow behind it.
function haloMarkup(id, { isIllegal, isPasser, scale }, unitsPerPx) {
  const d = DIAMETER;
  const edge = isIllegal ? d * 1.36 : isPasser ? d : d * (1 - BADGE.rim * 2);
  const stroke = Math.max(BADGE.minHaloStroke * unitsPerPx, d * BADGE.haloStroke);
  const gap = Math.max(BADGE.minHaloGap * unitsPerPx, d * BADGE.haloGap);
  const ring = edge * scale + 2 * gap + stroke;
  const blur = (name, amount) => `<filter id="${id}-${name}" filterUnits="userSpaceOnUse" x="-3" y="-3" width="6" height="6"><feGaussianBlur stdDeviation="${fmt(amount / 2)}"/></filter>`;
  return `<g class="halo" pointer-events="none">
    ${blur('bloom', Math.max(BADGE.minBloomBlur * unitsPerPx, d * BADGE.bloomBlur))}
    ${blur('glow', Math.max(BADGE.minGlowBlur * unitsPerPx, d * BADGE.glowBlur))}
    <circle r="${fmt((ring + unitsPerPx) / 2)}" fill="none" stroke="#fff" stroke-opacity="0.10" stroke-width="${fmt(Math.max(BADGE.minBloomWidth * unitsPerPx, d * BADGE.bloomWidth))}" filter="url(#${id}-bloom)"/>
    <circle r="${fmt(ring / 2)}" fill="none" stroke="#fff" stroke-opacity="0.20" stroke-width="${fmt(Math.max(BADGE.minGlowWidth * unitsPerPx, d * BADGE.glowWidth))}" filter="url(#${id}-glow)"/>
    <circle r="${fmt(ring / 2)}" fill="none" stroke="#fff" stroke-opacity="0.88" stroke-width="${fmt(stroke)}"/>
  </g>`;
}

// The badge: a barely-there gradient closed by a deeper ring, the row arc inside,
// and a white rim for a passer. The rim is always reserved, so a passer is the same
// disc with an outline added, never a bigger disc.
function badgeMarkup(id, player, unitsPerPx) {
  const d = DIAMETER;
  const rim = d * BADGE.rim;
  const fillRadius = d / 2 - rim;
  const edgeWidth = d * BADGE.edge;
  const indicatorRadius = fillRadius - d * BADGE.indicatorInset;
  let markup = '';
  // A ring of floor colour reads as the gap between two overlapping discs, and is
  // invisible anywhere else, so only the disc on top gets it.
  if (player.overlapsNeighbour) markup += `<circle r="${fmt(d * 1.13 / 2)}" fill="${COURT_COLORS.floor}"/>`;
  if (player.isPasser) markup += `<circle r="${fmt(d / 2)}" fill="#fff"/>`;
  markup += `<circle r="${fmt(fillRadius)}" fill="url(#${id}-grad-${player.family})"/>`;
  markup += `<circle r="${fmt(fillRadius - edgeWidth / 2)}" fill="none" stroke="${roleEdgeColor(player.family)}" stroke-width="${fmt(edgeWidth)}"/>`;
  if (player.row) {
    markup += `<path d="${rowArcPath(indicatorRadius, player.row)}" fill="none" stroke="#fff" stroke-opacity="${player.row === 'B' ? 0.45 : 0.35}" stroke-width="${fmt(d * BADGE.indicatorStroke)}" stroke-linecap="round"/>`;
  }
  if (player.isIllegal) {
    const width = Math.max(2 * unitsPerPx, d * 0.09);
    markup += `<circle r="${fmt(d * 1.36 / 2 - width / 2)}" fill="none" stroke="${COURT_COLORS.hintBad}" stroke-width="${fmt(width)}"/>`;
  }
  const shadow = player.isDragging ? 'shadow-dragging' : player.isSelected ? 'shadow-selected' : 'shadow';
  return `<g class="badge" filter="url(#${id}-${shadow})" transform="scale(${player.scale})">${markup}</g>`;
}

function labelTextMarkup(player) {
  const d = DIAMETER;
  const nameSize = d * chipFontFraction(player.label);
  const common = `text-anchor="middle" dominant-baseline="central" font-family='${CHIP_FONT}' font-weight="600" fill="#fff"`;
  if (player.label === player.role) {
    return `<text y="0" font-size="${fmt(nameSize)}" ${common}>${escapeXML(player.label.toUpperCase())}</text>`;
  }
  const lineHeight = 1.19;
  const nameHeight = nameSize * lineHeight;
  const roleSize = d * ROLE_CHIP_FONT_FRACTION;
  const roleHeight = roleSize * lineHeight;
  const spacing = d * 0.035;
  const total = nameHeight + spacing + roleHeight;
  const nameY = -total / 2 + nameHeight / 2;
  const roleY = total / 2 - roleHeight / 2 - d * roleLiftFraction(player.label);
  return `<text y="${fmt(nameY)}" font-size="${fmt(nameSize)}" ${common}>${escapeXML(player.label.toUpperCase())}</text>
    <text y="${fmt(roleY)}" font-size="${fmt(roleSize)}" ${common}>${escapeXML(player.role)}</text>`;
}

// Everything needed to draw one rotation's players, in drawing order.
function courtPlayers(index, { positions, activeZone = null, selectedZone = null, draggingZone = null, reduceMotion = false }) {
  const rotation = state.rotations[index];
  const passers = passerSetFor(index);
  const labels = courtLabels();
  const order = POSITION_ZONES.slice().sort((a, b) => (a === activeZone) - (b === activeZone) || a - b);
  const nudges = labelOffsets(positions, order, hasTwoLineLabels(rotation));
  return order.map((zone, i) => {
    const occ = occupantAt(rotation, zone);
    const here = positions[zone];
    const isDragging = draggingZone === zone;
    const isSelected = selectedZone === zone;
    return {
      zone,
      occ,
      position: here,
      nudge: nudges[zone] || { dx: 0, dy: 0 },
      family: SR.ROLES[occ.id].cls,
      role: SR.ROLES[occ.id].label,
      label: labels[occ.id] || SR.ROLES[occ.id].label,
      row: SR.ZONE_GEOM[zone].row,
      isPasser: SR.isSelectedPasser(occ, passers),
      isIllegal: SR.constraintsFor(zone, positions).some(c => !c.satisfied),
      isSelected,
      isDragging,
      overlapsNeighbour: order.slice(0, i).some(other => Math.hypot(here.x - positions[other].x, here.y - positions[other].y) < DIAMETER),
      scale: reduceMotion ? 1 : isDragging ? 1.10 : isSelected ? 1.03 : 1
    };
  });
}

// A complete, static court for exports.
function courtSVGString(index, { size, floorHref }) {
  const rotation = state.rotations[index];
  if (!rotation) return '';
  const id = `export-${index}`;
  const unitsPerPx = COURT_VIEW.width / size;
  const players = courtPlayers(index, { positions: rotation.positions, reduceMotion: true });
  const bodies = players.map(p => `<g transform="translate(${fmt(p.position.x)} ${fmt(p.position.y)})">${badgeMarkup(id, p, unitsPerPx)}</g>`).join('');
  const labels = players.map(p => `<g transform="translate(${fmt(p.position.x + p.nudge.dx)} ${fmt(p.position.y + p.nudge.dy)})" filter="url(#${id}-text-shadow)">${labelTextMarkup(p)}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${fmt(size * COURT_VIEW.height / COURT_VIEW.width)}" viewBox="${COURT_VIEW.x} ${COURT_VIEW.y} ${COURT_VIEW.width} ${COURT_VIEW.height}">
    ${courtDefsMarkup(id)}${courtFloorMarkup(id, floorHref)}
    ${state.showSpotNumbers ? spotNumbersMarkup() : ''}${bodies}${labels}</svg>`;
}

// ---- Live court ----

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// options: index, interactive(), zoneView(), selectedZone(), select(zone),
// activate(), interactionEnded(), watermark
function createCourt(options) {
  const index = options.index;
  const id = `court-${++courtSerial}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'court-svg');
  svg.setAttribute('viewBox', `${COURT_VIEW.x} ${COURT_VIEW.y} ${COURT_VIEW.width} ${COURT_VIEW.height}`);
  svg.setAttribute('role', 'group');
  // The players are the tab stops, not the court around them.
  svg.setAttribute('tabindex', '-1');
  svg.setAttribute('aria-label', `Rotation ${index + 1} court`);
  svg.innerHTML = `${courtDefsMarkup(id)}${courtFloorMarkup(id, FLOOR_TEXTURE)}
    ${options.watermark ? watermarkMarkup(`R${index + 1}`) : ''}
    <g class="spots"></g><g class="hints" pointer-events="none"></g><g class="bodies"></g><g class="labels" pointer-events="none"></g>`;
  const spotsLayer = svg.querySelector('.spots');
  const hintsLayer = svg.querySelector('.hints');
  const bodiesLayer = svg.querySelector('.bodies');
  const labelsLayer = svg.querySelector('.labels');
  const bodyEls = {};
  const labelEls = {};
  for (const zone of POSITION_ZONES) {
    const body = document.createElementNS(SVG_NS, 'g');
    body.setAttribute('class', 'player');
    body.dataset.zone = zone;
    body.setAttribute('tabindex', '-1');
    body.setAttribute('role', 'button');
    bodiesLayer.appendChild(body);
    bodyEls[zone] = body;
    const text = document.createElementNS(SVG_NS, 'g');
    text.setAttribute('class', 'player-label');
    text.setAttribute('filter', `url(#${id}-text-shadow)`);
    labelsLayer.appendChild(text);
    labelEls[zone] = text;
  }

  let drag = null;
  let frame = 0;

  function displayedPositions() {
    const rotation = state.rotations[index];
    return options.zoneView() ? SR.courtPositions() : rotation.positions;
  }

  function unitsPerPx() {
    const width = svg.getBoundingClientRect().width;
    return width > 0 ? COURT_VIEW.width / width : 0.02;
  }

  function update() {
    frame = 0;
    const rotation = state.rotations[index];
    if (!rotation) return;
    const positions = displayedPositions();
    const selectedZone = options.selectedZone();
    const draggingZone = drag && drag.lifted ? drag.zone : null;
    const activeZone = drag ? drag.zone : selectedZone;
    const interactive = options.interactive();
    const perPx = unitsPerPx();
    const players = courtPlayers(index, {
      positions, activeZone, selectedZone, draggingZone, reduceMotion: prefersReducedMotion()
    });

    spotsLayer.innerHTML = state.showSpotNumbers ? spotNumbersMarkup() : '';
    hintsLayer.innerHTML = state.showHints && activeZone && !options.zoneView()
      ? hintsMarkup(positions, activeZone, perPx) : '';

    svg.classList.toggle('is-interactive', interactive);
    const focus = document.activeElement;
    const focusedZone = focus && svg.contains(focus) && focus.matches(':focus-visible') ? Number(focus.dataset.zone) : null;
    const focusRing = `<circle r="${fmt(DIAMETER * 0.74)}" fill="none" stroke="#0A84FF" stroke-width="${fmt(Math.max(2 * perPx, 0.05))}" pointer-events="none"/>`;
    players.forEach(player => {
      const body = bodyEls[player.zone];
      const text = labelEls[player.zone];
      const { x, y } = player.position;
      body.style.transform = `translate(${fmt(x)}px, ${fmt(y)}px)`;
      text.style.transform = `translate(${fmt(x + player.nudge.dx)}px, ${fmt(y + player.nudge.dy)}px) scale(${player.scale})`;
      const still = drag && drag.zone === player.zone;
      body.classList.toggle('is-held', Boolean(still));
      text.classList.toggle('is-held', Boolean(still));
      body.innerHTML = (player.isSelected ? haloMarkup(`${id}-${player.zone}`, player, perPx) : '')
        + (player.zone === focusedZone ? focusRing : '') + badgeMarkup(id, player, perPx);
      text.innerHTML = labelTextMarkup(player);
      body.setAttribute('tabindex', interactive ? '0' : '-1');
      body.setAttribute('aria-pressed', player.isSelected ? 'true' : 'false');
      body.setAttribute('aria-label', accessibleName(player));
    });

    // The active player draws last, above its neighbours. Only move nodes when the
    // order really changes: re-inserting one interrupts its movement transition.
    const desired = players.map(p => p.zone);
    const current = Array.from(bodiesLayer.children, el => Number(el.dataset.zone));
    if (desired.join() !== current.join()) {
      for (const zone of desired) {
        bodiesLayer.appendChild(bodyEls[zone]);
        labelsLayer.appendChild(labelEls[zone]);
      }
    }
  }

  function accessibleName(player) {
    const name = label(player.occ.id);
    const role = SR.ROLES[player.occ.id].tag;
    const base = name === SR.ROLES[player.occ.id].label ? role : `${name}, ${role}`;
    const rule = SR.mostRelevantConstraint(player.zone, displayedPositions());
    const advice = rule ? `. ${SR.constraintPhrase(rule, label(occupantAt(state.rotations[index], rule.otherZone).id))}` : '';
    const row = player.row === 'F' ? 'front row' : 'back row';
    return `${base}, zone ${player.zone}, ${row}${player.isPasser ? ', passer' : ''}${player.isIllegal ? ', overlap violation' : ''}${advice}`;
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function toCourtPoint(event) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function finishDrag() {
    if (!drag) return;
    const finished = drag;
    drag = null;
    const rotation = state.rotations[index];
    const moved = finished.lifted && rotation && POSITION_ZONES.some(zone => {
      const before = finished.before[zone];
      const after = rotation.positions[zone];
      return before && after && (before.x !== after.x || before.y !== after.y);
    });
    if (moved) commitDrag(index, finished.zone, finished.snapshot);
    else update();
    options.interactionEnded();
  }

  svg.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target.closest && event.target.closest('.player');
    if (!options.interactive()) return;
    if (!target) {
      options.activate();
      options.select(null);
      return;
    }
    const zone = Number(target.dataset.zone);
    const rotation = state.rotations[index];
    const current = displayedPositions()[zone];
    const point = toCourtPoint(event);
    event.preventDefault();
    try { svg.setPointerCapture(event.pointerId); } catch (_) { /* capture is best effort */ }
    drag = {
      zone,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: current.x - point.x,
      grabY: current.y - point.y,
      snapshot: stateSnapshot(),
      before: clonePositions(rotation.positions),
      lifted: false
    };
    options.activate();
    options.select(zone);
  });

  svg.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId || options.zoneView()) return;
    // Selection is not movement: until the pointer travels, nothing is re-solved.
    if (!drag.lifted) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4) return;
      drag.lifted = true;
    }
    const point = toCourtPoint(event);
    setPosition(index, drag.zone, { x: point.x + drag.grabX, y: point.y + drag.grabY });
    scheduleUpdate();
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    svg.addEventListener(type, event => {
      if (drag && drag.pointerId === event.pointerId) finishDrag();
    });
  }

  svg.addEventListener('focusin', scheduleUpdate);
  svg.addEventListener('focusout', scheduleUpdate);

  // A drag that starts on a player must not scroll or swipe the page.
  svg.addEventListener('touchstart', event => {
    if (options.interactive() && event.target.closest && event.target.closest('.player')) event.preventDefault();
  }, { passive: false });

  svg.addEventListener('keydown', event => {
    const target = event.target.closest && event.target.closest('.player');
    if (!target || !options.interactive()) return;
    const zone = Number(target.dataset.zone);
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      options.activate();
      options.select(options.selectedZone() === zone ? null : zone);
    } else if (moves[event.key] && !options.zoneView()) {
      event.preventDefault();
      options.activate();
      options.select(zone);
      nudgePlayer(index, zone, ...moves[event.key]);
      options.interactionEnded();
      requestAnimationFrame(() => {
        const again = svg.querySelector(`.player[data-zone="${zone}"]`);
        if (again) again.focus();
      });
    }
  });

  return {
    element: svg,
    update,
    isDragging: () => Boolean(drag)
  };
}
