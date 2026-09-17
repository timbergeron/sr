// Image and PDF exports: all six rotations, a title block and a roster key.

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
let floorDataURLPromise = null;

// An SVG drawn as an image can't fetch anything, so the floor texture goes in as data.
function floorDataURL() {
  if (!floorDataURLPromise) {
    floorDataURLPromise = fetch(FLOOR_TEXTURE)
      .then(response => (response.ok ? response.blob() : Promise.reject(new Error('Floor texture unavailable'))))
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .catch(() => {
        floorDataURLPromise = null;
        return '';
      });
  }
  return floorDataURLPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = src;
  });
}

async function courtImage(index, size) {
  const svg = courtSVGString(index, { size, floorHref: await floorDataURL() });
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), type);
  });
}

// Touch devices get the share sheet, so the file can go straight to Photos, Files
// or a message. Everywhere else it downloads.
async function deliverFile(blob, filename) {
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (file && coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const letters = graphemes(text);
  while (letters.length > 1 && ctx.measureText(`${letters.join('')}…`).width > width) letters.pop();
  return `${letters.join('')}…`;
}

function wrapText(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function warningPrefix(count) {
  return count < 2 ? '⚠︎ ' : '';
}

// ---- Image: the screen's sheet, dark, with the real courts ----

async function exportImage() {
  const cell = 560;
  const header = 54;
  const gap = 18;
  const pad = 28;
  const width = pad * 2 + cell * 3 + gap * 2;
  const height = pad * 2 + 74 + (header + cell) * 2 + gap + 200;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const courtSize = cell - 24;
  const courts = await Promise.all(state.rotations.map((_, i) => courtImage(i, courtSize * scale)));

  ctx.fillStyle = '#0E1116';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#E6EDF3';
  ctx.font = `700 27px ${CHIP_FONT}`;
  ctx.fillText('Serve Receive Builder', pad, pad + 26);
  ctx.fillStyle = '#8B949E';
  ctx.font = `14px ${SYSTEM_FONT}`;
  ctx.fillText(`System ${state.system}   ·   Passers: ${receiverCountsSummary()}`, pad, pad + 50);

  const gridTop = pad + 74;
  state.rotations.forEach((rotation, i) => {
    const x = pad + (i % 3) * (cell + gap);
    const y = gridTop + Math.floor(i / 3) * (header + cell + gap);
    ctx.fillStyle = '#161B22';
    roundedRect(ctx, x, y, cell, cell + header, 14);
    ctx.fill();

    ctx.fillStyle = '#E6EDF3';
    ctx.font = `700 17px ${CHIP_FONT}`;
    const title = `Rotation ${i + 1}`;
    ctx.fillText(title, x + 14, y + 25);
    if (!isRotationLegal(i)) {
      ctx.font = `700 12px ${SYSTEM_FONT}`;
      ctx.fillText('⚠︎ OVERLAP', x + 14 + ctx.measureText(title).width + 30, y + 25);
    }
    const receiving = onCourtPasserCount(i);
    ctx.fillStyle = '#8B949E';
    ctx.font = `12px ${SYSTEM_FONT}`;
    ctx.fillText(`Setter: ${courtLabel(rotation.setter.setterId)} · ${warningPrefix(receiving)}${receiving} receiving`, x + 14, y + 43);

    const image = courts[i];
    const drawnHeight = courtSize * image.height / image.width;
    ctx.drawImage(image, x + 12, y + header + (courtSize - drawnHeight) / 2, courtSize, drawnHeight);
  });

  const keyTop = gridTop + (header + cell) * 2 + gap + 18;
  const roster = availablePassers();
  ctx.fillStyle = '#E6EDF3';
  ctx.font = `14px ${SYSTEM_FONT}`;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 2; column++) {
      const index = row * 2 + column;
      const text = index < roster.length ? `${roster[index]}: ${rosterLabel(roster[index])}` : 'Ring = passer';
      if (index > roster.length) continue;
      ctx.fillText(fitText(ctx, text, 835), pad + column * (835 + 18), keyTop + 14 + row * 25);
    }
  }

  await deliverFile(await canvasBlob(canvas, 'image/png'), `serve-receive-${state.system}.png`);
}

// ---- PDF: laid out for paper, at the size it prints ----

