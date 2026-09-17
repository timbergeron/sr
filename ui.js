// Page layout and controls. After every state change the page redraws from state.

const ui = {
  rotation: 0,
  // { rotation, zone } — which player, in which rotation.
  selection: null,
  zoneView: new Set(),
  courts: [],
  cards: [],
  selectionTimer: 0,
  scrollTimer: 0,
  noticeTimer: 0,
  noticeKey: '',
  documentKey: '',
  importKey: null,
  menuButton: null,
  pendingSystem: null,
  newSetupSystem: '5-1',
  newSetupStyle: 'smart',
  hasInteracted: false
};

const STYLE_DETAILS = {
  smart: 'Start with O1, O2 and L passing. Use the coached receive formations for 5-1, or automatic receiver lanes and setter placement for 6-2.',
  courtPosition: 'Place each player in their standard rotation zone, with three at the front and three at the back.'
};
const ROTATION_PREFERENCE = 'serve-receive.rotation';
const INTERACTED_PREFERENCE = 'serve-receive.hasInteracted';

const $ = id => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isPhone() {
  return window.matchMedia('(max-width: 759px)').matches;
}

function isDocked() {
  return window.matchMedia('(min-width: 1100px)').matches;
}

function readPreference(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writePreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_) {
    // A remembered rotation is a convenience; losing it is harmless.
  }
}

function roleVariable(id) {
  return `var(--role-${SR.ROLES[id].cls})`;
}

// Rebuilding a control must not throw keyboard focus back to the page.
function keepingFocus(container, rebuild) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.focusKey : null;
  rebuild();
  if (key) {
    const again = container.querySelector(`[data-focus-key="${key}"]`);
    if (again) again.focus();
  }
}

// ---- Startup ----

function initPage() {
  ui.rotation = Math.min(5, Math.max(0, Number(readPreference(ROTATION_PREFERENCE)) || 0));
  ui.hasInteracted = readPreference(INTERACTED_PREFERENCE) === 'true';
  startApp();
  buildCourts();
  buildLegend();
  wireControls();
  onStateChange(render);
  openLinkFromAddressBar();
  render();
  scrollToRotation(ui.rotation, false);
}

function openLinkFromAddressBar() {
  if (!hasShareHash(window.location.hash)) return;
  const payload = payloadFromText(window.location.hash);
  if (!payload) {
    clearAddressLink();
    showToast('That link couldn’t be opened. Check that the whole link was copied.');
    return;
  }
  stageImport(payload);
}

