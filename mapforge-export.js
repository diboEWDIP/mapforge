// Extracted from index.html in the 2026-08 restructure (Stage 0.5).
// Classic script — shares the app's global lexical scope; load order matters.
// ── Export ────────────────────────────────────────────────────────────────────

let currentFrameInset = 0;     // detected blue neatline-frame width of the base map (px), 0 = none
let trimMapBorder     = true;  // hide that frame in exports (Export modal checkbox)

// Most base maps have a uniform ~15px blue frame band around the edge ending in a
// thin dark inner line. Detect that line: per edge, scan inward for the position
// whose perpendicular line is "most dark"; if ≥2 edges agree on an inset (±1px),
// that's the frame width. Returns 0 when no consistent frame is found (e.g. the
// US base maps, which have ocean to the edge and no frame).
function detectFrameInset() {
  if (!img.naturalWidth) return 0;
  const W = img.naturalWidth, H = img.naturalHeight;
  let data;
  try {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
    data = cx.getImageData(0, 0, W, H).data;
  } catch (e) { return 0; }
  const lum = (x, y) => { const i = (y * W + x) * 4; return 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]; };
  const DARK = 130, SCAN = Math.round(Math.min(W, H) * 0.05);
  function bestLine(orient) {
    let bi = -1, bf = 0;
    for (let k = 1; k < SCAN; k++) {
      let dark = 0, total = 0;
      if (orient === 'top' || orient === 'bottom') {
        const yy = orient === 'top' ? k : H - 1 - k;
        for (let x = 0; x < W; x += 2) { total++; if (lum(x, yy) < DARK) dark++; }
      } else {
        const xx = orient === 'left' ? k : W - 1 - k;
        for (let y = 0; y < H; y += 2) { total++; if (lum(xx, y) < DARK) dark++; }
      }
      const f = dark / total; if (f > bf) { bf = f; bi = k; }
    }
    return { inset: bi, frac: bf };
  }
  const edges = ['top', 'bottom', 'left', 'right'].map(bestLine);
  // Find the inset value that the most edges agree on (within ±1px).
  let chosen = null;
  for (const e of edges) {
    if (e.inset < 3) continue;
    const agree = edges.filter(o => o.inset >= 3 && Math.abs(o.inset - e.inset) <= 1);
    const maxFrac = Math.max(...agree.map(a => a.frac));
    if (agree.length >= 2 && maxFrac > 0.03) {
      const ins = agree.map(a => a.inset).sort((a, b) => a - b);
      const med = ins[Math.floor(ins.length / 2)];
      if (!chosen || agree.length > chosen.count) chosen = { inset: med, count: agree.length };
    }
  }
  return chosen ? chosen.inset : 0;
}

