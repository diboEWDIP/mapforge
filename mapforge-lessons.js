// ── Lessons: teacher instructions attached to a map ─────────────────────────
// First slice (2026-10-18): the "Lesson" header button opens a docked panel
// where a teacher types or pastes instructions. Lines that start with a
// number, a dash, or a bullet become checkbox tasks in the student preview;
// every other line stays plain text (headings, notes). The raw text is saved
// INSIDE the map's .mapforge file (additive `lesson` field, see
// serializeProject / applyRestoredState in mapforge-persist.js), so Save and
// reopen bring it back. Nothing here touches the map engine.
//
// Globals used by the host page:
//   lessonToggle() / lessonOpen() / lessonClose()   — the header button + ✕
//   lessonSerialize()  → { v, instructions } | null  — called by serializeProject
//   lessonRestore(d)                                — called by applyRestoredState
//   lessonReset()                                   — called by resetAnnotations
//   lessonParse(text)  → [{ kind:'task'|'text', text }]
(function () {
'use strict';

const LESSON_VERSION = 1;
const state = { instructions: '' };
let panel = null, ta = null, preview = null;

// ── Parsing ──────────────────────────────────────────────────────────────────
// A task line: "1. Label the Nile", "1) ...", "- ...", "* ...", "• ...", "[ ] ...".
const TASK_RE = /^\s*(?:\d+\s*[.)]|[-*•–—]|\[\s?\]|☐)\s+(.+?)\s*$/;
function lessonParse(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    const m = TASK_RE.exec(line);
    if (m) out.push({ kind: 'task', text: m[1] });
    else   out.push({ kind: 'text', text: line.trim() });
  });
  return out;
}

// ── Panel ────────────────────────────────────────────────────────────────────
const CSS = `
#hdr-lesson-btn { position: relative; }
#hdr-lesson-btn.has-lesson::after { content: ''; position: absolute; top: 4px; right: 6px; width: 7px; height: 7px;
  border-radius: 50%; background: #a06810; box-shadow: 0 0 0 1.5px #FAF5EA; }
#main-area { position: relative; }
#lesson-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 380px; max-width: 70vw; z-index: 40;
  display: none; flex-direction: column; background: #FAF5EA; border-left: 1.5px solid #c8a030;
  box-shadow: -10px 0 30px rgba(20,12,4,0.28); font-family: 'Jost', Georgia, serif; color: #2a1f0e; }
#lesson-panel.open { display: flex; }
#lesson-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px;
  border-bottom: 1px solid #e4dcc8; }
#lesson-head h3 { margin: 0; font-family: 'Colus', 'Jost', Georgia, serif; font-weight: 400; font-size: 16px;
  letter-spacing: 1.5px; text-transform: uppercase; }
#lesson-x { width: 26px; height: 26px; line-height: 26px; text-align: center; border-radius: 50%; cursor: pointer;
  font-size: 14px; color: #5a4020; }
#lesson-x:hover { background: #e8d8a0; }
#lesson-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
#lesson-body > * { flex-shrink: 0; }   /* children grow with their content; the body scrolls */
.lesson-sub { font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: #8a5808; margin-top: 4px; }
#lesson-ta { width: 100%; box-sizing: border-box; min-height: 180px; resize: vertical; background: #ffffff;
  border: 1.5px solid #c8a030; border-radius: 5px; color: #2a1f0e; font: 400 13px/1.5 'Jost', Georgia, serif;
  padding: 8px 10px; outline: none; }
#lesson-ta:focus { border-color: #8a5808; }
.lesson-hint { font-size: 12px; line-height: 1.45; color: #5c5145; }
#lesson-preview { background: #ffffff; border: 1px solid #e4dcc8; border-radius: 8px; padding: 10px 12px; min-height: 60px; }
.lesson-item { display: flex; gap: 9px; align-items: flex-start; padding: 4px 0; font-size: 13px; line-height: 1.45; }
.lesson-item input { margin: 3px 0 0; accent-color: #a06810; flex: 0 0 auto; }
.lesson-item.lesson-text { font-weight: 600; color: #2a1f0e; padding-top: 8px; }
.lesson-item.lesson-text:first-child { padding-top: 2px; }
.lesson-empty { font-size: 12px; color: #8a8070; font-style: italic; }
#lesson-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px;
  border-top: 1px solid #e4dcc8; font-size: 12px; color: #5c5145; }
#lesson-clear { background: #faf5ea; border: 1.5px solid #c8a030; border-radius: 5px; color: #2a1f0e;
  font: 400 12px 'Jost', Georgia, serif; padding: 4px 10px; cursor: pointer; }
#lesson-clear:hover { background: #e8d8a0; }
`;