function clearAddressLink() {
  if (!window.location.hash) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ---- Rendering ----

function render() {
  const setup = currentSetup();
  const documentKey = `${setup ? setup.id : ''}|${state.system}|${pendingImport ? 'import' : ''}`;
  if (ui.documentKey !== documentKey) {
    ui.documentKey = documentKey;
    ui.selection = null;
  }
  document.body.classList.toggle('is-previewing', Boolean(pendingImport));
  $('recovery').hidden = persistenceIssue !== 'unreadableLibrary';

  renderToolbar();
  renderSaveBanners();
  renderImportPreview();
  renderRoster();
  renderSystemControls();
  renderPasserSection();
  renderFormationSection();
  renderDisplaySection();
  renderRotationSelector();
  renderPasserBar();
  renderStatusStrip();
  renderCards();
  renderNotices();
  $('drag-hint').hidden = ui.hasInteracted || Boolean(pendingImport);
}

function renderToolbar() {
  $('setup-name').textContent = pendingImport ? 'Shared formation' : currentSetupName();
  $('setup-system').textContent = state.system;
  $('setup-button').setAttribute('aria-label', `Setup, ${currentSetupName()}, ${state.system}`);
}

function renderSaveBanners() {
  for (const banner of document.querySelectorAll('[data-save-banner]')) {
    banner.hidden = persistenceIssue !== 'saveFailed';
    if (banner.hidden || banner.childElementCount) continue;
    banner.innerHTML = `<strong><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Changes couldn’t be saved</strong>
      <p>Keep this page open. Retry saving or export a backup of all your setups.</p>
      <div class="banner-actions">
        <button class="text-button" type="button" data-action="retry-save">Retry saving</button>
        <button class="text-button" type="button" data-action="export-backup">Export backup</button>
      </div>`;
  }
}

function renderImportPreview() {
  const panel = $('import-preview');
  panel.hidden = !pendingImport;
  if (!pendingImport) {
    ui.importKey = null;
    return;
  }
  if (ui.importKey !== pendingImport) {
    ui.importKey = pendingImport;
    $('import-name').value = pendingImport.suggestedName;
  }
  const named = Object.keys(cleanedPlayerLabels()).length;
  const roster = named ? `${named} named player${named === 1 ? '' : 's'}` : 'no player names';
  $('import-summary').textContent = `${state.system}, ${receiverCountsSummary()}, ${roster}. `
    + `Saving keeps “${currentSetupName()}” exactly as it is.`;
}

// ---- Team ----

function renderRoster() {
  const roster = $('roster');
  const ids = availablePassers();
  if (roster.dataset.ids !== ids.join()) {
    roster.dataset.ids = ids.join();
    roster.replaceChildren(...ids.map(buildRosterRow));
  }
  for (const row of roster.children) {
    const id = row.dataset.id;
    const name = row.querySelector('[data-field="name"]');
    const number = row.querySelector('[data-field="number"]');
    if (document.activeElement !== name) name.value = String(state.playerLabels[id] || '').toUpperCase();
    if (document.activeElement !== number) number.value = state.playerNumbers[id] || '';
    const preview = row.querySelector('.roster-preview');
    preview.hidden = !hasCustomLabel(id) && !state.playerNumbers[id];
    preview.querySelector('.preview-name').textContent = label(id);
    preview.setAttribute('aria-label', `${label(id)}, ${SR.ROLES[id].label}`);
  }
}

function buildRosterRow(id) {
  const role = SR.ROLES[id];
  const row = element('div', 'roster-row');
  row.dataset.id = id;
  row.style.setProperty('--role', roleVariable(id));

  const badge = element('span', 'role-badge', id);
  badge.setAttribute('aria-hidden', 'true');

  const fields = element('div', 'roster-fields');
  const nameField = element('div', 'name-field');
  const name = element('input');
  name.type = 'text';
  name.dataset.field = 'name';
  name.placeholder = 'Short name';
  name.autocomplete = 'off';
  name.spellcheck = false;
  name.setAttribute('autocapitalize', 'characters');
  name.setAttribute('aria-label', `Short name, ${role.tag}`);
  name.setAttribute('aria-describedby', `count-${id}`);
  const count = element('span', 'name-count');
  count.id = `count-${id}`;
  count.hidden = true;
  count.setAttribute('aria-live', 'polite');
  nameField.append(name, count);

  const numberField = element('label', 'number-field');
  const number = element('input');
  number.type = 'text';
  number.dataset.field = 'number';
  number.inputMode = 'numeric';
  number.maxLength = 2;
  number.placeholder = 'Optional';
  number.autocomplete = 'off';
  number.setAttribute('aria-label', `Jersey number, ${role.tag}`);
  numberField.append(element('span', '', 'Number'), number);
  fields.append(nameField, numberField);

  const preview = element('span', 'roster-preview');
  preview.setAttribute('role', 'img');
  preview.append(element('span', 'preview-name'), element('span', 'preview-role', role.label));

  let limitTimer = 0;
  const showCount = limited => {
    const letters = graphemes(name.value).length;
    count.hidden = document.activeElement !== name;
    count.textContent = limited ? `${MAX_NAME_ENTRY_LENGTH} character max` : `${letters}/${MAX_NAME_ENTRY_LENGTH}`;
  };
  const accept = () => {
    const letters = graphemes(name.value.toUpperCase());
    const over = letters.length > MAX_NAME_ENTRY_LENGTH;
    const capped = letters.slice(0, MAX_NAME_ENTRY_LENGTH).join('');
    if (capped !== name.value) name.value = capped;
    setPlayerLabel(id, capped);
    window.clearTimeout(limitTimer);
    showCount(over);
    if (over) limitTimer = window.setTimeout(() => showCount(false), 1000);
  };
  name.addEventListener('input', event => {
    if (!event.isComposing) accept();
  });
  name.addEventListener('compositionend', accept);
  name.addEventListener('focus', () => showCount(false));
  name.addEventListener('blur', () => { count.hidden = true; });
  name.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      number.focus();
    }
  });
  number.addEventListener('input', () => {
    const digits = normalizedNumber(number.value);
    if (digits !== number.value) number.value = digits;
    setPlayerNumber(id, digits);
  });
  number.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const next = row.nextElementSibling;
    if (next) next.querySelector('[data-field="name"]').focus();
    else number.blur();
  });

  row.append(badge, fields, preview);
  return row;
}

// ---- System ----

function renderSystemControls() {
  for (const control of document.querySelectorAll('[data-system-control]')) {
    if (!control.childElementCount) {
      for (const system of ['5-1', '6-2']) {
        const button = element('button', 'segment', system);
        button.type = 'button';
        button.dataset.value = system;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => requestSystem(system));
        control.appendChild(button);
      }
    }
    for (const button of control.children) {
      button.setAttribute('aria-checked', String(button.dataset.value === state.system));
      button.disabled = Boolean(pendingImport);
    }
  }
}