// Build the full composited export (map + border + labels + title + key) into a
// supersampled canvas and return it. Callers download it as-is or fit it to paper.
let _exporting = false;   // suspends background classification during export
let exportIncludeKey   = true;   // export-dialog toggles — default ON
let exportIncludeTitle = true;
async function buildExportCanvas() {
  _exporting = true;
  try {
    return await _buildExportCanvasInner();
  } finally {
    _exporting = false;
  }
}
async function _buildExportCanvasInner() {
  // Live-map export renders the PRINT FRAME's view (if set), not whatever the
  // student happens to be looking at: jump the map to the frame bounds, let
  // annotations re-derive there, snapshot at print resolution, and restore the
  // editing view at the end. Selection chrome is suppressed for the capture.
  let _exportViewStash = null;
  const _selStash = { stamp: selectedStampIdx, arrow: selectedArrowIdx };
  let mlExportSnap = null;
  let _freeze = null;
  if (baseMode === 'live' && mlMap) {
    // FREEZE-FRAME (WYSIWYG): the export below jumps the map to the print
    // frame, raises the pixel ratio, and re-derives annotations — all visible
    // churn that reads as "my map changed zoom / my key resized". Cover the
    // page with its current composite so students see EXACTLY the editing
    // view for the whole export; removed in _exportRestore.
    try {
      const wrap = document.getElementById('map-wrapper');
      const mlCv = mlMap.getCanvas();
      _freeze = document.createElement('canvas');
      _freeze.width = mlCv.width; _freeze.height = mlCv.height;
      const fc = _freeze.getContext('2d');
      fc.drawImage(mlCv, 0, 0);
      fc.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, _freeze.width, _freeze.height);
      _freeze.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;z-index:40;pointer-events:none;';
      wrap.appendChild(_freeze);
    } catch (e) { _freeze = null; }
    selectedStampIdx = null; selectedArrowIdx = null;   // no chrome in the output
    if (mlFrame) {
      const c = mlMap.getCenter();
      _exportViewStash = { center: [c.lng, c.lat], zoom: mlMap.getZoom() };
      if (mlFrame.view) {
        const cssW = mlMap.getContainer().clientWidth;
        const dz = mlFrame.cssW ? Math.log2(cssW / mlFrame.cssW) : 0;
        mlMap.jumpTo({ center: mlFrame.view.center, zoom: mlFrame.view.zoom + dz });
      } else {
        mlMap.fitBounds(mlFrame.bounds, { padding: 0, duration: 0 });
      }
      _expStep('Exporting: preparing view\u2026');
      await MLB.awaitIdle(mlMap);
      await refreshLiveSnapshot();      // fills re-derive at the export view
      // DRAIN: a debounced background pass (moveend from our own jumpTo) may
      // still be queued or mid-flight — if it hides layers while we snapshot,
      // the export captures the STRIPPED map (Eric's no-labels/no-terrain PDF).
      // Bounded: a stalled pass (hidden tab) must not hang the export forever.
      for (let i = 0; (_clsRefreshing || _clsQueued) && i < 50; i++)
        await new Promise(r => setTimeout(r, 80));
    }
    redraw();                           // annotations at export view, chrome-free
    // Target 300 DPI across the frame's page long side (falls back to Letter's
    // printable width when no frame is set); clamped so huge windows can't
    // demand an absurd WebGL canvas.
    const pageIn = mlFrame ? Math.max(mlFrame.w, mlFrame.h) : 7.5;
    const printRatio = Math.min(4,
      Math.max(window.devicePixelRatio || 1,
        (pageIn * 300) / (mlMap.getContainer().clientWidth || 800)));
    _expStep('Exporting: rendering print snapshot\u2026');
    mlExportSnap = await MLB.printSnapshot(mlMap, printRatio);
    _expStep('Exporting: compositing\u2026');
  }
  // Restores the editing view + selection before returning (see function end).
  const _exportRestore = () => {
    selectedStampIdx = _selStash.stamp; selectedArrowIdx = _selStash.arrow;
    if (_exportViewStash && mlMap) mlMap.jumpTo(_exportViewStash);  // move loop re-derives
    redraw();
    if (_freeze) {
      // Unfreeze only after the map has repainted at the editing view —
      // otherwise the export view flashes for a frame. Bounded fallback.
      const f = _freeze; _freeze = null;
      let gone = false;
      const lift = () => { if (!gone) { gone = true; f.remove(); } };
      if (mlMap) { mlMap.once('idle', lift); mlMap.triggerRepaint(); }
      setTimeout(lift, 4000);
    }
  };

  const mapW = canvas.width;
  const mapH = canvas.height;

  const autoEntries = exportIncludeKey ? collectAutoKeyEntries() : [];
  const allEntries  = exportIncludeKey ? [...autoEntries, ...keyManualEntries] : [];

  const MAP_BORDER = 3;
  // Inset matches the border exactly: the map runs to the neatline with no
  // cream mat ring (the old 8px inset left a visible 5px cream line inside
  // the border). Edge pixels are still cropped by the same amount.
  const INSET      = MAP_BORDER;

  const numRows = Math.min(allEntries.length, KEY_MAX_ROWS);
  const keyBelow = allEntries.length > 0 && keyPlacement === 'below';
  const keyH     = keyBelow ? KEY_PAD + KEY_TITLE_H + numRows * KEY_ROW_H + KEY_PAD : 0;

  // Supersample: render the export at an integer scale so vector content
  // (key text, title, labels) and master-sourced stamp icons stay crisp when
  // the PNG is zoomed/projected. The base-map raster is bicubic-upscaled and is
  // capped by its own source resolution. Scale is clamped to browser canvas limits.
  const EXPORT_TARGET_LONG = 6000;   // aim for ~6k px on the long edge
  const EXPORT_MAX_SCALE   = 4;
  const _longSide = Math.max(mapW, mapH + keyH);
  let S = Math.max(1, Math.min(EXPORT_MAX_SCALE, Math.floor(EXPORT_TARGET_LONG / _longSide)));
  while (S > 1 && (mapW * S > 16000 || (mapH + keyH) * S > 16000 ||
                   mapW * S * (mapH + keyH) * S > 250e6)) S--;

  const exportCanvas  = document.createElement('canvas');
  exportCanvas.width  = Math.round(mapW * S);
  exportCanvas.height = Math.round((mapH + keyH) * S);
  const ec = exportCanvas.getContext('2d');
  ec.scale(S, S);                       // all drawing uses native/logical coords; output at S×
  ec.imageSmoothingEnabled = true;
  ec.imageSmoothingQuality = 'high';

  // Cream background (shows as mat inside border, and fills key area)
  ec.fillStyle = '#faf6ee';
  ec.fillRect(0, 0, mapW, mapH + keyH);

  // Map image inset — crops outer ocean pixels, reveals cream mat inside border
  if (mlExportSnap) {
    // Globe view: the snapshot is transparent outside the sphere — underpaint
    // the map area with the viewer's backdrop color so exports match what's
    // on screen (keep in sync with the #ml-map background-color CSS).
    const ML_BACKDROP = '#ffffff';
    ec.fillStyle = ML_BACKDROP;
    ec.fillRect(INSET, INSET, mapW - INSET * 2, mapH - INSET * 2);
    // Base map first (snapshot may be a different backing size — scale source rect)
    const kx = mlExportSnap.width / mapW, ky = mlExportSnap.height / mapH;
    ec.drawImage(
      mlExportSnap,
      INSET * kx, INSET * ky,
      mlExportSnap.width - INSET * 2 * kx, mlExportSnap.height - INSET * 2 * ky,
      INSET, INSET, mapW - INSET * 2, mapH - INSET * 2
    );
  }
  ec.drawImage(
    canvas,
    INSET, INSET, canvas.width - INSET * 2, canvas.height - INSET * 2,
    INSET, INSET, mapW - INSET * 2, mapH - INSET * 2
  );

  // Hide the base map's blue neatline frame (if detected) by matting it over with
  // cream, so the black border sits cleanly against the map content.
  if (trimMapBorder && currentFrameInset > 0) {
    const R = currentFrameInset + 2;   // frame band + dark line + its anti-aliased edge
    ec.fillStyle = '#faf6ee';
    ec.fillRect(0,        0,        mapW, R);     // top
    ec.fillRect(0,        mapH - R, mapW, R);     // bottom
    ec.fillRect(0,        0,        R,    mapH);  // left
    ec.fillRect(mapW - R, 0,        R,    mapH);  // right
  }

  // Solid black border — pixel-perfect fillRect, no antialiasing
  const B = MAP_BORDER;
  ec.fillStyle = '#111';
  ec.fillRect(0,        0,        mapW, B);   // top
  ec.fillRect(0,        mapH - B, mapW, B);   // bottom
  ec.fillRect(0,        0,        B,    mapH); // left
  ec.fillRect(mapW - B, 0,        B,    mapH); // right

  // Flatten text boxes (percentage coords remapped into inset map area).
  // fontSize is CSS/document px; the export canvas is print-resolution, so
  // scale by export-px-per-document-px — without this, text printed ~2-3x
  // small on retina (the long-standing WYSIWYG text bug).
  const _txtScale = mapW / overlay.getBoundingClientRect().width;
  textBoxes.forEach(tb => {
    const text = tb.el.querySelector('.tb-content').textContent;
    if (!text.trim()) return;
    const cx = INSET + (tb.xPct / 100) * (mapW - INSET * 2);
    const cy = INSET + (tb.yPct / 100) * (mapH - INSET * 2);
    ec.save();
    ec.translate(cx, cy);
    ec.rotate(tb.rotation * Math.PI / 180);
    const isItalic = tb.fontStyle === 'italic';
    const isBold   = tb.fontStyle === 'bold';
    ec.font      = `${isItalic ? 'italic' : 'normal'} ${isBold ? 'bold' : 'normal'} ${tb.fontSize * _txtScale}px ${lpFamStack(tb.fontFamily)}`;
    ec.fillStyle = tb.color || '#111';
    ec.textAlign = 'center'; ec.textBaseline = 'middle';
    ec.fillText(text, 0, 0);
    ec.restore();
  });

  // Composite on-map title box onto export
  if (exportIncludeTitle && mapTitle && titleBoxEl.classList.contains('visible')) {
    const oRect = overlay.getBoundingClientRect();
    const tRect = titleBoxEl.getBoundingClientRect();
    const cScale = mapW / oRect.width;
    // Title box CSS uses translateX(-50%), so left% is the center
    const tCenterX = (tRect.left + tRect.right) / 2;
    const tx = INSET + (tCenterX - oRect.left) * cScale;
    const ty = INSET + (tRect.top - oRect.top)  * cScale;
    const titleFontSize = Math.round(mapH * 0.030);
    const subFontSize   = Math.round(titleFontSize * 0.62);
    ec.font = `600 ${titleFontSize}px 'Jost', Georgia, serif`;
    let tw = ec.measureText(mapTitle).width;
    if (mapSubtitle) {
      ec.font = `italic ${subFontSize}px 'Jost', Georgia, serif`;
      tw = Math.max(tw, ec.measureText(mapSubtitle).width);
    }
    const pad = titleFontSize * 0.5;
    const bx = tx - tw / 2 - pad, bw = tw + pad * 2;
    const bh = titleFontSize * 1.6 + (mapSubtitle ? subFontSize * 1.5 : 0);
    // Cream background + border (skipped when the title frame is off)
    if (typeof titleFrameOn === 'undefined' || titleFrameOn) {
      ec.fillStyle = '#faf6ee';
      ec.fillRect(bx, ty, bw, bh);
      ec.strokeStyle = '#8a8478'; ec.lineWidth = 1.5;   // subtle grey neatline
      ec.strokeRect(bx + 0.75, ty + 0.75, bw - 1.5, bh - 1.5);
    }
    // Title (Colus) + optional subtitle (Jost italic)
    ec.fillStyle = '#111';
    ec.textAlign = 'center'; ec.textBaseline = 'middle';
    ec.font = `600 ${titleFontSize}px 'Jost', Georgia, serif`;
    ec.fillText(mapTitle, tx, ty + titleFontSize * 0.85);
    if (mapSubtitle) {
      ec.font = `italic ${subFontSize}px 'Jost', Georgia, serif`;
      ec.fillStyle = '#4a3a1a';
      ec.fillText(mapSubtitle, tx, ty + titleFontSize * 1.55 + subFontSize * 0.55);
    }
  }

  if (allEntries.length > 0) {
    if (keyPlacement === 'onmap' && onmapKeyEl.classList.contains('visible')) {
      const oRect  = overlay.getBoundingClientRect();
      const kRect  = onmapKeyEl.getBoundingClientRect();
      const cScale = mapW / oRect.width;
      const kx     = INSET + (kRect.left - oRect.left) * cScale;
      const ky     = INSET + (kRect.top  - oRect.top)  * cScale;
      // Render at full map resolution to offscreen, then scale to match CSS box width
      const offC   = document.createElement('canvas');
      offC.width   = Math.ceil(mapW * S); offC.height = Math.ceil(mapH * S);
      const oc     = offC.getContext('2d');
      oc.scale(S, S);                    // render the key bitmap at S× density too
      oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
      const { boxW, boxH } = renderKeyBoxAt(oc, 0, 0, allEntries, keyRowsFor(allEntries.length));
      const scaledW = kRect.width * cScale;
      const scaledH = boxH * (scaledW / boxW);
      ec.drawImage(offC, 0, 0, boxW * S, boxH * S, kx, ky, scaledW, scaledH);
    } else {
      renderKeyBox(ec, mapW, mapH, allEntries);
    }
  }

  _exportRestore();   // back to the editing view + selection
  return exportCanvas;
}