function build() {
  if (panel) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  panel = document.createElement('div');
  panel.id = 'lesson-panel';
  panel.innerHTML =
    '<div id="lesson-head"><h3>Lesson</h3><div id="lesson-x" title="Close">✕</div></div>' +
    '<div id="lesson-body">' +
      '<div class="lesson-sub">Instructions for students</div>' +
      '<textarea id="lesson-ta" spellcheck="true" placeholder="Part 1: Rivers and cities\n1. Label the Nile River.\n2. Stamp the city of Memphis.\n3. Shade the Nile Delta green."></textarea>' +
      '<div class="lesson-hint">Lines that start with a number, a dash, or a bullet become checkboxes. Other lines stay as headings or notes.</div>' +
      '<div class="lesson-sub">Student preview</div>' +
      '<div id="lesson-preview"></div>' +
    '</div>' +
    '<div id="lesson-foot"><span id="lesson-status">Saved with this map.</span><button id="lesson-clear" type="button">Clear</button></div>';
  const host = document.getElementById('main-area') || document.body;
  host.appendChild(panel);
  ta = panel.querySelector('#lesson-ta');
  preview = panel.querySelector('#lesson-preview');
  panel.querySelector('#lesson-x').addEventListener('click', lessonClose);
  panel.querySelector('#lesson-clear').addEventListener('click', () => {
    if (state.instructions && !confirm('Clear the instructions for this map?')) return;
    ta.value = ''; onInput();
  });
  ta.addEventListener('input', onInput);
  // The host's Escape handler backs tools out one level per press; inside the
  // editor, Escape just closes the panel and stops there.
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); lessonClose(); } });
  renderPreview();
}

function onInput() {
  state.instructions = ta.value;
  renderPreview();
  updateDot();
  if (typeof scheduleAutosave === 'function') scheduleAutosave();
  if (typeof updateSaveIndicator === 'function') updateSaveIndicator();
}

function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }

function renderPreview() {
  if (!preview) return;
  const items = lessonParse(state.instructions);
  if (!items.length) { preview.innerHTML = '<div class="lesson-empty">Students will see your checklist here.</div>'; return; }
  preview.innerHTML = items.map(it => it.kind === 'task'
    ? `<label class="lesson-item"><input type="checkbox" disabled><span>${esc(it.text)}</span></label>`
    : `<div class="lesson-item lesson-text">${esc(it.text)}</div>`).join('');
}

function updateDot() {
  const b = document.getElementById('hdr-lesson-btn'); if (!b) return;
  const has = !!state.instructions.trim();
  b.classList.toggle('has-lesson', has);
  b.title = has ? 'Lesson: edit the instructions and links for students'
                : 'Lesson: instructions and links for students';
}

// ── Public API ───────────────────────────────────────────────────────────────
function lessonOpen() {
  build();
  ta.value = state.instructions;
  renderPreview();
  panel.classList.add('open');
  setTimeout(() => ta.focus(), 0);
}
function lessonClose() { if (panel) panel.classList.remove('open'); }
function lessonToggle() { (panel && panel.classList.contains('open')) ? lessonClose() : lessonOpen(); }

function lessonSerialize() {
  const text = state.instructions || '';
  if (!text.trim()) return null;
  return { v: LESSON_VERSION, instructions: text };
}
function lessonRestore(d) {
  state.instructions = (d && typeof d.instructions === 'string') ? d.instructions : '';
  if (ta) { ta.value = state.instructions; renderPreview(); }
  updateDot();
}
function lessonReset() {
  state.instructions = '';
  if (ta) { ta.value = ''; renderPreview(); }
  lessonClose();
  updateDot();
}

Object.assign(window, { lessonOpen, lessonClose, lessonToggle, lessonSerialize, lessonRestore, lessonReset, lessonParse });
})();