// The court as line art: black on white, discs outlined so a monochrome printer
// still separates them.
function drawPrintCourt(ctx, index, left, top, width, height) {
  const rotation = state.rotations[index];
  const unit = Math.min(width, height) / SR.COURT_W;
  const originX = left + (width - SR.COURT_W * unit) / 2;
  const originY = top + (height - SR.COURT_D * unit) / 2;
  const point = p => ({ x: originX + p.x * unit, y: originY + p.y * unit });

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(originX, originY, SR.COURT_W * unit, SR.COURT_D * unit);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(originX, originY + SR.ATTACK_LINE * unit);
  ctx.lineTo(originX + SR.COURT_W * unit, originY + SR.ATTACK_LINE * unit);
  ctx.stroke();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + SR.COURT_W * unit, originY);
  ctx.stroke();

  const radius = SR.PLAYER_R * unit;
  const passers = passerSetFor(index);
  for (const zone of POSITION_ZONES) {
    const centre = point(rotation.positions[zone]);
    const passer = SR.isSelectedPasser(occupantAt(rotation, zone), passers);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = passer ? 2 : 0.9;
    ctx.stroke();
    // Wider and greyer than on screen: a 26° arc on an 18pt disc blurs into the outline.
    const arcRadius = radius - radius * 2 * 0.17;
    const centreAngle = SR.ZONE_GEOM[zone].row === 'F' ? -Math.PI / 2 : Math.PI / 2;
    const half = 25 * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, arcRadius, centreAngle - half, centreAngle + half);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.70)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  const offsets = labelOffsets(rotation.positions, POSITION_ZONES, hasTwoLineLabels(rotation));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  for (const zone of POSITION_ZONES) {
    const centre = point(rotation.positions[zone]);
    const occ = occupantAt(rotation, zone);
    const role = SR.ROLES[occ.id].label;
    const text = courtLabel(occ.id);
    const showsRole = text !== role;
    const nudge = offsets[zone] || { dx: 0, dy: 0 };
    ctx.font = `600 ${Math.max(6, radius * 2 * chipFontFraction(text))}px ${SYSTEM_FONT}`;
    ctx.fillText(text, centre.x + nudge.dx * unit, centre.y + nudge.dy * unit - (showsRole ? radius * 0.24 : 0));
    if (showsRole) {
      ctx.font = `600 ${radius * 2 * ROLE_CHIP_FONT_FRACTION}px ${SYSTEM_FONT}`;
      ctx.fillText(role, centre.x + nudge.dx * unit,
        centre.y + nudge.dy * unit + radius * 0.46 - radius * 2 * roleLiftFraction(text));
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

async function exportPrintPDF() {
  if (!window.jspdf) throw new Error('PDF library unavailable');
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 30;
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = pageWidth * scale;
  canvas.height = pageHeight * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pageWidth, pageHeight);

  const roster = availablePassers().map(id => [id, rosterLabel(id)]);
  // Long roster entries need extra lines; take the room from the courts, not the type.
  const courtHeight = roster.some(([, text]) => graphemes(text).length > 32) ? 130 : 164;

  ctx.fillStyle = '#000';
  ctx.font = `700 17px ${SYSTEM_FONT}`;
  ctx.fillText(`Serve Receive — ${state.system}`, margin, margin + 16);
  ctx.font = `10px ${SYSTEM_FONT}`;
  ctx.fillStyle = 'rgba(60, 60, 67, 0.6)';
  const receiving = `Receiving · ${receiverCountsSummary()}`;
  ctx.fillText(receiving, margin, margin + 32);
  const flagged = rotationsNeedingAttention();
  if (flagged.length) {
    ctx.fillStyle = '#000';
    ctx.font = `600 10px ${SYSTEM_FONT}`;
    ctx.fillText(`⚠︎ Overlap in ${flagged.map(i => `R${i + 1}`).join(', ')}`, margin + ctx.measureText(receiving).width + 14, margin + 32);
  }

  const cellWidth = (pageWidth - margin * 2 - 24) / 3;
  const cellHeight = 13 + 3 + 11 + 3 + courtHeight;
  const gridTop = margin + 44;
  state.rotations.forEach((rotation, i) => {
    const x = margin + (i % 3) * (cellWidth + 12);
    const y = gridTop + Math.floor(i / 3) * (cellHeight + 10);
    ctx.fillStyle = '#000';
    ctx.font = `600 11px ${SYSTEM_FONT}`;
    ctx.fillText(`Rotation ${i + 1}`, x, y + 10);
    if (!isRotationLegal(i)) {
      ctx.font = `800 8px ${SYSTEM_FONT}`;
      const badge = '⚠︎ OVERLAP';
      const badgeWidth = ctx.measureText(badge).width + 6;
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = '#000';
      roundedRect(ctx, x + cellWidth - badgeWidth, y, badgeWidth, 11, 2);
      ctx.stroke();
      ctx.fillText(badge, x + cellWidth - badgeWidth + 3, y + 8.5);
    }
    const count = onCourtPasserCount(i);
    ctx.font = `9px ${SYSTEM_FONT}`;
    ctx.fillText(`Setter: ${courtLabel(rotation.setter.setterId)} · ${warningPrefix(count)}${count} receiving`, x, y + 24);
    drawPrintCourt(ctx, i, x, y + 30, cellWidth, courtHeight);
  });

  let keyTop = gridTop + cellHeight * 2 + 10 + 10;
  ctx.fillStyle = '#000';
  ctx.font = `9px ${SYSTEM_FONT}`;
  for (let row = 0; row < 4; row++) {
    let rowHeight = 11;
    for (let column = 0; column < 2; column++) {
      const index = row * 2 + column;
      if (index > roster.length) continue;
      const text = index < roster.length
        ? `${roster[index][0]}: ${roster[index][1] === SR.ROLES[roster[index][0]].label ? SR.ROLES[roster[index][0]].tag : roster[index][1]}`
        : 'Key · bold ring = passer · arc at the top of the disc = front row';
      const lines = wrapText(ctx, text, 354);
      lines.forEach((line, n) => ctx.fillText(line, margin + column * 366, keyTop + 8 + n * 11));
      rowHeight = Math.max(rowHeight, lines.length * 11);
    }
    keyTop += rowHeight + 4;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  // Without compression jsPDF stores the page as raw pixels: 17 MB instead of well under one.
  pdf.addImage(canvas, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  await deliverFile(pdf.output('blob'), `serve-receive-${state.system}.pdf`);
}
