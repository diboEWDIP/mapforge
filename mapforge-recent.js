// ── Recent stamps strip (2026-10-22) ────────────────────────────────────────
// A "Recent" section at the top of the Stamps group: the last six stamp types
// the teacher PLACED (not merely picked), most recent first. The palette has
// over eighty icons; most of a lesson's clicks hit the same handful.
//
// Each button is a lightweight clone of the palette's own button — same
// label, icon copied from the palette canvas — and clicking it runs the
// palette button's click, so selection/highlighting follow the normal path.
// Remembered per browser in localStorage (a convenience, never document
// state); the panel hides itself when there is nothing to show.
//
// Host hooks (index.html): recentNote(type) after a single-click stamp lands,
// recentSync() at the end of selectStamp, and the search index skips
// `.recent-btn` clones so "Mountain" is not listed twice.
(function () {
'use strict';

const KEY = 'mapforge:recent-stamps';
const MAX = 6;
let list = [];
let panel = null, grid = null;

function load() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(a)) list = a.filter(t => typeof t === 'string').slice(0, MAX); }
  catch (e) { list = []; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

// The palette button for a stamp type, whichever family it belongs to.
function sourceButton(type) {
  return document.getElementById('btn-' + type)  || document.getElementById('tbtn-' + type) ||
         document.getElementById('rbtn-' + type) || document.getElementById('fbtn-' + type);
}
function sourceCanvas(type) { return document.getElementById('icon-' + type); }
function canvasPainted(c) {
  if (!c || !c.width || !c.height) return false;
  try {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i]) return true;   // sparse sample is plenty
  } catch (e) {}
  return false;
}

function build() {
  if (panel) return true;
  const body = document.getElementById('group-stamps-body');
  const terrain = document.getElementById('terrain-panel');
  if (!body || !terrain) return false;
  panel = document.createElement('div');
  panel.id = 'recent-panel';
  panel.style.display = 'none';
  panel.innerHTML = '<div class="sr-section-header" title="The stamps you placed most recently">Recent</div><div class="trade-grid" id="recent-grid"></div>';
  body.insertBefore(panel, terrain);
  grid = panel.querySelector('#recent-grid');
  return true;
}

function paintClone(c, type, attempt) {
  const src = sourceCanvas(type);
  if (!canvasPainted(src)) {
    // Icons load asynchronously at startup; try again shortly, then give up quietly.
    if ((attempt || 0) < 20) setTimeout(() => paintClone(c, type, (attempt || 0) + 1), 500);
    return;
  }
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = 28, cssH = 22;
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  // Fit the source icon into the clone, centered, preserving its aspect.
  const sw = src.width, sh = src.height;
  const k = Math.min(c.width / sw, c.height / sh);
  const dw = sw * k, dh = sh * k;
  cx.clearRect(0, 0, c.width, c.height);
  cx.drawImage(src, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
}

function render() {
  if (!build()) return;
  const types = list.filter(t => sourceButton(t));   // retired stamps drop out
  grid.innerHTML = '';
  types.forEach(type => {
    const src = sourceButton(type);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'trade-btn terrain-btn recent-btn';
    b.dataset.type = type;
    b.title = src.title || src.textContent.trim();
    const c = document.createElement('canvas');
    b.appendChild(c);
    b.appendChild(document.createTextNode(src.textContent.trim()));
    b.addEventListener('click', () => src.click());
    grid.appendChild(b);
    paintClone(c, type, 0);
  });
  panel.style.display = types.length ? '' : 'none';
  recentSync();
}

// ── Host API ─────────────────────────────────────────────────────────────────
function recentNote(type) {
  if (!type || !sourceButton(type)) return;      // only palette stamps (not lines/shade/fill)
  list = [type, ...list.filter(t => t !== type)].slice(0, MAX);
  save();
  render();
}
function recentSync() {
  if (!grid) return;
  const active = (typeof activeStamp !== 'undefined') ? activeStamp : null;
  grid.querySelectorAll('.recent-btn').forEach(b => b.classList.toggle('active', b.dataset.type === active));
}

Object.assign(window, { recentNote, recentSync });
load();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
