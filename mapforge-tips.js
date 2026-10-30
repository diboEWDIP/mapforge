// ── First-run tips (2026-10-29) ─────────────────────────────────────────────
// The first time a teacher reaches the workstation, three small cards point
// at the three things that matter: tools on the left, stamps on the right,
// Save in the header. Next / Done / Skip / Escape / click-outside all dismiss;
// once dismissed at any step they never show again in that browser
// (localStorage, a per-browser convenience). "Show tips" in the tool search
// replays them. Student links (?student=1) never see them. Pure UI: no app
// state is touched.
(function () {
'use strict';

const KEY = 'mapforge:tips-seen';
const STEPS = [
  { anchor: '#tool-rail',    side: 'right',  title: 'Tools live on the left',
    body: 'Select, Text, Stamps, Lines, Fill, Shade, Find City and Eraser. Click one, then work on the map. Escape puts a tool down.' },
  { anchor: '#sidebar-right', side: 'left',  title: 'Stamps and layers on the right',
    body: 'Pick a stamp here and click the map to place it. The strips above switch map layers and labels on and off.' },
  { anchor: '#hdr-save-btn', side: 'below',  title: 'Save keeps your map',
    body: 'The map autosaves in this browser, and Save (⌘S / Ctrl+S) writes a file you can reopen anywhere. A dot on the button means a save is due.' },
];

const CSS = `
#mf-tips { position: fixed; inset: 0; z-index: 65; display: none; font-family: 'Jost', Georgia, serif; }
#mf-tips.open { display: block; }
#mf-tips-veil { position: absolute; inset: 0; background: rgba(40,20,5,0.18); }
#mf-tips-halo { position: absolute; border: 2px solid #e0a030; border-radius: 10px; box-shadow: 0 0 0 4px rgba(224,160,48,0.25), 0 0 0 9999px rgba(40,20,5,0.18); pointer-events: none; transition: all .18s ease; }
#mf-tips-card { position: absolute; width: 280px; max-width: calc(100vw - 32px); background: #FAF5EA; border-radius: 12px; padding: 14px 16px 12px;
  box-shadow: 0 12px 36px rgba(20,12,4,0.45); color: #2a1f0e; transition: all .18s ease; }
#mf-tips-card h4 { margin: 0 0 6px; font-family: 'Colus', 'Jost', Georgia, serif; font-weight: 400; font-size: 14px; letter-spacing: 1.2px; text-transform: uppercase; }
#mf-tips-card p { margin: 0 0 12px; font-size: 13px; line-height: 1.5; }
#mf-tips-row { display: flex; align-items: center; gap: 8px; }
#mf-tips-dots { display: flex; gap: 5px; margin-right: auto; }
#mf-tips-dots span { width: 7px; height: 7px; border-radius: 50%; background: #d4b870; }
#mf-tips-dots span.on { background: #a06810; }
#mf-tips-card button { background: #faf5ea; border: 1.5px solid #c8a030; border-radius: 6px; color: #2a1f0e; font: 400 12px 'Jost', Georgia, serif; padding: 5px 11px; cursor: pointer; }
#mf-tips-card button:hover { background: #e8d8a0; }
#mf-tips-card button.primary { background: #a06810; border-color: #a06810; color: #FAF5EA; }
#mf-tips-card button.primary:hover { background: #8a5808; }
#mf-tips-skip { font-size: 12px; color: #7a5c1e; cursor: pointer; text-decoration: underline; }
#mf-tips-arrow { position: absolute; width: 12px; height: 12px; background: #FAF5EA; transform: rotate(45deg); }
`;

let wrap = null, halo = null, card = null, step = 0;

function seen() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
function markSeen() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
function isStudent() { return window.MF_STUDENT === true || /[?&]student=1/.test(location.search); }

function build() {
  if (wrap) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  wrap = document.createElement('div');
  wrap.id = 'mf-tips';
  wrap.innerHTML = '<div id="mf-tips-veil"></div><div id="mf-tips-halo"></div>' +
    '<div id="mf-tips-card" role="dialog" aria-live="polite"><div id="mf-tips-arrow"></div><h4></h4><p></p>' +
    '<div id="mf-tips-row"><div id="mf-tips-dots"></div><span id="mf-tips-skip">Skip</span><button type="button" id="mf-tips-next" class="primary">Next</button></div></div>';
  document.body.appendChild(wrap);
  halo = wrap.querySelector('#mf-tips-halo');
  card = wrap.querySelector('#mf-tips-card');
  wrap.querySelector('#mf-tips-veil').addEventListener('mousedown', close);
  wrap.querySelector('#mf-tips-skip').addEventListener('click', close);
  wrap.querySelector('#mf-tips-next').addEventListener('click', () => { if (step >= STEPS.length - 1) close(); else show(step + 1); });
  window.addEventListener('resize', () => { if (isOpen()) place(); });
}

function place() {
  const s = STEPS[step];
  const el = document.querySelector(s.anchor);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const pad = 4;
  halo.style.left = (r.left - pad) + 'px'; halo.style.top = (r.top - pad) + 'px';
  halo.style.width = (r.width + 2 * pad) + 'px'; halo.style.height = (r.height + 2 * pad) + 'px';
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14;
  let left, top;
  const arrow = card.querySelector('#mf-tips-arrow');
  if (s.side === 'right')      { left = r.right + gap;  top = Math.max(12, Math.min(innerHeight - ch - 12, r.top + 40)); }
  else if (s.side === 'left')  { left = r.left - cw - gap; top = Math.max(12, Math.min(innerHeight - ch - 12, r.top + 40)); }
  else                         { left = Math.max(12, Math.min(innerWidth - cw - 12, r.left + r.width / 2 - cw / 2)); top = r.bottom + gap; }
  card.style.left = left + 'px'; card.style.top = top + 'px';
  // arrow on the edge facing the anchor
  arrow.style.left = arrow.style.right = arrow.style.top = arrow.style.bottom = '';
  if (s.side === 'right')     { arrow.style.left = '-6px';  arrow.style.top = Math.max(12, Math.min(ch - 18, r.top + r.height / 2 - top - 6)) + 'px'; }
  else if (s.side === 'left') { arrow.style.right = '-6px'; arrow.style.top = Math.max(12, Math.min(ch - 18, r.top + r.height / 2 - top - 6)) + 'px'; }
  else                        { arrow.style.top = '-6px';   arrow.style.left = Math.max(12, Math.min(cw - 18, r.left + r.width / 2 - left - 6)) + 'px'; }
}

function show(i) {
  build();
  step = i;
  const s = STEPS[step];
  card.querySelector('h4').textContent = s.title;
  card.querySelector('p').textContent = s.body;
  card.querySelector('#mf-tips-dots').innerHTML = STEPS.map((_, k) => `<span class="${k === step ? 'on' : ''}"></span>`).join('');
  card.querySelector('#mf-tips-next').textContent = step >= STEPS.length - 1 ? 'Done' : 'Next';
  wrap.classList.add('open');
  place();
}
function close() { if (wrap) wrap.classList.remove('open'); markSeen(); }
function isOpen() { return !!wrap && wrap.classList.contains('open'); }

// Escape in the capture phase so it only closes the tips, never the tool.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isOpen()) { close(); e.preventDefault(); e.stopPropagation(); }
}, true);

// Host hook: called when the workstation appears. Shows once per browser.
function firstRunTipsMaybe() {
  if (seen() || isStudent()) return;
  if (document.body.classList.contains('mf-busy')) { setTimeout(firstRunTipsMaybe, 700); return; }
  show(0);
}
function showTips() { show(0); }

Object.assign(window, { firstRunTipsMaybe, showTips });
})();
