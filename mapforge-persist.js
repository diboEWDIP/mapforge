// Extracted from index.html in the 2026-08 restructure (Stage 0.5).
// Classic script — shares the app's global lexical scope; load order matters.
// ── Save / Resume / Auto-save ────────────────────────────────────────────────
// A "project" is the full editable state: the base map reference plus every
// annotation. Library maps are stored by path (tiny); uploaded/cropped maps are
// stored as a data URL so they survive a reload. Named saves + the autosave slot
// both live in localStorage; projects can also be downloaded to / opened from disk.

const AUTOSAVE_KEY  = 'mapforge:autosave';
const SAVES_KEY     = 'mapforge:saves';
const PROJECT_TAG   = 'mapforge';
const CROP_HANDOFF_KEY = 'mapforge_pending_crop';

// Describe the current base map in a form that round-trips through JSON.
function baseMapDescriptor() {
  if (baseMode === 'live' && mlMap) {
    const c = mlMap.getCenter();
    return {
      kind: 'maplibre',
      space: 'geo',                                    // annotations carry lng/lat
      view: { center: [c.lng, c.lat], zoom: mlMap.getZoom() },   // last editing view
      frame: mlFrame,                                  // print viewport (may be null)
      toggles: MLB.getToggleState(),
      fillable: true,
    };
  }
  const src = currentMapSrc || '';
  if (/^data:/.test(src)) return { kind: 'data', data: src, fillable: currentMapFillable };
  if (/^blob:/.test(src)) {
    // A blob: URL won't survive a reload — bake the loaded image into a data URL.
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { kind: 'data', data: c.toDataURL('image/png'), fillable: currentMapFillable };
  }
  return { kind: 'path', src: currentMapSrc, fillable: currentMapFillable };
}

const SIZE_FIELDS = ['size', 'iconSize', 'radius', 'width'];   // backing px at runtime, document px on disk

function serializeProject() {
  const project = {
    app: PROJECT_TAG, version: 3, savedAt: Date.now(),   // v3 = document-unit sizes
    docUnits: true,
    map: baseMapDescriptor(),
    stamps,                              // plain serializable objects
    textBoxes: textBoxes.map(snapshotTB),
    tbIdCounter,
    title: { text: mapTitle, subtitle: mapSubtitle, layerOn: titleLayerOn, xPct: titleBoxXPct, yPct: titleBoxYPct,
             frameOn: titleFrameOn },
    key: {
      placement:     keyPlacement,
      layerOn:       keyLayerOn,
      frameOn:       keyFrameOn,
      lineStyle:     keyLineStyle,
      manualEntries: keyManualEntries,
      suppressed:    [...keySuppressedTypes],
      customLabels:  { ...keyCustomLabels },
      onmap: { collapsed: onmapKeyCollapsed, xPct: onmapKeyXPct,
               yPct: onmapKeyYPct, widthPx: onmapKeyWidthPx, cols: onmapKeyCols },
    },
  };
  // Return a true snapshot — `stamps`/`keyManualEntries` above are live arrays, so
  // without this a later resetAnnotations() would mutate an already-returned object.
  const clone = JSON.parse(JSON.stringify(project));
  clone.stamps.forEach(s => {
    delete s._hidden;      // transient render flags, not document state
    delete s._vecRetried;
    // Runtime sizes are backing px of THIS device; the file stores document
    // px (1/96 inch) so a save prints identically on any machine.
    SIZE_FIELDS.forEach(f => { if (typeof s[f] === 'number') s[f] = s[f] / devicePixelRatio; });
  });
  return clone;
}