// A different system regenerates every position, so hand-placed work is asked about first.
function requestSystem(system) {
  if (system === state.system || pendingImport) return;
  const placed = handPlacedCount();
  if (!placed) {
    setSystem(system);
    return;
  }
  ui.pendingSystem = system;
  $('system-dialog-title').textContent = `Switch to ${system}?`;
  $('system-dialog-message').textContent = `A different system puts different players in each spot, so all six formations are rearranged — including the ${placed} player${placed === 1 ? '' : 's'} you placed by hand. You can undo it.`;
  $('system-dialog').showModal();
}

// ---- Passers ----

function passerChip(option, index, { size = 44, showName = false } = {}) {
  const displayId = option.displayId;
  const selected = passerSetFor(index).has(option.id);
  const enabled = canTogglePasser(option.id, index) && !pendingImport;
  const button = element('button', 'passer-chip');
  button.type = 'button';
  button.dataset.focusKey = `passer-${option.id}`;
  button.style.setProperty('--chip', `${size}px`);
  button.style.setProperty('--role', roleVariable(displayId));
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', hasCustomLabel(displayId)
    ? `${SR.ROLES[displayId].tag}, ${label(displayId)}` : SR.ROLES[displayId].tag);
  button.title = enabled ? `Changes only rotation ${index + 1}` : 'Deselect a receiver to add another';
  button.disabled = !enabled;

  const ring = element('span', 'chip-ring');
  const disc = element('span', 'chip-disc');
  const text = courtLabel(displayId);
  const name = element('span', `chip-name${graphemes(text).length <= 2 ? ' number' : ''}`, text);
  disc.appendChild(name);
  if (text !== SR.ROLES[displayId].label) disc.appendChild(element('span', 'chip-role', SR.ROLES[displayId].label));
  ring.appendChild(disc);
  button.appendChild(ring);
  if (showName && hasCustomLabel(displayId)) button.appendChild(element('span', 'chip-caption', label(displayId)));
  button.addEventListener('click', () => togglePasser(option.id, index));
  return button;
}

function summaryLine(summary, container) {
  const icon = summary.tone === 'problem' ? 'fa-triangle-exclamation' : 'fa-user-group';
  container.className = `receiving-summary tone-${summary.tone}`;
  container.innerHTML = '';
  const glyph = element('i', `fa-solid ${icon}`);
  glyph.setAttribute('aria-hidden', 'true');
  const text = element('span', '', summary.count);
  text.style.fontWeight = '500';
  container.append(glyph, text);
  if (summary.detail) container.append(element('span', '', `· ${summary.detail}`));
}

function renderPasserSection() {
  const index = ui.rotation;
  const countControl = $('passer-count');
  const here = onCourtPasserCount(index);
  keepingFocus(countControl, () => {
    countControl.replaceChildren(...[0, 1, 2, 3, 4, 5, 6].map(n => {
      const button = element('button', 'segment', String(n));
      button.type = 'button';
      button.dataset.focusKey = `count-${n}`;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(n === here));
      button.disabled = Boolean(pendingImport);
      button.addEventListener('click', () => setPasserCount(n, ui.rotation));
      return button;
    }));
  });
  const grid = $('passer-grid');
  keepingFocus(grid, () => {
    grid.replaceChildren(...passerOptions(index).map(option => passerChip(option, index, { showName: true })));
  });
  summaryLine(receivingSummary(index), $('passer-summary'));
  $('passers-heading').textContent = `Passers in R${index + 1}`;
  $('passer-footnote').textContent = `Choose who receives in R${index + 1}. Other rotations keep their own selections. The white outline on court marks a passer.`;
}

function renderPasserBar() {
  const bar = $('passer-bar');
  const index = ui.rotation;
  const summary = receivingSummary(index);
  keepingFocus(bar, () => {
    const header = element('div', 'passer-bar-header');
    header.append(
      element('strong', '', isPhone() ? 'Passers' : `Passers in R${index + 1}`),
      element('span', `tone-${summary.tone}`, summary.count)
    );
    const row = element('div', 'passer-row');
    row.append(...passerOptions(index, false).map(option => passerChip(option, index)));
    bar.replaceChildren(header, row);
    if (summary.detail) {
      const note = element('p', `note tone-${summary.tone}`);
      const icon = element('i', `fa-solid ${summary.tone === 'problem' ? 'fa-triangle-exclamation' : 'fa-circle-info'}`);
      icon.setAttribute('aria-hidden', 'true');
      note.append(icon, element('span', '', summary.detail));
      bar.appendChild(note);
    }
  });
}

