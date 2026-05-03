// State and UI wiring.

const SHARE_HASH_PREFIX = 'sr=';
const SHARE_VERSION = 1;
const SHARE_COPY_CONFIRMATION = 'Copied. Includes current positions, labels, passers, and display options.';
const POSITION_ZONES = [1, 2, 3, 4, 5, 6];
let shareSyncTimer = null;
let shareStatusTimer = null;
let shareQrRenderToken = 0;

const state = {
  system: '5-1',          // '5-1' or '6-2'
  passerCount: 3,
  passers: new Set(['L', 'O1', 'O2']), // canonical position ids ('L' for libero)
  playerLabels: {},
  showHints: true,
  showBackrowMAsL: true,
  showSpotNumbers: false,
  rotations: []           // 6 rotation data objects
};

function customLabelFor(id) {
  const label = (state.playerLabels[id] || '').trim();
  return label || SR.ROLES[id].label;
}

function hasCustomLabel(id) {
  return Boolean((state.playerLabels[id] || '').trim());
}

function playerSummary(ids) {
  return ids.map(id => {
    const label = customLabelFor(id);
    return hasCustomLabel(id) ? `${id}:${label}` : id;
  }).join(', ');
}

function cleanedPlayerLabels() {
  const labels = {};
  for (const [id, value] of Object.entries(state.playerLabels)) {
    const label = String(value || '').trim();
    if (SR.ROLES[id] && label) labels[id] = label;
  }
  return labels;
}

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
}

function currentPositionPayload() {
  return state.rotations.map(rot => (
    POSITION_ZONES.map(zone => {
      const p = rot.positions[zone];
      return p ? [roundCoord(p.x), roundCoord(p.y)] : null;
    })
  ));
}

function buildSharePayload() {
  return {
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
    positions: currentPositionPayload()
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

function syncShareUrl() {
  if (!state.rotations.length) return;
  const href = currentShareHref();
  window.history.replaceState(null, '', href);
  refreshShareQrIfOpen(href);
}

function scheduleShareUrlSync() {
  window.clearTimeout(shareSyncTimer);
  shareSyncTimer = window.setTimeout(syncShareUrl, 200);
}

function setShareStatus(message, duration = 2400) {
  const el = document.getElementById('share-status');
  if (!el) return;
  el.textContent = message;
  window.clearTimeout(shareStatusTimer);
  if (message && duration > 0) {
    shareStatusTimer = window.setTimeout(() => {
      el.textContent = '';
    }, duration);
  }
}

function applyHintVisibility() {
  document.body.classList.toggle('hide-hints', !state.showHints);
}

function dismissSwipeCueOnHorizontalScroll() {
  const scrollX = window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
  if (scrollX <= 12) return;

  document.body.classList.add('swipe-cue-dismissed');
  window.removeEventListener('scroll', dismissSwipeCueOnHorizontalScroll);
}

function validPasserSet(system, passers) {
  const valid = new Set(availablePassers(system));
  return new Set((Array.isArray(passers) ? passers : []).filter(id => valid.has(id)));
}

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
    SR.clampToCourt(positions);
  }
}

function loadSharedStateFromUrl() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return { loaded: false, positions: null };

  try {
    const payload = decodeSharePayload(hash.slice(SHARE_HASH_PREFIX.length));
    const system = payload.system === '6-2' ? '6-2' : '5-1';
    const passerCount = [2, 3, 4, 5].includes(+payload.passerCount)
      ? +payload.passerCount
      : 3;
    const passers = validPasserSet(system, payload.passers);

    state.system = system;
    state.passerCount = passerCount;
    state.passers = passers.size >= 2 ? passers : defaultPassers(system, passerCount);
    state.playerLabels = {};
    if (payload.labels && typeof payload.labels === 'object') {
      for (const [id, value] of Object.entries(payload.labels)) {
        if (SR.ROLES[id]) state.playerLabels[id] = String(value).slice(0, 10);
      }
    }

    const display = payload.display || {};
    state.showHints = display.hints !== false;
    state.showBackrowMAsL = display.backrowMAsL !== false;
    state.showSpotNumbers = display.spotNumbers === true;
    return {
      loaded: true,
      positions: Array.isArray(payload.positions) ? payload.positions : null
    };
  } catch (_) {
    setShareStatus('Could not load shared link.');
    return { loaded: false, positions: null };
  }
}