// Re-create the on-canvas state from a serialized project. Runs from img.onload,
// after the base map has sized the canvas and resetAnnotations() has cleared it.
function applyRestoredState(data) {
  restoring = true;
  markLiveRasterDirty();
  try {
    stamps.length = 0;
    (data.stamps || []).forEach(s => {
      // v3 files store document px; runtime works in this device's backing px.
      // (Migrated v2 files have docUnits:false — legacy passthrough.)
      if (data.docUnits) SIZE_FIELDS.forEach(f => { if (typeof s[f] === 'number') s[f] = s[f] * devicePixelRatio; });
      stamps.push(s);
    });
    selectedArrowIdx = null;
    selectedStampIdx = null;

    textBoxes.slice().forEach(tb => tb.el.remove());
    textBoxes.length = 0;
    tbIdCounter = 0;
    (data.textBoxes || []).forEach(t => createTextBox(t.xPct, t.yPct, t, true));
    if (typeof data.tbIdCounter === 'number') tbIdCounter = Math.max(tbIdCounter, data.tbIdCounter);
    selectedTB = null;

    const ti = data.title || {};
    mapTitle = ti.text || '';
    titleLayerOn = ti.layerOn !== false;
    mapSubtitle = ti.subtitle || '';
    if (typeof ti.xPct === 'number') titleBoxXPct = ti.xPct;
    if (typeof ti.yPct === 'number') titleBoxYPct = ti.yPct;
    titleFrameOn = ti.frameOn !== false;   // missing (old saves) → frame on
    updateTitleBox();

    const k = data.key || {};
    keyFrameOn = k.frameOn !== false;      // missing (old saves) → frame on
    keyManualEntries.length = 0;
    (k.manualEntries || []).forEach(e => keyManualEntries.push(e));
    keySuppressedTypes.clear();
    (k.suppressed || []).forEach(t => keySuppressedTypes.add(t));
    Object.keys(keyCustomLabels).forEach(key => delete keyCustomLabels[key]);
    Object.assign(keyCustomLabels, k.customLabels || {});
    if (k.lineStyle) keyLineStyle = k.lineStyle;

    const om = k.onmap || {};
    if (typeof om.xPct    === 'number') onmapKeyXPct      = om.xPct;
    if (typeof om.yPct    === 'number') onmapKeyYPct      = om.yPct;
    if (typeof om.widthPx === 'number') onmapKeyWidthPx = om.widthPx;
    onmapKeyCols = om.cols || 0;
    onmapKeyCollapsed = !!om.collapsed;

    setKeyPlacement(k.placement || 'onmap');
    // Re-apply the collapsed visual (setKeyPlacement always expands the body)
    if (keyPlacement === 'onmap' && onmapKeyCollapsed) {
      onmapKeyBody.style.display     = 'none';
    keyLayerOn = (data.key && data.key.layerOn) !== false;
      onmapKeyResizeEl.style.display = 'none';
      document.getElementById('onmap-key-collapse').textContent = '▸';
    }
  } finally {
    restoring = false;
  }
  setTimeout(markProjectSaved, 0);   // restored state == its save: not dirty
}

// Load a project: point the base map at its source; img.onload applies the rest.
// Migrate a serialized project to the current schema. Dispatches on `version`
// (written since v1 but never previously read). Every schema change from here on
// adds a branch — students' saved .mapforge files and autosaves flow through this.
function migrateProject(data) {
  if (!data) return data;
  const v = data.version || 1;
  if (v === 2) {
    // v2 -> v3: sizes gain document units, but a v2 file's sizes are backing
    // px of an UNKNOWN device — pass them through numerically (docUnits stays
    // false) so old projects render exactly as they always did here.
    data.version = 3;
    data.docUnits = false;
  }
  if (v === 1) {
    // v1 -> v2: live-map annotations moved from pixel space to geo space.
    // v1 live saves (dev-era only) carry pixel coords + a frozen-view
    // descriptor; restoreLiveMap() geo-anchors any stamp still missing geo
    // after restoring the saved view (approximate for v1 — the old frozen
    // container size can't be reproduced exactly). PNG-map projects are
    // unchanged between v1 and v2.
    data.version = 2;
    data = migrateProject(data);   // chain v1→v2→v3
  }
  return data;
}

function restoreProject(data) {
  data = migrateProject(data);
  if (!data || !data.map) { alert('That file is not a valid MapForge map.'); return; }
  pendingRestore = data;
  const m = data.map;
  if (m.kind === 'maplibre') { restoreLiveMap(m); return; }
  loadMap(m.kind === 'data' ? m.data : m.src, !!m.fillable);
}

