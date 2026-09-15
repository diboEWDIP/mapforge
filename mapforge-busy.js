/* Busy overlay — one treatment for every wait a student actually sits through
   (cold start, opening a saved map, projection switch, page-size change).
   A spinning globe on a tan veil over the map desk only; the toolbar stays
   visible, but the desk and Save/Export are blocked so nothing is drawn or
   saved into a half-loaded map.

   Timing: appears only if the wait passes SHOW_DELAY (fast operations never
   flash it) and, once shown, stays at least MIN_VISIBLE (no blink).
   Background work (per-pan classification refresh, tile streaming) must NOT
   call this — the map's freeze-frame already covers it.

   Nested calls are counted: busyStart() returns a token; the overlay clears
   when every token has ended. busyWrap(label, promiseFn) is the usual form. */
(() => {
  const SHOW_DELAY = 600, MIN_VISIBLE = 400;
  const active = new Map();        // token -> label
  let nextId = 1, showT = null, shownAt = 0, el = null;

  // Desk globe: an 8-frame sprite (icons/busy-globe-sprite.png, built by
  // maplibre/build-busy-globe.py from real 110m land) stepped by a CSS
  // transform — compositor-driven, so it keeps turning while the main
  // thread is busy (flood fill, snapshot).
  const GLOBE =
    '<div class="mf-busy-globe" aria-hidden="true"><div class="g-strip"></div></div>';

  function ensureEl() {
    if (el) return el;
    const host = document.getElementById('canvas-wrap') || document.body;
    el = document.createElement('div');
    el.id = 'mf-busy';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="mf-busy-card">' + GLOBE + '<div class="mf-busy-label"></div></div>';
    host.appendChild(el);
    return el;
  }

  function currentLabel() {
    const labels = [...active.values()];
    return labels[labels.length - 1] || 'Spinning…';
  }

  function reveal() {
    showT = null;
    if (!active.size) return;
    const e = ensureEl();
    e.querySelector('.mf-busy-label').textContent = currentLabel();
    e.classList.add('on');
    document.body.classList.add('mf-busy');
    shownAt = performance.now();
  }

  function conceal() {
    if (!el || !el.classList.contains('on')) return;
    el.classList.remove('on');
    document.body.classList.remove('mf-busy');
  }

  // opts.immediate: show at once (no delay) — for known-slow LOADS (cold start,
  // opening a saved map), so the student never sees the map half-drawn.
  // opts.solid: opaque desk-coloured veil; the map loads unseen and fades in.
  const solid = new Set();
  // Preload the globe sprite so the very first load's card isn't globe-less.
  new Image().src = 'icons/busy-globe-sprite.png';
  window.busyStart = function (label, opts = {}) {
    const id = nextId++;
    active.set(id, label || 'Spinning…');
    if (opts.solid) solid.add(id);
    if (el) el.classList.toggle('solid', solid.size > 0);
    if (el && el.classList.contains('on')) el.querySelector('.mf-busy-label').textContent = currentLabel();
    else if (opts.immediate) { clearTimeout(showT); reveal(); ensureEl().classList.toggle('solid', solid.size > 0); }
    else if (!showT) showT = setTimeout(reveal, SHOW_DELAY);
    return id;
  };

  window.busyEnd = function (id) {
    if (!active.delete(id)) return;
    solid.delete(id);
    if (el && solid.size === 0 && active.size) el.classList.remove('solid');
    if (active.size) {
      if (el && el.classList.contains('on')) el.querySelector('.mf-busy-label').textContent = currentLabel();
      return;
    }
    if (showT) { clearTimeout(showT); showT = null; return; }  // finished before showing
    const left = MIN_VISIBLE - (performance.now() - shownAt);
    if (left > 0) setTimeout(() => { if (!active.size) conceal(); }, left);
    else conceal();
  };

  // Run an async fn under the overlay. No pre-frame wait: every current caller
  // is async and yields to the browser on its first await, which paints the veil.
  window.busyWrap = async function (label, fn, opts) {
    const id = busyStart(label, opts);
    try { return await fn(); }
    finally { busyEnd(id); }
  };
})();
