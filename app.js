// State and UI wiring.

const state = {
  system: '5-1',          // '5-1' or '6-2'
  passerCount: 3,
  passers: new Set(['L', 'O1', 'O2']), // canonical position ids ('L' for libero)
  rotations: []           // 6 rotation data objects
};

// All possible passer ids for each system. L is always available (libero).
function availablePassers(system) {
  if (system === '5-1') return ['S', 'O1', 'O2', 'M1', 'M2', 'OP', 'L'];
  return ['S1', 'S2', 'O1', 'O2', 'M1', 'M2', 'L'];
}

// Default passers when system or count changes
function defaultPassers(system, count) {
  // Prefer L, then OHs, then other backrow players. Cap at count.
  const order = system === '5-1'
    ? ['L', 'O1', 'O2', 'M1', 'M2', 'OP', 'S']
    : ['L', 'O1', 'O2', 'M1', 'M2', 'S1', 'S2'];
  return new Set(order.slice(0, count));
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
  if (state.passers.size > n) {
    // trim from least-priority end
    const order = state.system === '5-1'
      ? ['S', 'OP', 'M1', 'M2', 'O2', 'O1', 'L']
      : ['S1', 'S2', 'M1', 'M2', 'O2', 'O1', 'L'];
    const arr = [...state.passers];
    arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    state.passers = new Set(arr.slice(arr.length - n));
  } else if (state.passers.size < n) {
    // top up with defaults not already in
    const order = state.system === '5-1'
      ? ['L', 'O1', 'O2', 'M1', 'M2', 'OP', 'S']
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
    if (state.passers.size <= 2) return; // minimum 2 passers
    state.passers.delete(id);
    state.passerCount = state.passers.size;
  } else {
    if (state.passers.size >= state.passerCount) {
      // Remove the oldest non-libero passer to make room
      for (const existing of state.passers) {
        if (existing !== 'L') {
          state.passers.delete(existing);
          break;
        }
      }
    }
    state.passers.add(id);
  }
  rebuildAll();
}

function rebuildAll() {
  state.rotations = [];
  for (let i = 0; i < 6; i++) {
    state.rotations.push(SR.buildRotation(state.system, i, state.passers));
  }
  renderControls();
  renderCourts();
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
  // Passer checkboxes
  const list = document.getElementById('passer-list');
  list.innerHTML = '';
  for (const id of availablePassers(state.system)) {
    const el = document.createElement('div');
    el.className = 'passer-check';
    if (state.passers.has(id)) el.classList.add('active');
    el.textContent = id;
    el.addEventListener('click', () => togglePasser(id));
    list.appendChild(el);
  }
  const warn = document.getElementById('passer-warn');
  warn.textContent = state.passers.size === state.passerCount
    ? ''
    : `Selected ${state.passers.size} of ${state.passerCount}`;
}

function renderCourts() {
  const grid = document.getElementById('courts-grid');
  grid.innerHTML = '';
  for (const rot of state.rotations) {
    Court.renderCourtCard(grid, rot, { passerSet: state.passers });
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
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];
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
    const sub = card.querySelector('.court-sub').textContent;
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
  ctx.fillText(`System: ${state.system}    Passers: ${[...state.passers].join(', ')}`, pad, pad + 44);

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
    const sub = card.querySelector('.court-sub').textContent;
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
  pdf.text(`System: ${state.system}    Passers: ${[...state.passers].join(', ')}`, pad, pad + 22);

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
  document.getElementById('reset-btn').addEventListener('click', rebuildAll);

  const hintsBox = document.getElementById('hints-toggle');
  const applyHints = () => document.body.classList.toggle('hide-hints', !hintsBox.checked);
  hintsBox.addEventListener('change', applyHints);
  applyHints();

  // Initial defaults
  state.passers = defaultPassers(state.system, state.passerCount);
  rebuildAll();
}

document.addEventListener('DOMContentLoaded', init);