// Rebuild a saved live-map base: recreate the frozen frame, jump to the saved
// view, re-apply toggles, wait for tiles, then lock and apply the annotations.
async function restoreLiveMap(m) {
  resetAnnotations();
  baseMode = 'live';
  mlLocked = false;
  currentMapSrc = null;
  currentFrameInset = 0;
  document.body.classList.add('live-base');
  sizeLiveLayout();                        // free layout; annotations are geo-anchored
  if (!mlMap) { mlMap = MLB.create(document.getElementById('ml-map')); mlRevealOnIdle(); }
  else { MLB.unlockView(mlMap); mlMap.resize(); }
  if (!mlMap._geoWired) { wireGeoRenderLoop(); mlMap._geoWired = true; }
  const v = m.view || {};
  mlMap.jumpTo({ center: v.center || [-98.5, 39.8], zoom: v.zoom || 3 });
  await MLB.awaitIdle(mlMap);              // style + tiles ready
  if (m.toggles) MLB.applyToggleState(mlMap, m.toggles);
  await MLB.awaitIdle(mlMap);              // toggles repainted
  mlFrame = m.frame || null;
  const mc = mlMap.getCanvas();
  canvas.width  = mc.width;
  canvas.height = mc.height;
  shadeTmpCanvas = document.createElement('canvas');
  shadeTmpCanvas.width  = canvas.width;
  shadeTmpCanvas.height = canvas.height;
  fillCanvas = document.createElement('canvas');
  fillCanvas.width  = canvas.width;
  fillCanvas.height = canvas.height;
  currentMapFillable = true;
  const fillBtn = document.getElementById('btn-fill');
  if (fillBtn) { fillBtn.style.display = ''; fillBtn.style.opacity = ''; }
  await refreshLiveSnapshot();
  if (pendingRestore) {
    const d = pendingRestore; pendingRestore = null;
    applyRestoredState(d);                 // img.onload never fires in this path
  }
  // Saved annotations carry geo — derive their pixels for the current view.
  // v1 (pixel-era) leftovers: geo-anchor anything still missing geo at the
  // restored view. Approximate — the old frozen container size can't be
  // reproduced — but v1 live saves only ever existed during development.
  for (const s of stamps) {
    if (s.lng === undefined && s.geoPoints === undefined && s.geo === undefined) geoSyncStamp(s);
  }
  for (const tb of textBoxes) { if (tb.lng === undefined) geoSyncTextBox(tb); }
  reprojectStamps();
  reprojectTextBoxes();
  if (mlFrame) enterFrameLock();   // framed projects reopen locked to the frame
  updateMapNav();
  lmSyncPills();
  fitCanvas();
  redraw();
  dismissStartScreen();
}

// ── Auto-save ──
let _autosaveTimer = null;
// Discreet "Saved" confirmation so autosave is visible, not an act of faith.
let _savedFlashT = null;
function flashSaved() {
  let el = document.getElementById('saved-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'saved-flash';
    el.textContent = 'Saved \u2713';
    el.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:60;' +
      'font:600 11px/1 Jost,Georgia,serif;color:#FAF5EA;background:rgba(42,31,14,.85);' +
      'padding:5px 10px;border-radius:999px;opacity:0;transition:opacity .25s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  clearTimeout(_savedFlashT);
  _savedFlashT = setTimeout(() => { el.style.opacity = '0'; }, 1200);
}

function scheduleAutosave() {
  if (restoring || !hasBase()) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(doAutosave, 1000);
}
function doAutosave() {
  if (!hasBase()) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject()));
    refreshCurrentSaveThumb();             // keep the saved-map card's face live
    const warn = document.getElementById('autosave-warn');
    if (warn) warn.remove();               // storage recovered — clear the alert
    flashSaved();
  }
  catch (e) {
    // Quota exceeded (usually a large uploaded base map): tell the student
    // instead of silently not saving — this exact silence cost real work.
    let el = document.getElementById('autosave-warn');
    if (!el) {
      el = document.createElement('div');
      el.id = 'autosave-warn';
      el.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:60;' +
        'font:600 11px/1.4 Jost,Georgia,serif;color:#FAF5EA;background:rgba(140,40,20,.92);' +
        'padding:6px 12px;border-radius:8px;max-width:300px;';
      el.textContent = 'Auto-save failed — browser storage is full (large uploaded map?). ' +
        'Use "Save to File…" so you don\'t lose your work.';
      document.body.appendChild(el);
    }
  }
}

// ── Named browser saves ──
function loadSavesIndex() {
  try { return JSON.parse(localStorage.getItem(SAVES_KEY)) || []; }
  catch (e) { return []; }
}
function writeSavesIndex(arr) { localStorage.setItem(SAVES_KEY, JSON.stringify(arr)); }

// makeSaveThumb lives in mapforge-export.js — it reuses the export-preview
// compositor so saved-map thumbnails match what an export would look like.

// The named save this session is working on (last saved or opened) — its
// thumbnail is refreshed on every autosave so the saved-maps cards stay live.
let _currentSaveName = null;
function refreshCurrentSaveThumb() {
  if (!_currentSaveName || typeof makeSaveThumbAsync !== 'function') return;
  const name = _currentSaveName;
  makeSaveThumbAsync(thumb => {
    if (typeof _expProgress === 'function') _expProgress(null);
    if (!thumb) return;
    const saves = loadSavesIndex();
    const i = saves.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (i === -1) return;
    saves[i].thumb = thumb;
    try { writeSavesIndex(saves); } catch (e) { return; }
    renderSavesList();
    if (typeof renderHomeSavesPanel === 'function') renderHomeSavesPanel();
  });
}

