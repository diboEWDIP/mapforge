// Classic script — shares the app's global lexical scope; load order matters.
// ── Find a City ──────────────────────────────────────────────────────────────
// Type a city name — modern, ancient, or medieval — and drop a city stamp at
// its true location on the live map, with an optional pre-filled name label.
// A teacher tool: it ships with the site (unlike the author-only extras), but
// hides in student mode so a shared assignment link can present a clean app.
//
// Gazetteer: city-gazetteer/cities.json — ~20k places, three merged sources:
//   modern     Natural Earth "populated places" (public domain)
//   ancient    Pleiades gazetteer of the ancient world (CC-BY —
//              https://pleiades.stoa.org)
//   historical a small curated list (Tenochtitlan, Angkor, Cahokia, …)
// Entry shape: [name, lat, lng, region, era('m'|'a'|'h'), pop, aliases[]].
// Fetched lazily on first open; nothing loads for users who never click it.

(function () {
  'use strict';

  // Future share-link student mode: assignment links will carry ?student=1
  // (or set this flag) and teacher tools disappear.
  function cfStudentMode() {
    return window.MF_STUDENT === true || /[?&]student=1/.test(location.search);
  }

  const ERA = { m: 'modern', a: 'ancient', h: 'historical' };
  let cfData = null;        // the gazetteer, once fetched
  let cfLoading = null;     // in-flight fetch promise

  const css = document.createElement('style');
  css.textContent = `
    #cf-modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(40,20,5,0.55); z-index: 500;
      align-items: center; justify-content: center;
    }
    #cf-modal-overlay.open { display: flex; }
    #cf-modal {
      position: relative; background: #FAF5EA; border-radius: 14px;
      padding: 0 24px 20px; width: 440px; max-width: 92vw;
      max-height: 88vh; overflow: hidden auto;
      box-shadow: 0 14px 44px rgba(20,12,4,0.62);
      font-family: 'Jost', Georgia, serif;
    }
    #cf-modal h3 {
      background: #4C6472; color: #FAF5EA;
      font: 400 15px/1 'Colus', Georgia, serif;
      letter-spacing: 1.2px; text-transform: uppercase;
      margin: 0 -24px 14px; padding: 14px 24px;
    }
    #cf-modal .modal-x { color: #FAF5EA; z-index: 2; }
    #cf-search {
      width: 100%; box-sizing: border-box;
      font: 400 13px 'Jost', Georgia, serif;
      padding: 8px 10px; border: 1px solid rgba(0,0,0,0.18);
      border-radius: 8px; background: #fff; color: #2A1F0E;
    }
    #cf-list {
      list-style: none; margin: 10px 0 0; padding: 0;
      max-height: 300px; overflow-y: auto;
      border: 1px solid rgba(0,0,0,0.1); border-radius: 8px;
    }
    #cf-list li {
      display: flex; justify-content: space-between; gap: 10px;
      padding: 7px 12px; cursor: pointer;
      font: 400 12.5px/1.3 'Jost', Georgia, serif; color: #2A1F0E;
    }
    #cf-list li:hover { background: #eee6d2; }
    #cf-list li + li { border-top: 1px solid rgba(0,0,0,0.06); }
    #cf-list li .cf-meta { color: #7a6a4a; font-size: 11px; white-space: nowrap; }
    #cf-list li.cf-inert { cursor: default; color: #7a6a4a; }
    #cf-status {
      font: 400 11.5px/1.4 'Jost', Georgia, serif;
      color: #7a5c1e; text-align: center; min-height: 15px; margin-top: 8px;
    }
    #cf-label-row {
      display: flex; align-items: center; gap: 6px; margin-top: 8px;
      font: 400 12px 'Jost', Georgia, serif; color: #2A1F0E;
    }`;
  document.head.appendChild(css);

  const overlay = document.createElement('div');
  overlay.id = 'cf-modal-overlay';
  overlay.innerHTML = `
    <div id="cf-modal">
      <div class="modal-x" data-close>✕</div>
      <h3>Find a City</h3>
      <input id="cf-search" type="text"
             placeholder="Type a city — modern, ancient, or medieval…" />
      <div id="cf-label-row">
        <input type="checkbox" id="cf-label" checked />
        <label for="cf-label">Also add a name label next to the stamp</label>
      </div>
      <ul id="cf-list"></ul>
      <div id="cf-status"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.hasAttribute('data-close'))
      overlay.classList.remove('open');
  });

  const cfSearch = overlay.querySelector('#cf-search');
  const cfList   = overlay.querySelector('#cf-list');
  const cfStatus = overlay.querySelector('#cf-status');
  const cfLabel  = overlay.querySelector('#cf-label');

  function loadGazetteer() {
    if (cfData) return Promise.resolve(cfData);
    if (!cfLoading) {
      cfLoading = fetch('city-gazetteer/cities.json')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(d => { cfData = d; return d; })
        .catch(e => { cfLoading = null; throw e; });
    }
    return cfLoading;
  }

  // Rank: exact name, name prefix, name substring, then alias matches — and
  // within a tier, big modern cities before hamlets, curated before the long
  // ancient tail, so "rome" surfaces Rome before Rometta.
  function cfMatches(q) {
    q = q.toLowerCase();
    const scored = [];
    for (const e of cfData) {
      const name = e[0].toLowerCase();
      let s = -1;
      if (name === q) s = 0;
      else if (name.startsWith(q)) s = 1;
      else if (name.includes(q)) s = 2;
      else {
        for (const a of e[6]) {
          const al = a.toLowerCase();
          if (al === q) { s = 1; break; }
          if (al.startsWith(q)) { s = 3; break; }
          if (al.includes(q)) { s = 4; break; }
        }
      }
      if (s < 0) continue;
      const eraBoost = e[4] === 'm' ? 0 : e[4] === 'h' ? 0.2 : 0.4;
      scored.push([s + eraBoost, -(e[5] || 0), e]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2][0].localeCompare(b[2][0]));
    return scored.slice(0, 30).map(x => x[2]);
  }

  // Pleiades titles can be slash-joined variant lists ("Uruk/Orchoe/Erech");
  // one name goes on the map — the first, which Pleiades leads with as the
  // conventional form. The full list still matches in search.
  function cfDisplayName(e) { return e[0].split('/')[0].trim(); }

  function cfRender() {
    const q = cfSearch.value.trim();
    cfList.innerHTML = '';
    if (q.length < 2) return;
    for (const e of cfMatches(q)) {
      const li = document.createElement('li');
      const nm = document.createElement('span');
      nm.textContent = cfDisplayName(e);
      const meta = document.createElement('span');
      meta.className = 'cf-meta';
      const variants = e[0].includes('/') ? e[0].split('/').slice(1, 3).join(', ') : '';
      meta.textContent = (variants ? variants + ' · ' : '') +
                         (e[3] ? e[3] + ' · ' : '') + ERA[e[4]];
      li.appendChild(nm); li.appendChild(meta);
      li.addEventListener('click', () => cfPlace(e));
      cfList.appendChild(li);
    }
    if (!cfList.children.length) {
      const li = document.createElement('li');
      li.className = 'cf-inert';
      li.textContent = 'No city found for “' + q + '”.';
      cfList.appendChild(li);
    }
  }

  function cfPlace(e) {
    const [, lat, lng] = e;
    const name = cfDisplayName(e);
    const p = MLB.toScreen(mlMap, [lng, lat], canvas);
    // Half the hand-stamp size: a located city is a reference dot, not a
    // drawn feature — and the name below needs the room.
    const cityCss = (typeof citySize === 'number' ? citySize : 16) * 0.5;
    const s = { type: 'city', x: p.x, y: p.y, color: activeColor,
                size: cityCss * devicePixelRatio, lng, lat };
    stamps.push(s);
    undoLog.push({ kind: 'stamp', stamp: s });
    redoStack.length = 0;
    if (cfLabel.checked) {
      // Name centered BELOW the dot, per map convention. Labels anchor at
      // their center (translate(-50%,-50%)), so only a vertical drop is
      // needed: half the dot plus half the text line.
      const fontSize = typeof lpFontSize === 'number' ? lpFontSize : 18;
      const lp = mlMap.project([lng, lat]);
      const drop = cityCss * 1.05 + fontSize * 0.62 + 2;
      const ll = mlMap.unproject([lp.x, lp.y + drop]);
      const tb = createTextBox(0, 0, { text: name, lng: ll.lng, lat: ll.lat,
                            fontSize,
                            color: typeof lpColor === 'string' ? lpColor : '#111111' });
      if (tb && tb.id !== undefined) s.pair = tb.id;   // dot + name move as one (Select tool)
      const ae = document.activeElement;
      if (ae && ae.blur) ae.blur();     // don't trap the teacher in label editing
      deselectTB();
    }
    redraw();
    if (typeof refreshOnmapKeyBody === 'function') refreshOnmapKeyBody();
    scheduleAutosave();
    const visible = MLB.isVisible(mlMap, [lng, lat]) &&
      p.x >= 0 && p.y >= 0 && p.x <= canvas.width && p.y <= canvas.height;
    cfStatus.textContent = visible
      ? 'Placed ' + name + '.'
      : 'Placed ' + name + ' — outside the current view; it will appear when the map shows that area.';
    cfSearch.select();
  }

  window.openCityFinder = async function () {
    if (cfStudentMode()) return;
    if (baseMode !== 'live' || !mlMap) {
      alert('Find a City works on the live map.\n\nOpen a Custom Region or a live library map first — regular picture maps have no coordinates to place against.');
      return;
    }
    cfStatus.textContent = 'Loading city index…';
    overlay.classList.add('open');
    try { await loadGazetteer(); }
    catch (e) {
      cfStatus.textContent = 'Could not load the city index (' + e.message + ').';
      return;
    }
    cfStatus.textContent = cfData.length.toLocaleString() + ' cities — modern, ancient, and medieval.';
    cfRender();
    setTimeout(() => { cfSearch.focus(); cfSearch.select(); }, 0);
  };

  cfSearch.addEventListener('input', cfRender);
  cfSearch.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = cfList.querySelector('li:not(.cf-inert)');
      if (first) first.click();
    }
    if (e.key === 'Escape') overlay.classList.remove('open');
    e.stopPropagation();               // keep app-level shortcuts out of the search box
  });

  // Student mode: remove the launcher button entirely.
  if (cfStudentMode()) {
    const b = document.getElementById('btn-find-city');
    if (b) b.remove();
  }
})();