async function copyShareLink() {
  const href = currentShareHref();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(href);
    } else {
      fallbackCopyText(href);
    }
    setShareStatus(SHARE_COPY_CONFIRMATION, 4200);
  } catch (_) {
    try {
      fallbackCopyText(href);
      setShareStatus(SHARE_COPY_CONFIRMATION, 4200);
    } catch (err) {
      setShareStatus('Copy failed. Select the address bar URL.');
    }
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function shareQrElements() {
  return {
    trigger: document.getElementById('share-qr'),
    popover: document.getElementById('share-qr-popover'),
    shell: document.getElementById('share-qr-canvas-shell'),
    status: document.getElementById('share-qr-status')
  };
}

function closeShareQr() {
  const { trigger, popover } = shareQrElements();
  if (!popover) return;
  popover.hidden = true;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function refreshShareQrIfOpen(href = window.location.href) {
  const { popover } = shareQrElements();
  if (!popover || popover.hidden) return;
  renderShareQr(href);
}

function toggleShareQr() {
  const { popover } = shareQrElements();
  if (!popover || popover.hidden) {
    renderShareQr(currentShareHref());
    return;
  }
  closeShareQr();
}

async function renderShareQr(href) {
  const { trigger, popover, shell, status } = shareQrElements();
  if (!popover || !shell || !status) return;

  const token = ++shareQrRenderToken;
  popover.hidden = false;
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  status.textContent = 'Generating QR...';
  shell.hidden = false;

  if (typeof window.QRCode !== 'function') {
    shell.hidden = true;
    status.textContent = 'QR generator unavailable. Copy link instead.';
    return;
  }

  try {
    shell.textContent = '';
    new window.QRCode(shell, {
      text: href,
      width: 184,
      height: 184,
      colorDark: '#0e1116',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
    if (token !== shareQrRenderToken) return;
    shell.hidden = false;
    status.textContent = 'Scan to open this setup.';
  } catch (_) {
    if (token !== shareQrRenderToken) return;
    shell.textContent = '';
    shell.hidden = true;
    status.textContent = 'Link is too large for QR. Copy link instead.';
  }
}

// All possible passer ids for each system. L is always available (libero).
function availablePassers(system) {
  if (system === '5-1') return ['S', 'O1', 'O2', 'M1', 'M2', 'OP', 'L'];
  return ['S1', 'S2', 'O1', 'O2', 'M1', 'M2', 'L'];
}

// Default passers when system or count changes
function defaultPassers(system, count) {
  // Prefer L, then OHs, then OP before middles. Cap at count.
  if (system === '5-1' && count === 5) {
    // Six canonical ids produce five visible passers because L replaces one MB.
    return new Set(['L', 'O1', 'O2', 'OP', 'M1', 'M2']);
  }
  const order = system === '5-1'
    ? ['L', 'O1', 'O2', 'OP', 'M1', 'M2', 'S']
    : ['L', 'O1', 'O2', 'M1', 'M2', 'S1', 'S2'];
  return new Set(order.slice(0, count));
}

function selectedPasserCount() {
  const fiveOneAllNonSetters = state.system === '5-1'
    && state.passerCount === 5
    && ['L', 'O1', 'O2', 'OP', 'M1', 'M2'].every(id => state.passers.has(id))
    && !state.passers.has('S');
  return fiveOneAllNonSetters ? 5 : state.passers.size;
}

function setSystem(sys) {
  state.system = sys;
  // Clean passers that aren't valid for new system; re-default if needed
  const valid = new Set(availablePassers(sys));
  const filtered = new Set([...state.passers].filter(p => valid.has(p)));
  if (filtered.size !== state.passerCount) {
    state.passers = defaultPassers(sys, state.passerCount);
  } else {
    state.passers = filtered;
  }
  rebuildAll();
}

function setPasserCount(n) {
  state.passerCount = n;
  if (state.system === '5-1' && n === 5) {
    state.passers = defaultPassers(state.system, n);
    rebuildAll();
    return;
  }
  if (state.passers.size > n) {
    // trim from least-priority end
    const order = state.system === '5-1'
      ? ['S', 'M1', 'M2', 'OP', 'O2', 'O1', 'L']
      : ['S1', 'S2', 'M1', 'M2', 'O2', 'O1', 'L'];
    const arr = [...state.passers];
    arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    state.passers = new Set(arr.slice(arr.length - n));
  } else if (state.passers.size < n) {
    // top up with defaults not already in
    const order = state.system === '5-1'
      ? ['L', 'O1', 'O2', 'OP', 'M1', 'M2', 'S']
      : ['L', 'O1', 'O2', 'M1', 'M2', 'S1', 'S2'];
    for (const p of order) {
      if (state.passers.size >= n) break;
      if (!state.passers.has(p)) state.passers.add(p);
    }
  }
  rebuildAll();
}

function togglePasser(id) {
  if (state.passers.has(id)) {
    if (state.passers.size <= 2) {
      const replacement = replacementPasserFor(id);
      if (!replacement) return; // minimum 2 passers
      state.passers.delete(id);
      state.passers.add(replacement);
      rebuildAll();
      return;
    }
    state.passers.delete(id);
    state.passerCount = state.passers.size;
  } else {
    if (state.passers.size >= state.passerCount) {
      state.passers.delete(passerToReplace(id));
    }
    state.passers.add(id);
  }
  rebuildAll();
}

function replacementPasserFor(removedId) {
  const order = state.system === '5-1'
    ? ['O1', 'O2', 'L', 'OP', 'M1', 'M2', 'S']
    : ['O1', 'O2', 'L', 'M1', 'M2', 'S1', 'S2'];
  return order.find(p => p !== removedId && !state.passers.has(p)) || null;
}

function passerToReplace(incomingId) {
  if (incomingId !== 'L' && state.passers.has('L')) return 'L';

  for (const existing of state.passers) {
    if (existing !== 'L') return existing;
  }
  return state.passers.values().next().value;
}

function rebuildAll(opts = {}) {
  state.rotations = [];
  for (let i = 0; i < 6; i++) {
    state.rotations.push(SR.buildRotation(state.system, i, state.passers, {
      showBackrowMAsL: state.showBackrowMAsL
    }));
  }
  if (opts.positions) applySharedPositions(opts.positions);
  renderControls();
  renderCourts();
  if (opts.sync !== false) scheduleShareUrlSync();
}

function renderControls() {
  // System
  document.querySelectorAll('#system-toggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === state.system);
  });
  // Passer count
  document.querySelectorAll('#passer-count .seg-btn').forEach(b => {
    b.classList.toggle('active', +b.dataset.value === state.passerCount);
  });
  renderPasserList();
  renderRosterLabels();

  const warn = document.getElementById('passer-warn');
  const selectedCount = selectedPasserCount();
  warn.textContent = selectedCount === state.passerCount
    ? ''
    : `Selected ${selectedCount} of ${state.passerCount}`;

  document.getElementById('spot-numbers-toggle').checked = state.showSpotNumbers;
  document.getElementById('hints-toggle').checked = state.showHints;
  document.getElementById('backrow-m-as-l-toggle').checked = state.showBackrowMAsL;
  applyHintVisibility();
}

function renderPasserList() {
  const list = document.getElementById('passer-list');
  list.innerHTML = '';
  for (const id of availablePassers(state.system)) {
    const el = document.createElement('div');
    el.className = 'passer-check';
    el.dataset.roleId = id;
    if (state.passers.has(id)) el.classList.add('active');

    const code = document.createElement('span');
    code.className = 'passer-code';
    code.textContent = id;
    el.appendChild(code);

    if (hasCustomLabel(id)) {
      const label = document.createElement('span');
      label.className = 'passer-name';
      label.textContent = customLabelFor(id);
      el.appendChild(label);
    }

    el.addEventListener('click', () => togglePasser(id));
    list.appendChild(el);
  }
}

function renderRosterLabels() {
  const roster = document.getElementById('roster-labels');
  roster.innerHTML = '';
  for (const id of availablePassers(state.system)) {
    const row = document.createElement('label');
    row.className = 'roster-row';

    const role = SR.ROLES[id];
    const code = document.createElement('span');
    code.className = `roster-code ${role.cls}`;
    code.textContent = id;

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 10;
    input.value = state.playerLabels[id] || '';
    input.placeholder = role.tag;
    input.setAttribute('aria-label', `Custom label for ${role.tag}`);
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => {
      state.playerLabels[id] = input.value;
      renderPasserList();
      renderCourts();
      scheduleShareUrlSync();
    });

    row.appendChild(code);
    row.appendChild(input);
    roster.appendChild(row);
  }
}

function renderCourts() {
  if (Court.dismissUndoToast) Court.dismissUndoToast();
  const grid = document.getElementById('courts-grid');
  grid.innerHTML = '';
  for (const rot of state.rotations) {
    Court.renderCourtCard(grid, rot, {
      passerSet: state.passers,
      showSpotNumbers: state.showSpotNumbers,
      playerLabels: state.playerLabels,
      onPositionsChange: scheduleShareUrlSync
    });
  }
}

// ---- Exports ----

function svgToPngDataUrl(svgEl, scale = 2) {
  return new Promise((resolve, reject) => {
    const clone = svgEl.cloneNode(true);
    bakeStyles(clone, svgEl);
    const vb = svgEl.viewBox.baseVal;
    const px = 80; // pixels per court unit baseline
    const w = vb.width * px * scale;
    const h = vb.height * px * scale;
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const xml = new XMLSerializer().serializeToString(clone);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Wooden floor background — match court fill so corners blend
      ctx.fillStyle = '#c2884a';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;base64,' + svg64;
  });
}

// Copy computed styles onto inline attributes so the standalone SVG renders correctly.
function bakeStyles(clone, original) {
  const origNodes = original.querySelectorAll('*');
  const cloneNodes = clone.querySelectorAll('*');
  for (let i = 0; i < origNodes.length; i++) {
    const cs = getComputedStyle(origNodes[i]);
    const props = ['display', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];
    let style = '';
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (v) style += `${p}:${v};`;
    }
    cloneNodes[i].setAttribute('style', style);
  }
  // Bake background of svg
  const cs = getComputedStyle(original);
  const bg = cs.getPropertyValue('background-color');
  if (bg) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const vb = original.viewBox.baseVal;
    rect.setAttribute('x', vb.x);
    rect.setAttribute('y', vb.y);
    rect.setAttribute('width', vb.width);
    rect.setAttribute('height', vb.height);
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
  }
}