function saveCurrentProject() {
  if (!hasBase()) { flashSaveStatus('Load a map first.'); return; }
  // Same progress treatment as exporting (live maps render a fresh thumbnail
  // asynchronously — visible feedback until it lands). Cleared by the thumb
  // callback; bounded fallback so it can never stick.
  if (typeof _expProgress === 'function') {
    _expProgress('Saving map…');
    clearTimeout(saveCurrentProject._pt);
    saveCurrentProject._pt = setTimeout(() => _expProgress(null), 4000);
  }
  const input = document.getElementById('save-name-input');
  const name  = (input.value || '').trim() || mapTitle || 'Untitled map';
  const data  = serializeProject();
  const saves = loadSavesIndex();
  const i     = saves.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
  const entry = { name, savedAt: data.savedAt, thumb: makeSaveThumb(), data };
  if (i !== -1) {
    if (!confirm(`A saved map named "${name}" already exists. Overwrite it?`)) {
      if (typeof _expProgress === 'function') _expProgress(null);
      return;
    }
    saves[i] = entry;
  } else {
    saves.push(entry);
  }
  try { writeSavesIndex(saves); }
  catch (e) {
    if (typeof _expProgress === 'function') _expProgress(null);
    flashSaveStatus('Browser storage is full — use “Save to File…” instead.');
    return;
  }
  renderSavesList();
  if (typeof renderHomeSavesPanel === 'function') renderHomeSavesPanel();
  _currentSaveName = name;
  refreshCurrentSaveThumb();     // live maps: redo the thumb from a fresh GL frame
  markProjectSaved();
  flashSaveStatus(`Saved “${name}.”`);
}

function loadSavedProject(idx) {
  const saves = loadSavesIndex();
  const entry = saves[idx];
  if (!entry) return;
  if (hasUnsavedWork() && !confirm('Open this saved map? Your current annotations will be replaced.')) return;
  closeSavesModal();
  _currentSaveName = entry.name;
  restoreProject(entry.data);
}

function deleteSavedProject(idx) {
  const saves = loadSavesIndex();
  const entry = saves[idx];
  if (!entry) return;
  if (!confirm(`Delete saved map “${entry.name}”? This cannot be undone.`)) return;
  saves.splice(idx, 1);
  writeSavesIndex(saves);
  renderSavesList();
}

// Dirty tracking: a map counts as "unsaved work" only if it has annotations
// AND its state differs from the last save (browser save, file save, or the
// save it was opened from). Saving clears the prompt until the next edit.
let _savedSig = null;
function _projSig() {
  try { const d = serializeProject(); delete d.savedAt; return JSON.stringify(d); }
  catch (e) { return null; }
}
function markProjectSaved() { _savedSig = _projSig(); }
function hasUnsavedWork() {
  if (stamps.length === 0 && textBoxes.length === 0) return false;
  return _savedSig === null || _savedSig !== _projSig();
}

function flashSaveStatus(msg) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(flashSaveStatus._t);
  flashSaveStatus._t = setTimeout(() => { el.textContent = ''; }, 3500);
}

function fmtSavedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
         ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderSavesList() {
  const ul = document.getElementById('saves-list');
  ul.innerHTML = '';
  const saves = loadSavesIndex()
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.savedAt || 0) - (a.s.savedAt || 0));
  saves.forEach(({ s, i }) => {
    const li = document.createElement('li');
    li.className = 'save-item';
    if (s.thumb) {
      const im = document.createElement('img');
      im.className = 'save-item-thumb'; im.src = s.thumb; im.alt = '';
      li.appendChild(im);
    }
    const info = document.createElement('div');
    info.className = 'save-item-info';
    const nm = document.createElement('div');
    nm.className = 'save-item-name'; nm.textContent = s.name;
    const dt = document.createElement('div');
    dt.className = 'save-item-date'; dt.textContent = fmtSavedAt(s.savedAt);
    info.appendChild(nm); info.appendChild(dt);
    const open = document.createElement('button');
    open.className = 'save-item-btn'; open.textContent = 'Open';
    open.onclick = () => loadSavedProject(i);
    const del = document.createElement('button');
    del.className = 'save-item-btn danger'; del.textContent = 'Delete';
    del.onclick = () => deleteSavedProject(i);
    li.appendChild(info); li.appendChild(open); li.appendChild(del);
    ul.appendChild(li);
  });
}

