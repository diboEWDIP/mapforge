// Classic script — shares the app's global lexical scope; load order matters.
// Must load BEFORE mapforge-persist.js, which calls buildMapLibrary() at the
// end of its body.
// ── Live map library (reading) ───────────────────────────────────────────────
// A library entry is a saved live-map PROJECT: a framed region of the world map
// plus every mark the author put on it. Opening one runs exactly the same code
// path as opening a .mapforge file — restoreProject() rebuilds the frame,
// re-applies the layer toggles, and re-seats the geo-anchored annotations — so
// the student lands on the real MapLibre map, already framed and marked up, and
// keeps annotating from there. The author's marks arrive as ordinary editable
// annotations: a starting point, not a locked layer.
//
// The library is DATA, not code: live-library/index.json lists the entries.
// THIS file only ever READS it — that is all the published site needs, and all
// it has. Making entries is a separate, local-only file (see the loader at the
// bottom) that is not part of this repository.

let LIVE_LIBRARY = [];

const LIVE_LIB_DIR = 'live-library/';
const LIVE_LIB_INDEX = LIVE_LIB_DIR + 'index.json';

// Entry files are fetched once and cached. Cheap: a live-map project carries no
// base image — just the frame, the annotations, and a 220px thumbnail.
const _liveEntryCache = new Map();

function fetchLiveEntry(file) {
  if (!_liveEntryCache.has(file)) {
    _liveEntryCache.set(file, fetch(LIVE_LIB_DIR + encodeURIComponent(file))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
  }
  return _liveEntryCache.get(file);
}

// Called from buildMapLibrary() before the base-map cards. The index is a fetch,
// so the cards arrive a moment later and are inserted at the TOP of the grid —
// live regions head the library, base maps follow.
function buildLiveLibrary(grid) {
  if (!grid) return;
  fetch(LIVE_LIB_INDEX, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : []))
    .catch(() => [])                       // no library yet is a normal state
    .then(list => {
      LIVE_LIBRARY = Array.isArray(list) ? list : [];
      renderLiveLibrary(grid);
    });
}

function renderLiveLibrary(grid) {
  grid = grid || document.getElementById('ss-library-grid');
  if (!grid) return;
  grid.querySelectorAll('.ss-live-card, .ss-live-header').forEach(el => el.remove());
  const anchor = grid.firstChild;          // everything goes above the base maps
  LIVE_LIBRARY.forEach((m, i) => {
    const section = m.section || (i === 0 ? 'Live Map Regions' : null);
    if (section) {
      const hdr = document.createElement('div');
      hdr.className = 'ss-section-header ss-live-header';
      hdr.textContent = section;
      grid.insertBefore(hdr, anchor);
    }
    grid.insertBefore(liveLibraryCard(m), anchor);
  });
}

function liveLibraryCard(m) {
  const card = document.createElement('div');
  card.className = 'ss-map-card ss-live-card';
  card.onclick   = () => openLiveLibraryEntry(m, card);

  const thumb   = document.createElement('img');
  thumb.alt     = m.label;
  thumb.src     = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  const pill    = document.createElement('span');
  pill.className   = 'ss-live-pill';
  pill.textContent = 'Live';

  const lbl     = document.createElement('div');
  lbl.className = 'ss-map-label';
  lbl.textContent = m.label;

  card.appendChild(thumb);
  card.appendChild(pill);
  card.appendChild(lbl);

  // The card's face is the thumbnail baked into the entry file — one file per
  // entry, so saving never asks the author to keep two files together.
  fetchLiveEntry(m.file)
    .then(d => { if (d && d.libraryThumb) thumb.src = d.libraryThumb; })
    .catch(() => {
      card.classList.add('ss-live-missing');
      card.title = 'Missing file: ' + LIVE_LIB_DIR + m.file;
    });

  // Only present when the local authoring tool is loaded (adds the remove ✕).
  if (window.MFAuthor && MFAuthor.decorateCard) MFAuthor.decorateCard(card, m);
  return card;
}

async function openLiveLibraryEntry(m, card) {
  let data;
  if (card) card.classList.add('ss-live-loading');
  try {
    data = await fetchLiveEntry(m.file);
  } catch (e) {
    _liveEntryCache.delete(m.file);      // let a fixed file work without a reload
    if (card) card.classList.remove('ss-live-loading');
    alert('Could not open “' + m.label + '”.\n\n' +
          LIVE_LIB_DIR + m.file + ' is missing or is not a readable ' + APP_NAME + ' file.');
    return;
  }
  // Restoring adopts the objects it is handed — stamps are pushed into the live
  // `stamps` array and edited from there. Hand over a fresh copy every time so
  // the cached entry stays pristine for the next open.
  restoreProject(JSON.parse(JSON.stringify(data)));
  if (card) card.classList.remove('ss-live-loading');
}

// The only surface the authoring tool touches, so the two files stay separable.
const MFLibrary = {
  dir: LIVE_LIB_DIR,
  entries: () => LIVE_LIBRARY,
  setEntries(list) { LIVE_LIBRARY = Array.isArray(list) ? list : []; renderLiveLibrary(); },
  forget(file) { _liveEntryCache.delete(file); },
};

// ── Local authoring tool: loaded only on the author's own machine ────────────
// Entries are MADE by mapforge-author.js, which is deliberately NOT in this
// repository — it exists only in the author's working copy. It also needs the
// launcher's server, which is the only thing that can write to live-library/.
// So the published site never fetches it, never mentions it, and could not use
// it if it had it. Students get a library they can read; that is the whole
// surface. `?author=0` hides the tool on the author's own machine (handy when
// projecting); `?author=1` brings it back.
(function loadAuthoringTool() {
  const m = /[?&]author=([01])/.exec(location.search);
  try {
    if (m) m[1] === '1' ? localStorage.removeItem('mapforge:author-off')
                        : localStorage.setItem('mapforge:author-off', '1');
    if (localStorage.getItem('mapforge:author-off') === '1') return;
  } catch (e) {}
  // Does this server accept library writes? Only the launcher's does.
  fetch('__author-ping', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !d.canSave || !d.hasTool) return;
      const s = document.createElement('script');
      s.src = 'mapforge-author.js';
      document.body.appendChild(s);
    })
    .catch(() => {});          // published site: no such endpoint, nothing loads
})();
