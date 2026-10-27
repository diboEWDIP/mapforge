// ── Keyboard shortcut card (2026-10-26) ─────────────────────────────────────
// Press "?" (anywhere but a text field) to see the shortcuts the app already
// has on one small card; "?" again, Escape, the ✕, or a click outside closes
// it. Also reachable from the tool search as "Keyboard shortcuts". Pure UI:
// no app state is touched, and the key names follow the platform (⌘ on a
// Mac, Ctrl elsewhere).
(function () {
'use strict';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent || '');
const MOD = MAC ? '⌘' : 'Ctrl';
const ALT = MAC ? 'Option' : 'Alt';

// [keys, what it does]. Keep this list honest: every row is a real handler.
const ROWS = [
  ['Esc',                        'Step back: stop editing a label, then clear the selection, then put down the tool'],
  ['Delete / Backspace',         'Delete the selected label or stamp'],
  ['← ↑ → ↓',                    'Nudge the selected stamp or label 1 pixel'],
  ['Shift + arrow',              'Nudge 10 pixels'],
  [`${MOD} + C`,                 'Copy the selected stamp'],
  [`${MOD} + V`,                 'Paste it, stepped down and to the right'],
  [`${MOD} + D`,                 'Duplicate in one stroke'],
  [`${ALT} + drag`,              'Drag off a copy of a stamp (Select tool)'],
  [`${MOD} + Z`,                 'Undo'],
  [`Shift + ${MOD} + Z`,         'Redo'],
  [`${MOD} + S`,                 'Save this map'],
  ['Hold Space + drag',          'Pan the map while adjusting the view, or a zoomed-in page'],
  ['?',                          'Show or hide this card'],
];

const CSS = `
#mf-shortcuts { position: fixed; inset: 0; z-index: 70; display: none; align-items: center; justify-content: center;
  background: rgba(40,20,5,0.45); font-family: 'Jost', Georgia, serif; }
#mf-shortcuts.open { display: flex; }
#mf-shortcuts-card { position: relative; background: #FAF5EA; border-radius: 12px; padding: 18px 22px 16px; width: 440px;
  max-width: 92vw; max-height: 88vh; overflow-y: auto; box-shadow: 0 14px 44px rgba(20,12,4,0.5); color: #2a1f0e; }
#mf-shortcuts-card h3 { margin: 0 0 10px; font-family: 'Colus', 'Jost', Georgia, serif; font-weight: 400; font-size: 16px;
  letter-spacing: 1.5px; text-transform: uppercase; color: #2A1F0E; }
#mf-shortcuts-x { position: absolute; top: 12px; right: 14px; width: 26px; height: 26px; line-height: 26px; text-align: center;
  border-radius: 50%; cursor: pointer; font-size: 14px; color: #5a4020; }
#mf-shortcuts-x:hover { background: #e8d8a0; }
#mf-shortcuts-card table { width: 100%; border-collapse: collapse; font-size: 13px; }
#mf-shortcuts-card td { padding: 5px 0; vertical-align: top; border-top: 1px solid #ece4d0; line-height: 1.4; }
#mf-shortcuts-card tr:first-child td { border-top: none; }
#mf-shortcuts-card td.k { width: 150px; padding-right: 12px; white-space: nowrap; }
#mf-shortcuts-card kbd { display: inline-block; background: #ffffff; border: 1px solid #c8a030; border-bottom-width: 2px;
  border-radius: 5px; padding: 1px 6px; font: 600 11.5px 'Jost', Georgia, serif; color: #2a1f0e; }
#mf-shortcuts-card .mf-sc-note { margin: 10px 0 0; font-size: 11.5px; color: #7a5c1e; }
`;

let wrap = null;
function build() {
  if (wrap) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  wrap = document.createElement('div');
  wrap.id = 'mf-shortcuts';
  const rows = ROWS.map(([k, what]) =>
    `<tr><td class="k"><kbd>${k}</kbd></td><td>${what}</td></tr>`).join('');
  wrap.innerHTML =
    `<div id="mf-shortcuts-card" role="dialog" aria-label="Keyboard shortcuts">` +
      `<div id="mf-shortcuts-x" title="Close">✕</div>` +
      `<h3>Keyboard shortcuts</h3>` +
      `<table>${rows}</table>` +
      `<p class="mf-sc-note">Copy, paste, duplicate and nudge act on the stamp or label you have selected.` +
      (MAC ? '' : ' On a Chromebook, Alt is the key beside the spacebar.') + `</p>` +
    `</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelector('#mf-shortcuts-x').addEventListener('click', close);
}
function open()  { build(); wrap.classList.add('open'); }
function close() { if (wrap) wrap.classList.remove('open'); }
function isOpen() { return !!wrap && wrap.classList.contains('open'); }
function toggle() { isOpen() ? close() : open(); }

function inTextField(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
// Capture phase so Escape closes the card BEFORE the app's own Escape
// handler backs a tool out; "?" is Shift+/ on most layouts, so match the key.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isOpen()) { close(); e.preventDefault(); e.stopPropagation(); return; }
  // "?" arrives as key '?' on most layouts; some layouts/automation report
  // the physical Slash key with Shift instead — accept both.
  const isQuestion = e.key === '?' || (e.shiftKey && (e.key === '/' || e.code === 'Slash'));
  if (isQuestion && !e.metaKey && !e.ctrlKey && !e.altKey && !inTextField(e)) {
    toggle(); e.preventDefault(); e.stopPropagation();
  }
}, true);

window.showShortcuts = open;
window.toggleShortcuts = toggle;
})();