// ---- Formation and display ----

function renderFormationSection() {
  $('auto-arrange-label').textContent = `Auto-arrange rotation ${ui.rotation + 1}`;
  const placed = handPlacedCount();
  $('formation-footnote').textContent = placed === 0
    ? 'Players are where the overlap rules suggest. Drag anyone to move them; changing who receives leaves them where you put them.'
    : `You’ve placed ${placed} player${placed === 1 ? '' : 's'} by hand. They stay where you put them — auto-arrange asks for the suggestion back. Both are undoable.`;
}

function renderDisplaySection() {
  $('hints-toggle').checked = state.showHints;
  $('spot-numbers-toggle').checked = state.showSpotNumbers;
  $('backrow-label').value = state.showBackrowMAsL ? 'libero' : 'middle';
}

function buildLegend() {
  const legend = $('legend');
  const roles = [['S', 'Setter'], ['O1', 'Outside Hitter'], ['M1', 'Middle Blocker'], ['OP', 'Opposite'], ['L', 'Libero']];
  for (const [id, name] of roles) {
    const item = element('li');
    const swatch = element('span', 'swatch');
    swatch.style.setProperty('--role', roleVariable(id));
    item.append(swatch, element('span', '', name));
    legend.appendChild(item);
  }
  const badges = [
    ['passer', { isPasser: true, row: null }, 'Passer (white outline)'],
    ['front', { isPasser: false, row: 'F' }, 'Front row (arc towards the net)'],
    ['back', { isPasser: false, row: 'B' }, 'Back row (arc towards the endline)']
  ];
  for (const [key, options, text] of badges) {
    const item = element('li');
    const id = `legend-${key}`;
    const player = { family: 'oh', isIllegal: false, isSelected: false, isDragging: false, overlapsNeighbour: false, scale: 1, ...options };
    item.innerHTML = `<svg viewBox="-0.7 -0.7 1.4 1.4" aria-hidden="true">${courtDefsMarkup(id)}<circle r="0.7" fill="${COURT_COLORS.floor}"/>${badgeMarkup(id, player, 0.03)}</svg>`;
    item.appendChild(element('span', '', text));
    legend.appendChild(item);
  }
}

// ---- Rotations ----

function setRotation(index, { scroll = true } = {}) {
  const next = Math.min(5, Math.max(0, index));
  if (next !== ui.rotation) {
    ui.rotation = next;
    writePreference(ROTATION_PREFERENCE, String(next));
    if (ui.selection && ui.selection.rotation !== next) ui.selection = null;
  }
  render();
  if (scroll) scrollToRotation(next, true);
}

function renderRotationSelector() {
  const selector = $('rotation-selector');
  if (!selector.childElementCount) {
    for (let i = 0; i < 6; i++) {
      const button = element('button', 'rotation-button');
      button.type = 'button';
      button.dataset.index = i;
      button.addEventListener('click', () => setRotation(i));
      selector.appendChild(button);
    }
  }
  Array.from(selector.children).forEach((button, i) => {
    const legal = isRotationLegal(i);
    button.innerHTML = `R${i + 1}${legal ? '' : '<i class="fa-solid fa-triangle-exclamation flag" aria-hidden="true"></i>'}`;
    button.setAttribute('aria-current', String(i === ui.rotation));
    button.setAttribute('aria-label', legal ? `Rotation ${i + 1}` : `Rotation ${i + 1}, overlap violation`);
  });
}

