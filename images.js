// Setup artwork and a source-coordinate crop editor, matching the native model.
const DEFAULT_WATERMARK_OPACITY = 0.16;
const MAX_PHOTO_ZOOM = 8;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

// Decode before hiding labels: a missing or damaged photo keeps its role visible.
// One entry per roster slot avoids retaining old full-size data URLs after edits.
const playerPhotoCache = new Map();
function playerPhotoEntry(id) {
  const data = state.images.players[id];
  if (!data) { playerPhotoCache.delete(id); return null; }
  if (playerPhotoCache.get(id)?.data === data) return playerPhotoCache.get(id);
  const entry = { data, image: new Image(), readable: false };
  playerPhotoCache.set(id, entry);
  entry.loaded = new Promise(resolve => {
    const finish = () => {
      entry.readable = entry.image.naturalWidth > 0;
      resolve();
      if (playerPhotoCache.get(id) === entry && state.images.players[id] === data) notifyStateChange();
    };
    entry.image.onload = finish;
    entry.image.onerror = finish;
    entry.image.src = data;
  });
  if (entry.image.complete) entry.readable = entry.image.naturalWidth > 0;
  return entry;
}

function playerPhoto(id) {
  const entry = playerPhotoEntry(id);
  return entry?.readable ? entry.data : null;
}

async function preparePlayerPhotos() {
  const entries = Object.keys(state.images.players).map(id => [id, playerPhotoEntry(id)]);
  await Promise.all(entries.map(([, entry]) => entry.loaded));
  return Object.fromEntries(entries.filter(([id, entry]) => entry.readable && state.images.players[id] === entry.data)
    .map(([id, entry]) => [id, entry.image]));
}

function clampedWatermarkOpacity(value) {
  return Number.isFinite(value) ? Math.min(0.4, Math.max(0, value)) : DEFAULT_WATERMARK_OPACITY;
}

function localImage(value) {
  return typeof value === 'string' && value.length <= MAX_IMAGE_BYTES * 1.4
    && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

function normalizedSetupImages(raw = {}) {
  raw = raw || {};
  const images = { players: {}, playerSources: {}, playerCrops: {}, teamLogo: localImage(raw.teamLogo),
    watermarkOpacity: clampedWatermarkOpacity(raw.watermarkOpacity) };
  for (const id of PLAYER_IDS) {
    const player = localImage(raw.players?.[id]);
    if (!player) continue;
    images.players[id] = player;
    const source = localImage(raw.playerSources?.[id]);
    if (!source) continue;
    images.playerSources[id] = source;
    const crop = raw.playerCrops?.[id] || {};
    images.playerCrops[id] = {
      centerX: Number.isFinite(crop.centerX) ? crop.centerX : 0.5,
      centerY: Number.isFinite(crop.centerY) ? crop.centerY : 0.5,
      zoom: Number.isFinite(crop.zoom) ? Math.min(MAX_PHOTO_ZOOM, Math.max(1, crop.zoom)) : 1
    };
  }
  return images;
}

function clampedPhotoCrop(crop = {}, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { centerX: 0.5, centerY: 0.5, zoom: 1 };
  }
  const zoom = Number.isFinite(crop.zoom) ? Math.min(MAX_PHOTO_ZOOM, Math.max(1, crop.zoom)) : 1;
  const edge = Math.min(width, height) / zoom;
  const halfX = edge / (2 * width), halfY = edge / (2 * height);
  return {
    centerX: Math.min(1 - halfX, Math.max(halfX, Number.isFinite(crop.centerX) ? crop.centerX : 0.5)),
    centerY: Math.min(1 - halfY, Math.max(halfY, Number.isFinite(crop.centerY) ? crop.centerY : 0.5)),
    zoom
  };
}

function photoCropRect(crop, width, height) {
  crop = clampedPhotoCrop(crop, width, height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const edge = Math.min(width, height) / crop.zoom;
  return { x: crop.centerX * width - edge / 2, y: crop.centerY * height - edge / 2, width: edge, height: edge };
}

function setPlayerImage(id, data, source = null, crop = {}) {
  if (!PLAYER_IDS.includes(id) || pendingImport) return;
  const images = { ...state.images, players: { ...state.images.players },
    playerSources: { ...state.images.playerSources }, playerCrops: { ...state.images.playerCrops } };
  const image = localImage(data);
  if (image) images.players[id] = image;
  else delete images.players[id];
  const original = image && localImage(source);
  if (original) {
    images.playerSources[id] = original;
    images.playerCrops[id] = { ...crop };
  } else {
    delete images.playerSources[id];
    delete images.playerCrops[id];
  }
  state.images = normalizedSetupImages(images);
  bumpShare();
}

function setTeamLogo(data) {
  if (pendingImport) return;
  state.images = { ...state.images, teamLogo: localImage(data) };
  bumpShare();
}

function setWatermarkOpacity(value, saving = true) {
  if (pendingImport) return;
  const opacity = clampedWatermarkOpacity(value);
  if (state.images.watermarkOpacity !== opacity) state.images = { ...state.images, watermarkOpacity: opacity };
  if (saving) persist();
  notifyStateChange();
}

// Re-encoding strips source metadata. PNG keeps transparent logos and photos.
function encodedCanvasImage(canvas, isLogo = false) {
  const ctx = canvas.getContext('2d');
  const pixels = isLogo ? null : ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = isLogo;
  if (pixels) {
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) { transparent = true; break; }
    }
  }
  return transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
}