// ── Export menu: full PNG, print-friendly Letter/A4, PDF, key-only ───────────
let exportPaper = 'letter';   // 'letter' | 'a4'
const PAPER_IN = { letter: { w: 8.5, h: 11 }, a4: { w: 8.27, h: 11.69 } };
const PRINT_DPI = 200;        // good handout quality without huge files

function ensureMapLoaded() {
  if (hasBase()) return true;
  flashExportStatus('Load a map first.');
  return false;
}
function exportBaseName() {
  return (mapTitle || 'map').replace(/[^\w\- ]+/g, '').trim() || 'map';
}
function downloadCanvas(cv, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href     = cv.toDataURL('image/png');
  link.click();
}

// Full-resolution PNG (original behaviour)
function _expStep(msg) {
  // One voice: progress text lives in the spinner row only. flashExportStatus
  // is reserved for final confirmations ("Downloaded Letter PNG.").
  try { console.log('[export]', Date.now(), msg); } catch (e) {}
  _expProgress(msg);
}
// Full-screen export progress: spinner + stage line. Any message containing
// "failed" or the sentinel null hides it.
function _expProgress(msg) {
  if (/failed/i.test(msg || '')) flashExportStatus(msg);   // failures stay visible
  // Export modal open → inline spinner between the action buttons and Close.
  const row = document.getElementById('export-spinner-row');
  const modalOpen = (() => {
    const m = document.getElementById('export-modal-overlay');
    return m && getComputedStyle(m).display !== 'none';
  })();
  if (row && modalOpen) {
    const acts = document.getElementById('exp-actions');
    if (msg === null || /failed/i.test(msg || '')) {
      row.style.display = 'none';
      if (acts) acts.style.display = '';
    }
    else {
      row.style.display = 'flex';
      if (acts) acts.style.display = 'none';
      document.getElementById('export-spinner-msg').textContent = msg;
      if (!document.getElementById('expspin-style')) {
        const st = document.createElement('style'); st.id = 'expspin-style';
        st.textContent = '@keyframes expspin { to { transform: rotate(360deg); } }';
        document.head.appendChild(st);
      }
    }
    const full = document.getElementById('export-progress');
    if (full) full.remove();
    return;
  }
  let el = document.getElementById('export-progress');
  if (msg === null || /failed/i.test(msg || '')) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'export-progress';
    el.innerHTML =
      '<div style="width:34px;height:34px;border:3.5px solid rgba(250,245,234,.25);' +
      'border-top-color:#C8A030;border-radius:50%;animation:expspin 0.9s linear infinite;"></div>' +
      '<div id="export-progress-msg" style="font:600 13px/1.4 Jost,Georgia,serif;color:#FAF5EA;"></div>';
    el.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;' +
      'gap:14px;align-items:center;justify-content:center;background:rgba(42,31,14,.55);';
    if (!document.getElementById('expspin-style')) {
      const st = document.createElement('style'); st.id = 'expspin-style';
      st.textContent = '@keyframes expspin { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
    document.body.appendChild(el);
  }
  document.getElementById('export-progress-msg').textContent = msg;
}
async function exportMap() {
  if (!ensureMapLoaded()) return;
  try {
    downloadCanvas(await buildExportCanvas(), exportBaseName() + '.png');
    _expProgress(null);
  } catch (e) {
    _expStep('Export failed: ' + (e && e.message || e));
    console.error('[export]', e);
    return;
  }
  flashExportStatus('Downloaded full-size PNG.');
}