async function exportPNG() {
  // Combine all 6 courts side-by-side in a single PNG (3x2 grid).
  const cards = document.querySelectorAll('.court-card');
  const cells = [];
  for (const card of cards) {
    const svgEl = card.querySelector('svg');
    const title = card.querySelector('.court-title').textContent;
    const subEl = card.querySelector('.court-sub');
    const sub = subEl ? subEl.textContent : '';
    const url = await svgToPngDataUrl(svgEl, 1.5);
    cells.push({ url, title, sub });
  }
  const cellW = 600, cellH = 600, headerH = 56, gap = 16, pad = 24;
  const cols = 3, rows = 2;
  const totalW = pad * 2 + cellW * cols + gap * (cols - 1);
  const totalH = pad * 2 + (headerH + cellH) * rows + gap * (rows - 1);
  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1116';
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Serve Receive Builder', pad, pad + 24);
  ctx.fillStyle = '#8b949e';
  ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`System: ${state.system}    Passers: ${playerSummary([...state.passers])}`, pad, pad + 44);

  for (let i = 0; i < cells.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = pad + c * (cellW + gap);
    const y = pad + 60 + r * (cellH + headerH + gap);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(x, y, cellW, cellH + headerH);
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 18px -apple-system, sans-serif';
    ctx.fillText(cells[i].title, x + 14, y + 26);
    ctx.fillStyle = '#8b949e';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText(cells[i].sub, x + 14, y + 46);

    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = cells[i].url; });
    ctx.drawImage(img, x + 8, y + headerH, cellW - 16, cellH - 16);
  }

  const dataUrl = canvas.toDataURL('image/png');
  triggerDownload(dataUrl, `serve-receive-${state.system}-${state.passerCount}p.png`);
}