async function normalizedImageFile(file, isLogo) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image smaller than 40 MB.');
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const maxSide = isLogo ? 768 : 2048;
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return encodedCanvasImage(canvas, isLogo);
  } catch (_) {
    throw new Error('This image couldn’t be opened. Try a JPEG, PNG or WebP image.');
  } finally { URL.revokeObjectURL(url); }
}

let imageRequest = null;
let photoDraft = null;
const photoPointers = new Map();
let photoGesture = null;

function imageEditContext(target) {
  return { target, setupID: library.currentID, document: dragContext,
    image: target === 'teamLogo' ? state.images.teamLogo : state.images.players[target] };
}

function imageEditIsCurrent(edit) {
  return edit && !pendingImport && edit.setupID === library.currentID && edit.document === dragContext
    && edit.image === (edit.target === 'teamLogo' ? state.images.teamLogo : state.images.players[edit.target]);
}

function renderImageButton(button, target) {
  const data = target === 'teamLogo' ? state.images.teamLogo : state.images.players[target];
  const title = target === 'teamLogo' ? (data ? 'Team logo' : 'Add team logo') : (data ? 'Photo' : 'Add photo');
  if (button.imageData !== data) {
    button.imageData = data;
    button.replaceChildren();
    if (data) {
      const thumbnail = element('img');
      thumbnail.src = data;
      thumbnail.alt = '';
      button.appendChild(thumbnail);
    }
    button.appendChild(element('span', '', title));
  } else if (!button.childElementCount) button.textContent = title;
  button.disabled = Boolean(pendingImport);
  button.setAttribute('aria-label', target === 'teamLogo' ? title : `${title} for ${SR.ROLES[target].tag}`);
  button.setAttribute('aria-haspopup', data ? 'menu' : 'false');
}

function renderImageControls() {
  renderImageButton($('team-logo-button'), 'teamLogo');
  $('watermark-opacity').value = state.images.watermarkOpacity;
  $('watermark-opacity').disabled = Boolean(pendingImport) || !state.images.teamLogo;
  $('watermark-opacity-value').textContent = `${Math.round(state.images.watermarkOpacity * 100)}%`;
  if (photoDraft && !imageEditIsCurrent(photoDraft.edit)) $('photo-editor').close('');
}

function openImageMenu(button, target) {
  if (pendingImport) return;
  const data = target === 'teamLogo' ? state.images.teamLogo : state.images.players[target];
  if (!data) { chooseSetupImage(target); return; }
  const edit = imageEditContext(target);
  const items = [];
  if (target !== 'teamLogo') items.push({ label: 'Adjust crop', action: () => {
    if (imageEditIsCurrent(edit)) editPlayerPhoto(edit);
  } });
  items.push({ label: target === 'teamLogo' ? 'Change team logo' : 'Change photo', action: () => {
    if (imageEditIsCurrent(edit)) chooseSetupImage(target);
  } });
  items.push({ label: target === 'teamLogo' ? 'Remove team logo' : 'Remove photo', destructive: true, action: () => {
    if (!imageEditIsCurrent(edit)) return;
    if (target === 'teamLogo') setTeamLogo(null);
    else setPlayerImage(target, null);
  } });
  openMenu(button, items);
}

function chooseSetupImage(target) {
  imageRequest = imageEditContext(target);
  $('setup-image-input').value = '';
  $('setup-image-input').click();
}

async function editPlayerPhoto(edit, source = null) {
  try {
    const storedSource = state.images.playerSources[edit.target];
    const initialCrop = source ? {} : storedSource ? state.images.playerCrops[edit.target] : {};
    source = source || storedSource || state.images.players[edit.target];
    const image = await loadImage(source);
    if (!imageEditIsCurrent(edit)) return;
    photoDraft = { edit, source, image,
      crop: clampedPhotoCrop(initialCrop, image.naturalWidth, image.naturalHeight) };
    $('photo-source').src = source;
    $('photo-error').hidden = true;
    $('photo-editor').showModal();
    paintPhotoCrop();
  } catch (_) { if (imageEditIsCurrent(edit)) showToast('Photo unavailable. Choose another image.'); }
}

function paintPhotoCrop() {
  if (!photoDraft) return;
  const { image } = photoDraft;
  const crop = photoDraft.crop = clampedPhotoCrop(photoDraft.crop, image.naturalWidth, image.naturalHeight);
  const side = $('photo-viewport').clientWidth;
  const scale = side / Math.min(image.naturalWidth, image.naturalHeight) * crop.zoom;
  const img = $('photo-source');
  img.style.width = `${image.naturalWidth * scale}px`;
  img.style.height = `${image.naturalHeight * scale}px`;
  img.style.left = `${side / 2 - crop.centerX * image.naturalWidth * scale}px`;
  img.style.top = `${side / 2 - crop.centerY * image.naturalHeight * scale}px`;
  $('photo-zoom').value = crop.zoom;
  $('photo-zoom-value').textContent = `${crop.zoom.toFixed(1)}×`;
  $('photo-viewport').setAttribute('aria-label', `Photo crop, ${crop.zoom.toFixed(1)} times zoom`);
}