// Place the export composite, centered with margins, on a Letter/A4 page canvas.
// Orientation follows the map (landscape map → landscape page) for the best fit.
async function buildPageCanvas(paperKey) {
  const src   = await buildExportCanvas();
  const landscape = src.width > src.height;
  // LIVE MAPS: the composed page IS the paper. The physical size chosen in
  // Page Layout (Letter / A4 / Figure 5x5 / Sheet 11x17) defines the sheet,
  // edge to edge, no fit-to-letter margin — a Sheet map prints at 11x17, a
  // Figure map at 5x5. The modal's Letter/A4 picker applies to PNG-library
  // maps only (they have no composed physical size).
  let pwIn, phIn, margin;
  if (baseMode === 'live' && mlFrame && mlFrame.w && mlFrame.h) {
    pwIn = landscape ? Math.max(mlFrame.w, mlFrame.h) : Math.min(mlFrame.w, mlFrame.h);
    phIn = landscape ? Math.min(mlFrame.w, mlFrame.h) : Math.max(mlFrame.w, mlFrame.h);
    // 0.5in: clears the ~0.25in unprintable zone on school laser printers
    // with room to spare — the worksheet standard. (Borderless printing
    // doesn't exist on classroom hardware; edge-to-edge would force the
    // driver to shrink or clip unpredictably.)
    margin = Math.round(0.5 * PRINT_DPI);
  } else {
    const paper = PAPER_IN[paperKey] || PAPER_IN.letter;
    pwIn = landscape ? paper.h : paper.w;
    phIn = landscape ? paper.w : paper.h;
    margin = Math.round(0.4 * PRINT_DPI);
  }
  const pageW = Math.round(pwIn * PRINT_DPI), pageH = Math.round(phIn * PRINT_DPI);
  const scale  = Math.min((pageW - margin*2) / src.width, (pageH - margin*2) / src.height);
  const dw = src.width * scale, dh = src.height * scale;
  const dx = (pageW - dw) / 2, dy = (pageH - dh) / 2;
  const page = document.createElement('canvas');
  page.width = pageW; page.height = pageH;
  const pc = page.getContext('2d');
  pc.fillStyle = '#ffffff'; pc.fillRect(0, 0, pageW, pageH);
  pc.imageSmoothingEnabled = true; pc.imageSmoothingQuality = 'high';
  pc.drawImage(src, dx, dy, dw, dh);
  page._pwIn = pwIn; page._phIn = phIn;   // physical size, for @page in printExport
  return page;
}