async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const cards = document.querySelectorAll('.court-card');
  const cells = [];
  for (const card of cards) {
    const svgEl = card.querySelector('svg');
    const title = card.querySelector('.court-title').textContent;
    const subEl = card.querySelector('.court-sub');
    const sub = subEl ? subEl.textContent : '';
    const url = await svgToPngDataUrl(svgEl, 2);
    cells.push({ url, title, sub });
  }
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const pad = 30, gap = 10;
  pdf.setFillColor(14, 17, 22);
  pdf.rect(0, 0, pageW, pageH, 'F');
  pdf.setTextColor(230, 237, 243);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Serve Receive Builder', pad, pad + 4);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(139, 148, 158);
  pdf.text(`System: ${state.system}    Passers: ${playerSummary([...state.passers])}`, pad, pad + 22);

  const cols = 3, rows = 2;
  const headerH = 22;
  const availW = pageW - pad * 2 - gap * (cols - 1);
  const availH = pageH - pad - 40 - gap * (rows - 1) - headerH * rows;
  const cellW = availW / cols;
  const cellH = availH / rows;

  for (let i = 0; i < cells.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = pad + c * (cellW + gap);
    const y = pad + 40 + r * (cellH + headerH + gap);
    pdf.setFillColor(22, 27, 34);
    pdf.rect(x, y, cellW, cellH + headerH, 'F');
    pdf.setTextColor(230, 237, 243);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(cells[i].title, x + 8, y + 14);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(139, 148, 158);
    pdf.text(cells[i].sub, x + 8, y + 26);

    const sz = Math.min(cellW, cellH) - 8;
    pdf.addImage(cells[i].url, 'PNG', x + (cellW - sz) / 2, y + headerH, sz, sz);
  }
  pdf.save(`serve-receive-${state.system}-${state.passerCount}p.pdf`);
}