function photoPointerGeometry() {
  const pointers = [...photoPointers.values()].slice(0, 2);
  if (!pointers.length) return null;
  const rect = $('photo-viewport').getBoundingClientRect();
  return { x: pointers.reduce((n, p) => n + p.x, 0) / pointers.length - rect.left,
    y: pointers.reduce((n, p) => n + p.y, 0) / pointers.length - rect.top,
    distance: pointers.length === 2 ? Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y) : 0 };
}

function beginPhotoGesture() {
  const geometry = photoPointerGeometry();
  photoGesture = geometry && photoDraft ? { ...geometry, crop: { ...photoDraft.crop } } : null;
}

function movePhotoGesture() {
  if (!photoDraft || !photoGesture) return;
  const geometry = photoPointerGeometry();
  if (!geometry) return;
  const { image } = photoDraft, start = photoGesture;
  const side = $('photo-viewport').clientWidth;
  const zoom = Math.min(MAX_PHOTO_ZOOM, Math.max(1, start.crop.zoom * (start.distance > 0 ? geometry.distance / start.distance : 1)));
  const base = side / Math.min(image.naturalWidth, image.naturalHeight);
  // Keep the source point under the gesture midpoint anchored while pinching.
  const anchorX = start.crop.centerX * image.naturalWidth + (start.x - side / 2) / (base * start.crop.zoom);
  const anchorY = start.crop.centerY * image.naturalHeight + (start.y - side / 2) / (base * start.crop.zoom);
  photoDraft.crop = { centerX: (anchorX - (geometry.x - side / 2) / (base * zoom)) / image.naturalWidth,
    centerY: (anchorY - (geometry.y - side / 2) / (base * zoom)) / image.naturalHeight, zoom };
  paintPhotoCrop();
}

function wireImageControls() {
  $('team-logo-button').addEventListener('click', () => openImageMenu($('team-logo-button'), 'teamLogo'));
  $('watermark-opacity').addEventListener('input', event => setWatermarkOpacity(Number(event.target.value), false));
  $('watermark-opacity').addEventListener('change', event => setWatermarkOpacity(Number(event.target.value)));
  $('setup-image-input').addEventListener('change', async event => {
    const file = event.target.files[0], edit = imageRequest;
    if (!file || !imageEditIsCurrent(edit)) return;
    try {
      const source = await normalizedImageFile(file, edit.target === 'teamLogo');
      if (imageRequest !== edit || !imageEditIsCurrent(edit)) return;
      if (edit.target === 'teamLogo') setTeamLogo(source);
      else await editPlayerPhoto(edit, source);
    } catch (error) { if (imageEditIsCurrent(edit)) showToast(error.message); }
  });
  const dialog = $('photo-editor'), viewport = $('photo-viewport');
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close('');
  });
  dialog.addEventListener('close', () => { photoDraft = null; photoPointers.clear(); photoGesture = null; });
  $('photo-editor-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!photoDraft || !imageEditIsCurrent(photoDraft.edit)) { dialog.close(''); return; }
    try {
      const { image, crop, source, edit } = photoDraft;
      const rect = photoCropRect(crop, image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      canvas.getContext('2d').drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, 512, 512);
      setPlayerImage(edit.target, encodedCanvasImage(canvas), source, crop);
      dialog.close('');
    } catch (_) {
      $('photo-error').textContent = 'Photo couldn’t be saved. Try another image.';
      $('photo-error').hidden = false;
    }
  });
  $('photo-zoom').addEventListener('input', event => {
    if (!photoDraft) return;
    photoDraft.crop.zoom = Number(event.target.value); paintPhotoCrop();
  });
  $('photo-reset').addEventListener('click', () => {
    if (!photoDraft) return;
    photoDraft.crop = {}; paintPhotoCrop();
  });
  viewport.addEventListener('pointerdown', event => {
    if (!photoDraft || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); viewport.focus();
    viewport.setPointerCapture(event.pointerId);
    photoPointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); beginPhotoGesture();
  });
  viewport.addEventListener('pointermove', event => {
    if (!photoPointers.has(event.pointerId)) return;
    event.preventDefault();
    photoPointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); movePhotoGesture();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, event => {
    photoPointers.delete(event.pointerId); beginPhotoGesture();
  });
  viewport.addEventListener('keydown', event => {
    if (!photoDraft) return;
    const directions = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    const { image, crop } = photoDraft, edge = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom;
    crop.centerX += delta[0] * edge / image.naturalWidth;
    crop.centerY += delta[1] * edge / image.naturalHeight;
    paintPhotoCrop();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(paintPhotoCrop).observe(viewport);
}