async function exportPaperImage() {
  if (!ensureMapLoaded()) return;
  // PNG = the framed map itself, neatline at the image edge — no paper sheet,
  // no print margin (those belong to the PDF/print path only).
  try {
    downloadCanvas(await buildExportCanvas(), exportBaseName() + '.png');
  } finally { _expProgress(null); }
  flashExportStatus('Downloaded PNG.');
}

// Print via a hidden same-page iframe: the user never leaves the app — the
// progress overlay runs here, then the browser's print dialog appears over
// the app when the page is ready. No popup, no blank tab, no popup blockers.
async function printExport() {
  if (!ensureMapLoaded()) return;
  let page;
  try {
    page = await buildPageCanvas(exportPaper);
    _expProgress(null);
  } catch (e) {
    _expStep('Export failed: ' + (e && e.message || e));
    console.error('[export]', e);
    return;
  }
  const landscape = page.width > page.height;
  const blobUrl = await new Promise((res, rej) =>
    page.toBlob(b => b ? res(URL.createObjectURL(b)) : rej(new Error('toBlob failed')), 'image/png'));
  let fr = document.getElementById('print-frame');
  if (fr) fr.remove();                     // fresh frame per print
  fr = document.createElement('iframe');
  fr.id = 'print-frame';
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;';
  document.body.appendChild(fr);
  const fd = fr.contentDocument;
  fd.title = exportBaseName();
  const st = fd.createElement('style');
  const sizeDecl = (page._pwIn && page._phIn)
    ? page._pwIn + 'in ' + page._phIn + 'in'
    : (exportPaper === 'a4' ? 'A4' : 'Letter') + ' ' + (landscape ? 'landscape' : 'portrait');
  st.textContent =
    '@page{ size:' + sizeDecl + '; margin:0; }' +
    'html,body{ margin:0; padding:0; } img{ display:block; width:100%; height:100%; object-fit:contain; }';
  fd.head.appendChild(st);
  const img = fd.createElement('img');
  img.onload = () => setTimeout(() => {
    try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {}
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  }, 150);
  img.src = blobUrl;
  fd.body.appendChild(img);
  flashExportStatus('Print dialog opening — choose “Save as PDF” to make a handout.');
}