function renderStatusStrip() {
  const strip = $('status-strip');
  const index = ui.rotation;
  const rotation = state.rotations[index];
  strip.replaceChildren();
  if (!rotation) return;
  // A 5-1 has one setter, so naming them adds nothing.
  if (state.system !== '5-1') {
    strip.appendChild(element('span', 'setter-label', `Setter: ${label(rotation.setter.setterId)}`));
  }
  const needing = rotationsNeedingAttention();
  if (!isRotationLegal(index)) {
    const button = element('button', 'overlap-link here');
    button.type = 'button';
    button.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Overlap here <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
    button.setAttribute('aria-label', 'This rotation has an overlap. Select the player to move.');
    button.addEventListener('click', () => selectProblem(index));
    strip.appendChild(button);
  } else if (needing.length) {
    const button = element('button', 'overlap-link elsewhere');
    button.type = 'button';
    button.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Overlap in ${rotationNames(needing)} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>`;
    button.addEventListener('click', () => selectProblem(needing[0]));
    strip.appendChild(button);
  }
}

function selectProblem(index) {
  const zone = problemZone(index);
  ui.rotation = index;
  writePreference(ROTATION_PREFERENCE, String(index));
  ui.selection = zone ? { rotation: index, zone } : null;
  restartSelectionTimer();
  render();
  scrollToRotation(index, true);
}

// ---- Courts ----

function buildCourts() {
  const inner = element('div', 'courts-inner');
  $('courts').appendChild(inner);
  for (let i = 0; i < 6; i++) {
    const card = element('article', 'court-card');
    card.dataset.index = i;

    const head = element('div', 'card-head');
    const title = element('button', 'card-title');
    title.type = 'button';
    const heading = element('strong');
    const setter = element('span', 'card-meta');
    const receiving = element('span', 'card-meta');
    title.append(heading, setter, receiving);
    title.addEventListener('click', () => setRotation(i));
    const flag = element('button', 'card-flag');
    flag.type = 'button';
    flag.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
    flag.setAttribute('aria-label', `Show overlap in rotation ${i + 1}`);
    flag.addEventListener('click', () => selectProblem(i));
    head.append(title, flag);

    const zoneRow = element('label', 'switch-row plain card-zone');
    const zoneInput = element('input');
    zoneInput.type = 'checkbox';
    zoneInput.setAttribute('role', 'switch');
    zoneInput.setAttribute('aria-label', `Position Zone View for rotation ${i + 1}`);
    zoneInput.addEventListener('change', () => setZoneView(i, zoneInput.checked));
    const switchTrack = element('span', 'switch');
    switchTrack.setAttribute('aria-hidden', 'true');
    zoneRow.append(element('span', '', 'Position Zone View'), zoneInput, switchTrack);

    const court = createCourt({
      index: i,
      watermark: true,
      interactive: () => !pendingImport && persistenceIssue !== 'unreadableLibrary',
      zoneView: () => ui.zoneView.has(i),
      selectedZone: () => (ui.selection && ui.selection.rotation === i ? ui.selection.zone : null),
      activate: () => {
        if (ui.rotation !== i) {
          ui.rotation = i;
          writePreference(ROTATION_PREFERENCE, String(i));
        }
      },
      select: zone => selectPlayer(i, zone),
      interactionEnded: () => restartSelectionTimer()
    });
    const frame = element('div', 'court-frame');
    frame.appendChild(court.element);
    card.append(head, zoneRow, frame);
    inner.appendChild(card);
    ui.cards.push({ card, heading, setter, receiving, flag, zoneInput });
    ui.courts.push(court);
  }

  inner.addEventListener('scroll', () => {
    if (!isPhone()) return;
    window.clearTimeout(ui.scrollTimer);
    ui.scrollTimer = window.setTimeout(() => {
      const index = Math.round(inner.scrollLeft / Math.max(1, inner.clientWidth));
      if (index !== ui.rotation) setRotation(index, { scroll: false });
    }, 90);
  }, { passive: true });
}

function scrollToRotation(index, animated) {
  if (!isPhone()) return;
  const inner = document.querySelector('.courts-inner');
  if (!inner) return;
  const left = index * inner.clientWidth;
  if (Math.abs(inner.scrollLeft - left) < 2) return;
  const smooth = animated && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  inner.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
}

function renderCards() {
  const phone = isPhone();
  ui.cards.forEach((parts, i) => {
    const rotation = state.rotations[i];
    if (!rotation) return;
    const active = i === ui.rotation;
    parts.card.classList.toggle('is-active', active && !phone);
    parts.card.setAttribute('aria-label', `Rotation ${i + 1}`);
    parts.heading.textContent = active ? `R${i + 1} · Active` : `Rotation ${i + 1}`;
    parts.setter.hidden = state.system === '5-1';
    parts.setter.textContent = `Setter: ${label(rotation.setter.setterId)}`;
    const receiving = onCourtPasserCount(i);
    parts.receiving.textContent = `${receiving} receiving`;
    parts.receiving.classList.toggle('problem', receiving < 2);
    parts.flag.hidden = isRotationLegal(i);
    parts.zoneInput.checked = ui.zoneView.has(i);
    ui.courts[i].update();
  });
  $('phone-zone-toggle').checked = ui.zoneView.has(ui.rotation);
}

function setZoneView(index, enabled) {
  if (enabled) ui.zoneView.add(index);
  else ui.zoneView.delete(index);
  if (ui.selection && ui.selection.rotation === index) ui.selection = null;
  render();
}

function selectPlayer(index, zone) {
  if (zone === null) {
    if (ui.selection && ui.selection.rotation === index) ui.selection = null;
  } else {
    ui.selection = { rotation: index, zone };
    markInteracted();
  }
  restartSelectionTimer();
  render();
}

// The halo and guide lines clear after three seconds without activity.
function restartSelectionTimer() {
  window.clearTimeout(ui.selectionTimer);
  if (!ui.selection) return;
  ui.selectionTimer = window.setTimeout(() => {
    const court = ui.selection && ui.courts[ui.selection.rotation];
    if (court && court.isDragging()) {
      restartSelectionTimer();
      return;
    }
    ui.selection = null;
    render();
  }, 3000);
}

function markInteracted() {
  if (ui.hasInteracted) return;
  ui.hasInteracted = true;
  writePreference(INTERACTED_PREFERENCE, 'true');
}

// ---- Notices ----

function renderNotices() {
  const notices = $('notices');
  const rearrangement = lastRearrangement;
  const undoable = canUndoRearrangement();
  const undoNotice = lastUndo;
  const key = JSON.stringify([rearrangement && rearrangement.id, undoable, undoNotice && undoNotice.id, ui.rotation]);
  if (key === ui.noticeKey) return;
  ui.noticeKey = key;
  notices.replaceChildren();

  if (undoNotice) {
    const notice = element('div', 'notice');
    notice.setAttribute('role', 'status');
    notice.appendChild(element('span', '', undoNotice.text));
    if (undoNotice.rotation !== null && undoNotice.rotation !== ui.rotation) {
      const view = element('button', 'text-button', `View R${undoNotice.rotation + 1}`);
      view.type = 'button';
      view.addEventListener('click', () => setRotation(undoNotice.rotation));
      notice.appendChild(view);
    }
    const dismiss = element('button', 'text-button', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', clearUndoNotice);
    notice.appendChild(dismiss);
    notices.appendChild(notice);
  }

  window.clearTimeout(ui.noticeTimer);
  if (rearrangement) {
    const notice = element('div', 'notice');
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>';
    notice.appendChild(element('span', '', rearrangement.what));
    if (undoable) {
      const button = element('button', 'text-button', 'Undo');
      button.type = 'button';
      button.addEventListener('click', () => {
        undo();
        clearRearrangement();
      });
      notice.appendChild(button);
    }
    notices.appendChild(notice);
    // Long enough to read and act on, short enough not to linger.
    ui.noticeTimer = window.setTimeout(() => {
      if (lastRearrangement === rearrangement) clearRearrangement();
    }, 5000);
  }
}

let toastTimer = 0;

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

// ---- Menus ----

function openMenu(button, items, align = 'end') {
  const menu = $('menu');
  if (ui.menuButton === button) {
    closeMenu(true);
    return;
  }
  closeMenu(false);
  menu.replaceChildren();
  for (const item of items) {
    if (item.divider) {
      menu.appendChild(element('div', 'menu-divider'));
    } else if (item.section) {
      menu.appendChild(element('div', 'menu-section', item.section));
    } else {
      const entry = element('button', `menu-item${item.destructive ? ' destructive' : ''}`);
      entry.type = 'button';
      entry.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
      if (item.checked !== undefined) entry.setAttribute('aria-checked', String(item.checked));
      entry.disabled = Boolean(item.disabled);
      if (item.title) entry.title = item.title;
      if (item.icon) {
        const icon = element('i', item.icon);
        icon.setAttribute('aria-hidden', 'true');
        entry.appendChild(icon);
      }
      entry.appendChild(element('span', 'item-label', item.label));
      if (item.checked) {
        const check = element('i', 'fa-solid fa-check check');
        check.setAttribute('aria-hidden', 'true');
        entry.appendChild(check);
      }
      entry.addEventListener('click', () => {
        closeMenu(false);
        item.action();
      });
      menu.appendChild(entry);
    }
  }
  menu.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const left = align === 'start' ? rect.left : rect.right - width;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  button.setAttribute('aria-expanded', 'true');
  ui.menuButton = button;
  const first = menu.querySelector('.menu-item:not(:disabled)');
  if (first) first.focus();
}

function closeMenu(restoreFocus) {
  const menu = $('menu');
  if (menu.hidden) return;
  menu.hidden = true;
  if (ui.menuButton) {
    ui.menuButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) ui.menuButton.focus();
  }
  ui.menuButton = null;
}

function setupMenuItems() {
  return [
    ...library.setups.map(setup => ({
      label: setup.name,
      checked: setup.id === (currentSetup() || {}).id,
      action: () => switchToSetup(setup.id)
    })),
    { divider: true },
    { label: 'New Setup…', icon: 'fa-solid fa-plus', action: openNewSetup },
    { label: 'Duplicate', icon: 'fa-regular fa-clone', action: duplicateCurrentSetup },
    { label: 'Rename…', icon: 'fa-solid fa-pen', action: openRename },
    {
      label: 'Delete…', icon: 'fa-regular fa-trash-can', destructive: true,
      disabled: library.setups.length < 2, action: openDelete
    }
  ];
}

function editMenuItems() {
  const index = ui.rotation;
  return [
    { label: 'Undo', icon: 'fa-solid fa-arrow-rotate-left', disabled: !canUndo(), title: undoActionLabel(), action: undo },
    { section: `Rotation ${index + 1}` },
    { label: 'Reset', icon: 'fa-solid fa-arrows-rotate', title: `Restore standard court positions in rotation ${index + 1}`, action: () => resetCourt(ui.rotation) },
    { label: 'Smart Arrange', icon: 'fa-solid fa-wand-magic-sparkles', title: `Arrange rotation ${index + 1} using its selected passers`, action: () => smartArrange(ui.rotation) }
  ];
}

function shareMenuItems() {
  return [
    { label: 'Copy link', icon: 'fa-solid fa-link', action: copyShareLink },
    { label: 'Show QR code', icon: 'fa-solid fa-qrcode', action: openQRCode },
    { label: 'Export image', icon: 'fa-regular fa-image', action: () => runExport(exportImage) },
    { label: 'Export PDF for printing', icon: 'fa-solid fa-print', action: () => runExport(exportPrintPDF) },
    { divider: true },
    { label: 'Open a shared link…', icon: 'fa-regular fa-clipboard', action: openLinkDialog }
  ];
}

// ---- Settings sheet ----

function openSettings() {
  document.body.classList.add('settings-open');
  $('scrim').hidden = false;
  $('settings-done').focus();
}

function closeSettings() {
  if (!document.body.classList.contains('settings-open')) return;
  document.body.classList.remove('settings-open');
  $('scrim').hidden = true;
  if (!isDocked()) $('team-button').focus();
}

// ---- Dialogs ----

function wireDialog(dialog, onConfirm) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close('');
    if (event.target.closest('[data-close]')) dialog.close('');
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue && dialog.returnValue !== 'cancel') onConfirm(dialog.returnValue);
    dialog.returnValue = '';
  });
}

function renderNewSetupChoices() {
  for (const button of $('new-setup-system').children) {
    button.setAttribute('aria-checked', String(button.dataset.value === ui.newSetupSystem));
  }
  for (const button of $('new-setup-style').children) {
    button.setAttribute('aria-checked', String(button.dataset.value === ui.newSetupStyle));
  }
  $('new-setup-style-detail').textContent = STYLE_DETAILS[ui.newSetupStyle];
}

function openNewSetup() {
  ui.newSetupSystem = '5-1';
  ui.newSetupStyle = 'smart';
  $('new-setup-name').value = '';
  renderNewSetupChoices();
  $('new-setup-dialog').showModal();
  $('new-setup-name').focus();
}

function openRename() {
  $('rename-name').value = currentSetupName();
  $('rename-dialog').showModal();
  $('rename-name').select();
}

function openDelete() {
  $('delete-title').textContent = `Delete “${currentSetupName()}”?`;
  $('delete-dialog').showModal();
}

function openLinkDialog() {
  $('open-link-input').value = '';
  $('open-link-error').hidden = true;
  $('open-link-dialog').showModal();
  $('open-link-input').focus();
}

function openQRCode() {
  const container = $('qr-code');
  const status = $('qr-status');
  container.replaceChildren();
  status.textContent = '';
  container.hidden = false;
  if (typeof window.QRCode !== 'function') {
    container.hidden = true;
    status.textContent = 'The QR code isn’t available. Copy the link instead.';
  } else {
    try {
      new window.QRCode(container, {
        text: currentShareHref(),
        width: 208,
        height: 208,
        colorDark: '#0e1116',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (_) {
      container.hidden = true;
      status.textContent = 'This setup is too large for a QR code. Copy the link instead.';
    }
  }
  $('qr-dialog').showModal();
}

// ---- Actions ----

async function copyShareLink() {
  const href = currentShareHref();
  try {
    await navigator.clipboard.writeText(href);
    showToast('Link copied');
  } catch (_) {
    const field = element('textarea');
    field.value = href;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    showToast(copied ? 'Link copied' : 'Copy failed. Use Show QR code instead.');
  }
}

async function runExport(exporter) {
  showToast('Preparing export…');
  try {
    await exporter();
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    showToast('The export couldn’t be created. Try again.');
  }
}

function downloadBackup() {
  const blob = new Blob([backupText()], { type: 'application/json' });
  deliverFile(blob, 'Serve Receive setups.json');
}

function handleAction(action) {
  const actions = {
    'copy-link': copyShareLink,
    'show-qr': openQRCode,
    'export-png': () => runExport(exportImage),
    'export-pdf': () => runExport(exportPrintPDF),
    'open-link': openLinkDialog,
    'auto-arrange': () => autoArrange(ui.rotation),
    'auto-arrange-all': autoArrangeAll,
    'retry-save': retryPersistence,
    'export-backup': downloadBackup
  };
  if (!actions[action]) return;
  if (!isDocked() && ['show-qr', 'export-png', 'export-pdf', 'open-link'].includes(action)) closeSettings();
  actions[action]();
}

function isTyping(target) {
  return target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function wireControls() {
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-action]');
    if (trigger) handleAction(trigger.dataset.action);
  });
  document.addEventListener('pointerdown', event => {
    if (ui.menuButton && !event.target.closest('#menu') && !event.target.closest('[aria-haspopup="menu"]')) closeMenu(false);
  });
  document.addEventListener('keydown', event => {
    const menu = $('menu');
    if (!menu.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      const items = Array.from(menu.querySelectorAll('.menu-item:not(:disabled)'));
      const index = items.indexOf(document.activeElement);
      const next = items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      if (next) next.focus();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (!menu.hidden) closeMenu(true);
      else if (document.body.classList.contains('settings-open')) closeSettings();
      else if (ui.selection) selectPlayer(ui.selection.rotation, null);
      return;
    }
    const openDialog = document.querySelector('dialog[open]');
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
        && !isTyping(event.target) && !openDialog && !pendingImport) {
      event.preventDefault();
      undo();
    }
  });

  $('setup-button').addEventListener('click', () => openMenu($('setup-button'), setupMenuItems(), 'start'));
  $('edit-button').addEventListener('click', () => openMenu($('edit-button'), editMenuItems()));
  $('share-button').addEventListener('click', () => openMenu($('share-button'), shareMenuItems()));
  $('team-button').addEventListener('click', openSettings);
  $('settings-done').addEventListener('click', closeSettings);
  $('scrim').addEventListener('click', closeSettings);
  window.addEventListener('resize', () => closeMenu(false));

  $('hints-toggle').addEventListener('change', event => setShowHints(event.target.checked));
  $('spot-numbers-toggle').addEventListener('change', event => setShowSpotNumbers(event.target.checked));
  $('backrow-label').addEventListener('change', event => setShowBackrowMAsL(event.target.value === 'libero'));
  $('phone-zone-toggle').addEventListener('change', event => setZoneView(ui.rotation, event.target.checked));

  $('import-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('import-name').value.trim();
    if (!name) return;
    saveImportAsNewSetup(name);
    clearAddressLink();
    showToast(`Saved “${currentSetupName()}”`);
  });
  $('import-cancel').addEventListener('click', () => {
    discardImport();
    clearAddressLink();
  });
  window.addEventListener('hashchange', openLinkFromAddressBar);

  for (const group of ['new-setup-system', 'new-setup-style']) {
    $(group).addEventListener('click', event => {
      const button = event.target.closest('.segment');
      if (!button) return;
      if (group === 'new-setup-system') ui.newSetupSystem = button.dataset.value;
      else ui.newSetupStyle = button.dataset.value;
      renderNewSetupChoices();
    });
  }
  wireDialog($('new-setup-dialog'), () => {
    newSetup($('new-setup-name').value.trim() || 'New formation', ui.newSetupSystem, ui.newSetupStyle);
  });
  wireDialog($('rename-dialog'), () => renameCurrentSetup($('rename-name').value));
  wireDialog($('delete-dialog'), deleteCurrentSetup);
  wireDialog($('system-dialog'), () => {
    if (ui.pendingSystem) setSystem(ui.pendingSystem);
    ui.pendingSystem = null;
  });
  wireDialog($('qr-dialog'), () => {});
  wireDialog($('open-link-dialog'), () => {});
  $('open-link-form').addEventListener('submit', event => {
    const payload = payloadFromText($('open-link-input').value);
    event.preventDefault();
    if (!payload) {
      $('open-link-error').hidden = false;
      return;
    }
    $('open-link-dialog').close('');
    stageImport(payload);
  });

  const phoneQuery = window.matchMedia('(max-width: 759px)');
  const onLayoutChange = () => {
    closeSettings();
    render();
    scrollToRotation(ui.rotation, false);
  };
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', onLayoutChange);
  window.matchMedia('(min-width: 1100px)').addEventListener?.('change', onLayoutChange);
}