function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---- Wire up ----

function init() {
  document.querySelectorAll('#system-toggle .seg-btn').forEach(b => {
    b.addEventListener('click', () => setSystem(b.dataset.value));
  });
  document.querySelectorAll('#passer-count .seg-btn').forEach(b => {
    b.addEventListener('click', () => setPasserCount(+b.dataset.value));
  });
  document.getElementById('export-png').addEventListener('click', exportPNG);
  document.getElementById('export-pdf').addEventListener('click', exportPDF);
  document.getElementById('reset-btn').addEventListener('click', () => rebuildAll());
  document.getElementById('copy-share-link').addEventListener('click', copyShareLink);
  document.getElementById('share-qr').addEventListener('click', toggleShareQr);
  document.getElementById('share-qr-close').addEventListener('click', closeShareQr);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeShareQr();
  });
  window.addEventListener('scroll', dismissSwipeCueOnHorizontalScroll, { passive: true });

  const hintsBox = document.getElementById('hints-toggle');
  hintsBox.addEventListener('change', () => {
    state.showHints = hintsBox.checked;
    applyHintVisibility();
    scheduleShareUrlSync();
  });

  const spotNumbersBox = document.getElementById('spot-numbers-toggle');
  spotNumbersBox.addEventListener('change', () => {
    state.showSpotNumbers = spotNumbersBox.checked;
    renderCourts();
    scheduleShareUrlSync();
  });

  const backrowMAsLBox = document.getElementById('backrow-m-as-l-toggle');
  backrowMAsLBox.addEventListener('change', () => {
    state.showBackrowMAsL = backrowMAsLBox.checked;
    rebuildAll();
  });

  const sharedState = loadSharedStateFromUrl();
  if (!sharedState.loaded) {
    state.passers = defaultPassers(state.system, state.passerCount);
  }
  rebuildAll({ positions: sharedState.positions, sync: false });
}

document.addEventListener('DOMContentLoaded', init);