// Standalone image of just the key — for slides / worksheets.
function exportKeyImage() {
  if (!ensureMapLoaded()) return;
  const entries = [...collectAutoKeyEntries(), ...keyManualEntries];
  if (!entries.length) { flashExportStatus('No key entries yet — add some with the Map Key (🗝) button.'); return; }
  const S = 3;   // supersample for crisp projection
  const meas = document.createElement('canvas').getContext('2d');
  const { boxW, boxH } = renderKeyBoxAt(meas, 0, 0, entries);   // measure
  const out = document.createElement('canvas');
  out.width  = Math.ceil(boxW * S);
  out.height = Math.ceil(boxH * S);
  const oc = out.getContext('2d');
  oc.scale(S, S);
  oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
  renderKeyBoxAt(oc, 0, 0, entries);
  downloadCanvas(out, exportBaseName() + '-key.png');
  flashExportStatus('Downloaded key image.');
}

function setExportPaper(p) {
  exportPaper = p;
  document.getElementById('exp-paper-letter').classList.toggle('active', p === 'letter');
  document.getElementById('exp-paper-a4').classList.toggle('active', p === 'a4');
}
function flashExportStatus(msg) {
  const el = document.getElementById('export-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(flashExportStatus._t);
  flashExportStatus._t = setTimeout(() => { el.textContent = ''; }, 4000);
}
function openExportModal() {
  setExportPaper(exportPaper);
  const isLive = baseMode === 'live' && mlFrame && mlFrame.w;
  // Page line: live maps state the composed page (the page IS the paper);
  // PNG-library maps keep the Letter/A4 picker.
  const info = document.getElementById('exp-page-info');
  document.getElementById('exp-paper-pick').style.display = isLive ? 'none' : '';
  if (isLive) {
    const key = (mlPageSize && mlPageSize.key) || 'letter';
    const nm = { letter: 'Letter', a4: 'A4', figure: 'Figure', sheet: 'Sheet' }[key] || key;
    const landscape = mlFrame.landscape;
    const wIn = landscape ? Math.max(mlFrame.w, mlFrame.h) : Math.min(mlFrame.w, mlFrame.h);
    const hIn = landscape ? Math.min(mlFrame.w, mlFrame.h) : Math.max(mlFrame.w, mlFrame.h);
    info.innerHTML = nm + ' · ' + wIn + ' × ' + hIn + '″ · ' +
      (landscape ? 'landscape' : 'portrait') + ' — <span class="pl-link" ' +
      'onclick="closeExportModal();toggleLayoutPopup(true)">change in Page Layout</span>';
  } else {
    info.textContent = 'Paper:';
  }
  document.getElementById('exp-inc-title').checked = exportIncludeTitle;
  document.getElementById('exp-inc-key').checked   = exportIncludeKey;
  // Grey out toggles with nothing to include
  const entries = [...collectAutoKeyEntries(), ...keyManualEntries];
  document.getElementById('exp-inc-key').parentElement.style.opacity = entries.length ? '' : '.45';
  document.getElementById('exp-inc-title').parentElement.style.opacity = mapTitle ? '' : '.45';
  document.getElementById('exp-caption').textContent =
    mapTitle ? mapTitle : 'Untitled map';
  // Trim checkbox only applies to PNG-library maps with a detected frame
  const trim = document.getElementById('exp-trim');
  if (trim) {
    const hasFrame = !isLive && currentFrameInset > 0;
    trim.parentElement.style.display = hasFrame ? '' : 'none';
    trim.checked = trimMapBorder;
  }
  document.getElementById('export-status').textContent = '';
  document.getElementById('export-modal-overlay').classList.add('open');
  renderExportPreview();
}

// Miniature of the actual printed page: annotation canvas downscaled, plus the
// key strip and title the same way the exporter composes them — true aspect,
// true orientation, real content. Milliseconds; no map re-render.
function renderExportPreview() {
  const pv = document.getElementById('exp-preview');
  if (!pv || !hasBase()) return;
  // Live maps: guarantee the WebGL buffer holds a fresh frame before we copy
  // it (an idle GPU buffer can read back blank on some machines despite
  // preserveDrawingBuffer). Draw once now, then re-draw right after the next
  // render tick.
  if (baseMode === 'live' && mlMap && !renderExportPreview._rearmed) {
    renderExportPreview._rearmed = true;
    mlMap.once('render', () => {
      renderExportPreview._rearmed = false;
      const overlayOpen = document.getElementById('export-modal-overlay')
        .classList.contains('open');
      if (overlayOpen) renderExportPreviewDraw();
    });
    mlMap.triggerRepaint();
  }
  renderExportPreviewDraw();
}
function renderExportPreviewDraw() {
  const pv = document.getElementById('exp-preview');
  if (!pv || !hasBase()) return;
  const mapW = canvas.width, mapH = canvas.height;
  const entries = exportIncludeKey ? [...collectAutoKeyEntries(), ...keyManualEntries] : [];
  const numRows = Math.min(entries.length, KEY_MAX_ROWS);
  const keyH = (entries.length && keyPlacement === 'below')
    ? KEY_PAD + KEY_TITLE_H + numRows * KEY_ROW_H + KEY_PAD : 0;
  const totH = mapH + keyH;
  const MAXPX = 150 * (window.devicePixelRatio || 1);
  const k = Math.min(MAXPX / mapW, MAXPX / totH);
  pv.width = Math.round(mapW * k); pv.height = Math.round(totH * k);
  pv.style.width  = Math.round(pv.width  / (window.devicePixelRatio || 1)) + 'px';
  pv.style.height = Math.round(pv.height / (window.devicePixelRatio || 1)) + 'px';
  const pc = pv.getContext('2d');
  pc.imageSmoothingEnabled = true; pc.imageSmoothingQuality = 'high';
  pc.fillStyle = '#faf6ee'; pc.fillRect(0, 0, pv.width, pv.height);
  pc.save(); pc.scale(k, k);
  if (baseMode === 'live' && mlMap) {
    pc.fillStyle = '#ffffff'; pc.fillRect(0, 0, mapW, mapH);
    const mc = mlMap.getCanvas();
    pc.drawImage(mc, 0, 0, mc.width, mc.height, 0, 0, mapW, mapH);
  } else if (img && img.naturalWidth) {
    pc.drawImage(img, 0, 0, mapW, mapH);
  }
  pc.drawImage(canvas, 0, 0);
  if (keyH) {
    try { renderKeyBox(pc, mapW, mapH, entries); } catch (e) {
      // key renderer unavailable → cream block already marks its area
    }
  }
  // Title + on-map key are DOM overlays, invisible to the canvases — composite
  // them the way the exporter does so the thumbnail is faithful to the print.
  try {
    const oRect = overlay.getBoundingClientRect();
    const cS = mapW / oRect.width;
    if (exportIncludeTitle && mapTitle && titleBoxEl.classList.contains('visible')) {
      const tRect = titleBoxEl.getBoundingClientRect();
      const tcx = ((tRect.left + tRect.right) / 2 - oRect.left) * cS;
      const tty = (tRect.top - oRect.top) * cS;
      const fs = Math.round(mapH * 0.030), sfs = Math.round(fs * 0.62);
      pc.font = `600 ${fs}px 'Jost', Georgia, serif`;
      let tw2 = pc.measureText(mapTitle).width;
      if (mapSubtitle) {
        pc.font = `italic ${sfs}px 'Jost', Georgia, serif`;
        tw2 = Math.max(tw2, pc.measureText(mapSubtitle).width);
      }
      const pad2 = fs * 0.5, bh2 = fs*1.6 + (mapSubtitle ? sfs*1.5 : 0);
      if (typeof titleFrameOn === 'undefined' || titleFrameOn) {
        pc.fillStyle = '#faf6ee';
        pc.fillRect(tcx - tw2/2 - pad2, tty, tw2 + pad2*2, bh2);
        pc.strokeStyle = '#8a8478'; pc.lineWidth = Math.max(1.5, 1.5 / k);
        pc.strokeRect(tcx - tw2/2 - pad2, tty, tw2 + pad2*2, bh2);
      }
      pc.fillStyle = '#111'; pc.textAlign = 'center'; pc.textBaseline = 'middle';
      pc.font = `600 ${fs}px 'Jost', Georgia, serif`;
      pc.fillText(mapTitle, tcx, tty + fs*0.85);
      if (mapSubtitle) {
        pc.font = `italic ${sfs}px 'Jost', Georgia, serif`;
        pc.fillStyle = '#4a3a1a';
        pc.fillText(mapSubtitle, tcx, tty + fs*1.55 + sfs*0.55);
      }
    }
    if (entries.length && keyPlacement === 'onmap' &&
        onmapKeyEl.classList.contains('visible')) {
      const kRect = onmapKeyEl.getBoundingClientRect();
      const kx = (kRect.left - oRect.left) * cS, ky = (kRect.top - oRect.top) * cS;
      const off = document.createElement('canvas');
      off.width = 1200; off.height = 800;
      const oc = off.getContext('2d');
      const { boxW, boxH } = renderKeyBoxAt(oc, 0, 0, entries);
      const sw2 = kRect.width * cS;
      pc.drawImage(off, 0, 0, boxW, boxH, kx, ky, sw2, boxH * (sw2 / boxW));
    }
  } catch (e) { /* preview stays map-only on any measurement hiccup */ }
  pc.restore();
}
// Saved-map thumbnail: the export-preview composite (base + annotations +
// title + on-map key), shrunk to list size. Shares renderExportPreviewDraw's
// logic by temporarily pointing it at an offscreen canvas via #exp-preview?
// No — that canvas is DOM-bound; instead reuse the same draw sequence here.
// Live maps: the GL canvas only has pixels right after a render — draw the
// thumb inside a fresh render callback (exactly how the export preview does)
// and hand it to cb. Image maps are synchronous.
// `w` is the thumbnail width in pixels. The default suits the saved-maps list
// (kept small — those live in localStorage, where quota is real). Library
// entries pass a larger width: their thumbs are baked into static files and
// drawn on cards that stretch past 220 CSS px on Retina screens.
function makeSaveThumbAsync(cb, w) {
  if (baseMode === 'live' && mlMap) {
    let done = false;
    const go = () => { if (!done) { done = true; cb(makeSaveThumb(w)); } };
    mlMap.once('render', go);
    mlMap.triggerRepaint();
    setTimeout(go, 1500);          // bounded: hidden tabs may never render
  } else {
    cb(makeSaveThumb(w));
  }
}
function makeSaveThumb(w) {
  try {
    const mapW = canvas.width, mapH = canvas.height;
    const entries = [...collectAutoKeyEntries(), ...keyManualEntries];
    const W = w || 220;
    const t = document.createElement('canvas');
    t.width = W; t.height = Math.max(1, Math.round(W * mapH / mapW));
    const pc = t.getContext('2d');
    const k = W / mapW;
    pc.imageSmoothingEnabled = true; pc.imageSmoothingQuality = 'high';
    pc.fillStyle = '#faf6ee'; pc.fillRect(0, 0, t.width, t.height);
    pc.save(); pc.scale(k, k);
    if (baseMode === 'live' && mlMap) {
      pc.fillStyle = '#ffffff'; pc.fillRect(0, 0, mapW, mapH);
      const mc = mlMap.getCanvas();
      pc.drawImage(mc, 0, 0, mc.width, mc.height, 0, 0, mapW, mapH);
    } else if (img && img.naturalWidth) {
      pc.drawImage(img, 0, 0, mapW, mapH);
    }
    pc.drawImage(canvas, 0, 0);
    // Title + on-map key are DOM overlays — composite like the export preview.
    try {
      const oRect = overlay.getBoundingClientRect();
      const cS = mapW / oRect.width;
      if (mapTitle && titleBoxEl.classList.contains('visible')) {
        const tRect = titleBoxEl.getBoundingClientRect();
        const tcx = ((tRect.left + tRect.right) / 2 - oRect.left) * cS;
        const tty = (tRect.top - oRect.top) * cS;
        const fs = Math.round(mapH * 0.030), sfs = Math.round(fs * 0.62);
        pc.font = `600 ${fs}px 'Jost', Georgia, serif`;
        let tw2 = pc.measureText(mapTitle).width;
        const pad2 = fs * 0.5, bh2 = fs*1.6 + (mapSubtitle ? sfs*1.5 : 0);
        if (typeof titleFrameOn === 'undefined' || titleFrameOn) {
          pc.fillStyle = '#faf6ee';
          pc.fillRect(tcx - tw2/2 - pad2, tty, tw2 + pad2*2, bh2);
          pc.strokeStyle = '#8a8478'; pc.lineWidth = Math.max(1.5, 1.5 / k);
          pc.strokeRect(tcx - tw2/2 - pad2, tty, tw2 + pad2*2, bh2);
        }
        pc.fillStyle = '#111'; pc.textAlign = 'center'; pc.textBaseline = 'middle';
        pc.font = `600 ${fs}px 'Jost', Georgia, serif`;
        pc.fillText(mapTitle, tcx, tty + fs*0.85);
      }
      if (entries.length && keyPlacement === 'onmap' &&
          onmapKeyEl.classList.contains('visible')) {
        const kRect = onmapKeyEl.getBoundingClientRect();
        const kx = (kRect.left - oRect.left) * cS, ky = (kRect.top - oRect.top) * cS;
        const off = document.createElement('canvas');
        off.width = 1200; off.height = 800;
        const oc = off.getContext('2d');
        const { boxW, boxH } = renderKeyBoxAt(oc, 0, 0, entries);
        const sw2 = kRect.width * cS;
        pc.drawImage(off, 0, 0, boxW, boxH, kx, ky, sw2, boxH * (sw2 / boxW));
      }
    } catch (e) { /* thumbnail stays map-only on measurement hiccups */ }
    pc.restore();
    return t.toDataURL('image/jpeg', 0.72);
  } catch (e) { return null; }
}

function closeExportModal() {
  const row = document.getElementById('export-spinner-row');
  if (row) row.style.display = 'none';
  const acts = document.getElementById('exp-actions');
  if (acts) acts.style.display = '';
  document.getElementById('export-modal-overlay').classList.remove('open');
}