// ── File download / open (no storage limit; best for custom base maps) ──
function downloadProjectFile() {
  if (!hasBase()) { flashSaveStatus('Load a map first.'); return; }
  const data = serializeProject();
  const base = (mapTitle || 'My Map').replace(/[^\w\- ]+/g, '').trim() || 'My Map';
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = base + '.mapforge';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markProjectSaved();
  flashSaveStatus(`Saved “${base}.mapforge” to your downloads.`);
}

function openProjectFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { alert('Could not read that file — it is not a valid MapForge map.'); return; }
    if (data.app !== PROJECT_TAG &&
        !confirm('This file may not be a MapForge map. Try to open it anyway?')) return;
    if (hasUnsavedWork() && !confirm('Open this map? Your current annotations will be replaced.')) return;
    closeSavesModal();
    restoreProject(data);
  };
  reader.readAsText(file);
  input.value = '';
}

// Home-page saved-maps panel: same index as the Save/Open modal, click to open.
function renderHomeSavesPanel() {
  const wrap = document.getElementById('ss-saves');
  const ul   = document.getElementById('ss-saves-list');
  if (!wrap || !ul) return;
  const saves = loadSavesIndex()
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.savedAt || 0) - (a.s.savedAt || 0));
  ul.innerHTML = '';
  if (!saves.length) { wrap.style.display = 'none'; return; }
  saves.forEach(({ s, i }) => {
    const li = document.createElement('li');
    li.className = 'ss-save-item';
    li.title = 'Open this saved map';
    li.onclick = () => loadSavedProject(i);
    if (s.thumb) {
      const im = document.createElement('img');
      im.className = 'ss-save-thumb'; im.src = s.thumb; im.alt = '';
      li.appendChild(im);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ss-save-thumb ss-save-thumb-empty';
      li.appendChild(ph);
    }
    const nm = document.createElement('span');
    nm.className = 'ss-save-name'; nm.textContent = s.name;
    const dt = document.createElement('span');
    dt.className = 'ss-save-date'; dt.textContent = fmtSavedAt(s.savedAt);
    li.appendChild(nm); li.appendChild(dt);
    ul.appendChild(li);
  });
  wrap.style.display = '';
}

// ── Modal open/close ──
function openSavesModal() {
  document.getElementById('save-name-input').value = mapTitle || '';
  document.getElementById('save-status').textContent = '';
  renderSavesList();
  document.getElementById('saves-modal-overlay').classList.add('open');
}
function closeSavesModal() {
  document.getElementById('saves-modal-overlay').classList.remove('open');
}

// ── Unsaved-work recovery banner ──
let _recoveryData = null;
function offerRecovery() {
  // A pending crop will auto-load and take precedence — don't compete with it.
  try { if (sessionStorage.getItem(CROP_HANDOFF_KEY)) return; } catch (e) {}
  let raw;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return; }
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return; }
  const n = (data && data.stamps ? data.stamps.length : 0) +
            (data && data.textBoxes ? data.textBoxes.length : 0);
  if (!data || !data.map || n === 0) return;
  _recoveryData = data;
  const banner = document.getElementById('recovery-banner');
  document.getElementById('recovery-text').textContent =
    `You have unsaved work from your last session (${n} item${n === 1 ? '' : 's'}, ${fmtSavedAt(data.savedAt)}).`;
  banner.classList.add('show');
}
function acceptRecovery() {
  document.getElementById('recovery-banner').classList.remove('show');
  if (_recoveryData) restoreProject(_recoveryData);
  _recoveryData = null;
}
function dismissRecovery() {
  document.getElementById('recovery-banner').classList.remove('show');
  _recoveryData = null;
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
}

// Initialise map library thumbnails now that MAP_LIBRARY is defined
buildMapLibrary();
offerRecovery();

// ── Custom-region hand-off ───────────────────────────────────────────────────
// The crop tool (crop-region-v1.html) stashes a cropped base map in
// sessionStorage, then navigates here. If one is waiting, load it straight
// into the canvas (treated like an uploaded map: not state-fillable) and skip
// the start screen entirely.
(function loadPendingCrop() {
  const HANDOFF_KEY = 'mapforge_pending_crop';
  let dataUrl;
  try { dataUrl = sessionStorage.getItem(HANDOFF_KEY); } catch (e) { return; }
  if (!dataUrl) return;
  sessionStorage.removeItem(HANDOFF_KEY);   // one-shot; don't reload on refresh
  loadMap(dataUrl, false);                  // img.onload sizes canvas + dismisses start screen
})();


// First load: populate the home-page saved-maps panel.
renderHomeSavesPanel();
