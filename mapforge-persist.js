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
  // Uploaded/cropped map already in the image store: reference it by id. The
  // picture stays out of localStorage entirely (see mapforge-blobstore.js).
  // Files re-inline it later -- serializeProjectForFile().
  if (currentMapBlobId) {
    return { kind: 'blob', id: currentMapBlobId, mime: currentMapBlobMime,
             fillable: currentMapFillable };
  }
  if (/^data:/.test(src)) return { kind: 'data', data: src, fillable: currentMapFillable };
  if (/^blob:/.test(src)) {
    // No image store (private browsing, old browser): fall back to baking the
    // picture in, exactly as before.
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
    app: PROJECT_TAG, version: 4, savedAt: Date.now(),   // v4 = images may be stored by reference
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
    delete s._vecFailed;
    delete s._gpM;         // per-session Mercator outline cache — large, and
    delete s._gpMn;        // was silently bloating every autosave/named save
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
  if (v === 3) {
    // v3 -> v4: browser saves may now carry `map.kind:'blob'` (the picture
    // lives in the image store). Nothing to convert -- a v3 project always
    // carries its picture inline, which v4 still reads. Files written by v4
    // are inlined too, so a .mapforge file is unchanged in shape.
    data.version = 4;
  }
  if (v === 2) {
    // v2 -> v3: sizes gain document units, but a v2 file's sizes are backing
    // px of an UNKNOWN device — pass them through numerically (docUnits stays
    // false) so old projects render exactly as they always did here.
    data.version = 3;
    data.docUnits = false;
    data = migrateProject(data);   // chain v2->v3->v4
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
  if (!data || !data.map) { alert('That file is not a valid ' + APP_NAME + ' map.'); return; }
  pendingRestore = data;
  const m = data.map;
  if (m.kind === 'maplibre') { restoreLiveMap(m); return; }
  if (m.kind === 'blob') { restoreStoredImageMap(m); return; }
  // An inlined picture (a .mapforge file, or a save made without the image
  // store): adopt it into the store so this machine gets the smaller form from
  // here on, then load it. Falls back to loading the data URL directly.
  if (m.kind === 'data') {
    // Show it immediately; adopt it into the image store afterwards so this
    // machine gets the smaller form from here on. Never block opening on an
    // encode -- see handleMapUpload().
    currentMapBlobId = null; currentMapBlobMime = null;
    loadMap(m.data, !!m.fillable);
    adoptBaseImage(m.data).then(a => {
      if (!a) return;
      URL.revokeObjectURL(a.url);
      if (currentMapSrc === m.data) { currentMapBlobId = a.id; currentMapBlobMime = a.mime; }
    }).catch(() => {});
    return;
  }
  currentMapBlobId = null;
  loadMap(m.src, !!m.fillable);
}

// A browser save whose picture lives in the image store.
async function restoreStoredImageMap(m) {
  let blob = null;
  try { blob = await MFBlobs.get(m.id); } catch (e) {}
  if (!blob) {
    pendingRestore = null;
    alert('That saved map\u2019s base image is missing from this browser.\n\n' +
          'It was saved on a different computer or browser, or the browser cleared its ' +
          'storage. Maps saved to a file keep their picture inside the file.');
    return;
  }
  currentMapBlobId = m.id;
  currentMapBlobMime = m.mime || blob.type;
  loadMap(URL.createObjectURL(blob), !!m.fillable);
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

// Every image id any save still points at, plus the one in use right now.
function referencedImageIds() {
  const ids = [];
  const pick = d => { if (d && d.map && d.map.kind === 'blob') ids.push(d.map.id); };
  loadSavesIndex().forEach(s => pick(s.data));
  try { pick(JSON.parse(localStorage.getItem(AUTOSAVE_KEY))); } catch (e) {}
  if (typeof currentMapBlobId !== 'undefined' && currentMapBlobId) ids.push(currentMapBlobId);
  return ids;
}

// Called after anything that can orphan a picture (overwrite, delete). Best
// effort -- a missed sweep costs disk space, never correctness.
function sweepUnusedImages() {
  if (!MFBlobs.ready) return;
  MFBlobs.sweep(referencedImageIds()).catch(() => {});
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
  const saves = loadSavesIndex();
  const i     = saves.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
  // A name clash is the one way a save can destroy earlier work, so it gets a
  // real warning showing WHAT would be replaced -- and an equally easy way not
  // to. (Browser saves only; the map library has its own flow.)
  if (i !== -1) {
    if (typeof _expProgress === 'function') _expProgress(null);
    openOverwriteWarning(name, saves[i]);
    return;
  }
  writeNamedSave(name, saves, -1);
}

// The actual write, once the name question is settled.
function writeNamedSave(name, saves, i) {
  const data  = serializeProject();
  const entry = { name, savedAt: data.savedAt, thumb: makeSaveThumb(), data };
  if (i !== -1) saves[i] = entry; else saves.push(entry);
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
  // The named save now holds this exact state, so the autosave slot is
  // redundant — clearing it stops the recovery banner from offering a map
  // that is already in the saved list. The next edit recreates it.
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
  sweepUnusedImages();           // an overwrite can orphan the old picture
  // The user just said they want to keep this: a good moment to ask the browser
  // not to throw their maps away (see mapforge-blobstore.js).
  if (typeof requestPersistentStorage === 'function') requestPersistentStorage();
  flashSaveStatus(`Saved “${name}.”`);
}

// Ctrl/⌘+S. Resaves the save this session is working on without any dialog;
// with no current save yet, it opens the Save modal with the name ready to
// edit so Enter finishes the job.
function quickSave() {
  if (!hasBase()) return;
  // Save modal already open: behave exactly like its Save button (uses the
  // typed name, keeps the overwrite warning).
  if (document.getElementById('saves-modal-overlay').classList.contains('open')) {
    saveCurrentProject();
    return;
  }
  if (_currentSaveName) {
    const saves = loadSavesIndex();
    const i = saves.findIndex(s => s.name.toLowerCase() === _currentSaveName.toLowerCase());
    if (i !== -1) {
      // Same progress treatment as the modal's Save button (live maps render
      // their thumbnail asynchronously).
      if (typeof _expProgress === 'function') {
        _expProgress('Saving map…');
        clearTimeout(quickSave._pt);
        quickSave._pt = setTimeout(() => _expProgress(null), 4000);
      }
      writeNamedSave(saves[i].name, saves, i);
      flashSaved();               // the modal's status line isn't visible here
      return;
    }
    _currentSaveName = null;      // that save was deleted — fall through to the modal
  }
  openSavesModal();
  const input = document.getElementById('save-name-input');
  if (input) { input.focus(); input.select(); }
}

// ── Overwrite warning ──
// "Save a new copy" is the primary action: the cheap path is the one that
// cannot lose work.
let _owName = null;

function suggestCopyName(name) {
  const taken = new Set(loadSavesIndex().map(s => s.name.toLowerCase()));
  const stem  = name.replace(/\s+\d+$/, '');          // "Egypt 2" -> "Egypt"
  for (let n = 2; n < 500; n++) {
    const candidate = stem + ' ' + n;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name + ' copy';
}

function openOverwriteWarning(name, existing) {
  _owName = name;
  document.getElementById('ow-name').textContent = name;
  document.getElementById('ow-when').textContent = fmtSavedAt(existing.savedAt);
  const thumb = document.getElementById('ow-thumb');
  if (existing.thumb) { thumb.src = existing.thumb; thumb.style.display = ''; }
  else thumb.style.display = 'none';
  document.getElementById('ow-copy-name').textContent = suggestCopyName(name);
  document.getElementById('overwrite-modal-overlay').classList.add('open');
}

function closeOverwriteWarning() {
  document.getElementById('overwrite-modal-overlay').classList.remove('open');
  _owName = null;
}

// Keep both: the existing save is untouched, this one is saved beside it.
function overwriteSaveAsCopy() {
  const name = suggestCopyName(_owName);
  closeOverwriteWarning();
  const input = document.getElementById('save-name-input');
  if (input) input.value = name;
  writeNamedSave(name, loadSavesIndex(), -1);
}

// Replace it, deliberately.
function overwriteConfirm() {
  const name  = _owName;
  closeOverwriteWarning();
  const saves = loadSavesIndex();
  writeNamedSave(name, saves, saves.findIndex(s => s.name.toLowerCase() === name.toLowerCase()));
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
  if (!entry) return false;
  if (!confirm(`Delete saved map “${entry.name}”? This cannot be undone.`)) return false;
  saves.splice(idx, 1);
  writeSavesIndex(saves);
  // The session was working on this save: it is no longer a save to update.
  if (_currentSaveName && _currentSaveName.toLowerCase() === entry.name.toLowerCase())
    _currentSaveName = null;
  renderSavesList();
  if (typeof renderHomeSavesPanel === 'function') renderHomeSavesPanel();
  sweepUnusedImages();          // its base image may now be unreferenced
  return true;
}

// Dirty tracking: a map counts as "unsaved work" only if it has annotations
// AND its state differs from the last save (browser save, file save, or the
// save it was opened from). Saving clears the prompt until the next edit.
let _savedSig = null;
function _projSig() {
  try { const d = serializeProject(); delete d.savedAt; return JSON.stringify(d); }
  catch (e) { return null; }
}
// Same signature for an already-serialized project (autosave vs named saves).
// Key order matches because every project comes out of serializeProject().
function _dataSig(d) {
  try { const c = { ...d }; delete c.savedAt; return JSON.stringify(c); }
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
// A .mapforge file has to open on someone else's computer, so it always
// carries its picture inline even though browser saves reference the store.
async function serializeProjectForFile() {
  const data = serializeProject();
  if (data.map && data.map.kind === 'blob') {
    const blob = await MFBlobs.get(data.map.id);
    data.map = blob
      ? { kind: 'data', data: await blobToDataURL(blob), fillable: data.map.fillable }
      : { kind: 'data', data: '', fillable: data.map.fillable };
  }
  return data;
}

async function downloadProjectFile() {
  if (!hasBase()) { flashSaveStatus('Load a map first.'); return; }
  const data = await serializeProjectForFile();
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
    catch (e) { alert('Could not read that file — it is not a valid ' + APP_NAME + ' map.'); return; }
    if (data.app !== PROJECT_TAG &&
        !confirm('This file may not be a ' + APP_NAME + ' map. Try to open it anyway?')) return;
    if (hasUnsavedWork() && !confirm('Open this map? Your current annotations will be replaced.')) return;
    closeSavesModal();
    restoreProject(data);
  };
  reader.readAsText(file);
  input.value = '';
}

// Home-page saved-maps panel: same index as the Save/Open modal, click to open.
// A quiet ✕ on each saved-map row. Always visible rather than hover-only:
// Chromebooks and tablets have no hover, and a control students can't reveal
// may as well not exist. `after` re-renders whichever list it was clicked in.
function saveRowDeleteButton(idx, after) {
  const b = document.createElement('button');
  b.className = 'ss-save-del';
  b.type = 'button';
  b.textContent = '✕';
  b.title = 'Delete this saved map';
  b.setAttribute('aria-label', 'Delete this saved map');
  b.onclick = e => {
    e.stopPropagation();                 // never open the map we are deleting
    if (deleteSavedProject(idx) && after) after();
  };
  return b;
}

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
    li.appendChild(saveRowDeleteButton(i, renderHomeSavesPanel));
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
  // Autosave identical to an existing named save (e.g. a saved map was opened
  // and autosaved, then the session ended with no edits): nothing to recover —
  // it is already in the saved list. Clear the slot so it stops asking.
  const sig = _dataSig(data);
  if (sig !== null && loadSavesIndex().some(s => _dataSig(s.data) === sig)) {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
    return;
  }
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
  // Same treatment as an upload: compact it into the image store so saves
  // reference the picture instead of carrying it.
  loadMap(dataUrl, false);                  // img.onload sizes canvas + dismisses start screen
  adoptBaseImage(dataUrl).then(a => {
    if (!a) return;
    URL.revokeObjectURL(a.url);
    if (currentMapSrc === dataUrl) { currentMapBlobId = a.id; currentMapBlobMime = a.mime; }
  }).catch(() => {});
})();


// First load: populate the home-page saved-maps panel.
renderHomeSavesPanel();
