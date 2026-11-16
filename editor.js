/* MISSION NOTE - editor.js (self-contained module)
   Builds the Editor page, handles open/new/save (Device or Cloud), unsaved-change protection and local drafts.
   Uses MN.rich (rich-text.js) for the toolbar when present. */
(function () {
'use strict';
if (!window.MN) return;
const { $, esc, icon } = MN;
const css = document.createElement('style');
css.textContent = `
.ed-wrap{display:flex;flex-direction:column;height:100%;width:100%}
.ed-strip{flex:none;display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;border-bottom:1.5px solid var(--p);min-width:0}
.ed-strip .btn{min-height:2.6rem;padding:.2rem .9rem}
.ed-name{flex:1;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-hl{flex:none;margin:.4rem .6rem 0;align-self:flex-start}
.ed-area{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;position:relative;-webkit-overflow-scrolling:touch}
.sv-dest{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:.4rem 0}
.sv-dest button{display:flex;flex-direction:column;align-items:center;gap:.2rem;padding:.7rem .3rem;border:2px solid var(--p);border-radius:var(--r-s);font-weight:700;color:var(--p)}
.sv-dest button.on{background:var(--p);color:#fff}.sv-dest button:disabled{opacity:.45}`;
document.head.appendChild(css);

let ed, tb, area, cur = { id: null }, dirty = false, openedHl = '';
const strip = {};

function build() {
  const root = $('#page-editor'); root.classList.add('flush');
  root.innerHTML = `<div class="ed-wrap"><div id="ed-tb"></div><div class="ed-strip"><button class="btn out" id="ed-new">${icon('i-newfile')} New</button><span class="ed-name" id="ed-name">Untitled note</span><span class="chip" id="ed-state">New</span></div><button class="chip ed-hl" id="ed-hl" hidden></button><div class="ed-area" id="ed-area"><div id="ed"></div></div></div>`;
  ed = $('#ed'); tb = $('#ed-tb'); area = $('#ed-area');
  strip.name = $('#ed-name'); strip.state = $('#ed-state');
  if (MN.rich) MN.rich.mount(tb, ed, { onChange: onEdit, placeholder: 'Start writing your note...' });
  else { ed.contentEditable = 'true'; ed.addEventListener('input', onEdit); tb.textContent = 'Formatting tools are not installed.'; }
  ed.style.minHeight = '100%';
  // gating: only verified + approved members may write
  ed.addEventListener('focusin', () => { if (!MN.canWrite()) { ed.blur(); MN.requireAuth('Sign up or log in to write notes.'); } });
  tb.addEventListener('click', e => { if (!MN.canWrite()) { e.stopPropagation(); e.preventDefault(); MN.requireAuth('Sign up or log in to write notes.'); } }, true);
  $('#ed-new').onclick = () => newNote();
  $('#ed-hl').onclick = () => { MN.hl.clear(); $('#ed-hl').hidden = true; };
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}
const draftSave = MN.debounce(() => {
  const n = cur.id && MN.notes.get(cur.id);
  if (!MN.canWrite() || (n && n.pin) || !ed.textContent.trim()) return;
  MN.setKV('draft', { id: cur.id, name: strip.name.textContent, html: ed.innerHTML, ts: Date.now() });
}, 2500);
function onEdit() { MN.hl.clear(); const h = $('#ed-hl'); if (h) h.hidden = true; if (!dirty) { dirty = true; state(); } draftSave(); }
function state() {
  const n = cur.id && MN.notes.get(cur.id);
  let t = 'New note', k = '';
  if (dirty) { t = 'Unsaved changes'; k = 'bad'; } else if (n) { t = 'Saved to Device'; k = 'ok'; }
  strip.state.className = 'chip ' + k; strip.state.textContent = t;
  strip.name.textContent = n ? n.name : (cur.name || 'Untitled note');
}
async function leaveOk() {
  if (!dirty) return true;
  return MN.modal.confirm({ title: 'Discard unsaved changes?', message: 'Your latest edits have not been saved. Tap Save in the header first, or discard them.', ok: 'Discard', cancel: 'Keep editing', danger: true });
}
function load(n, html) { ed.innerHTML = html; cur = { id: n ? n.id : null, name: n ? n.name : '' }; dirty = false; MN.hl.clear(); $('#ed-hl').hidden = true; ed.dataset.empty = ed.textContent.trim() ? 'false' : 'true'; area.scrollTop = 0; state(); }

async function newNote(go) {
  if (!MN.requireAuth('Sign up or log in to write notes.')) return;
  if (!await leaveOk()) return;
  load(null, ''); await MN.delKV('draft'); if (go) MN.go('editor'); ed.focus();
}
async function open(id, o) {
  if (!MN.requireAuth('Sign in to open your notes.')) return;
  const n = MN.notes.get(id); if (!n) return MN.toast('Note not found', 'err');
  if (cur.id !== id && !await leaveOk()) return;
  if (MN.pin && !await MN.pin.guard(n)) return;
  load(n, MN.sanitize(n.html)); n.opened = Date.now(); await MN.notes.put(n);
  MN.go('editor');
  if (o && o.highlight) setTimeout(() => {
    const c = MN.hl.apply(ed, o.highlight, area);
    if (c) { const h = $('#ed-hl'); h.hidden = false; h.innerHTML = `${esc(c + ' match' + (c > 1 ? 'es' : ''))} for "${esc(o.highlight)}" ${icon('i-close')}`; } else MN.toast('No match found inside this note.', 'info');
  }, 120);
}
function suggest() { const t = (ed.textContent || '').trim().split('\n')[0].replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); return t; }

function requestSave() {
  if (!MN.requireAuth('Sign up or log in to save notes.')) return;
  MN.hl.clear();
  if (!ed.textContent.trim() && !ed.querySelector('li,hr')) return MN.toast('Write something before saving.', 'err');
  const n = cur.id && MN.notes.get(cur.id), cloudOk = MN.feature('cloud') && !!MN.cloud;
  const hd = MN.modal.open({
    title: 'Save note',
    body: `<label class="field"><span>File name</span><input id="sv-name" class="inp" maxlength="80" autocomplete="off" value="${esc(n ? n.name : suggest())}" placeholder="My mission note"></label>
      <div class="sv-dest" id="sv-dest"><button type="button" data-d="device" class="on">${icon('i-device')}Save to Device</button><button type="button" data-d="cloud" ${cloudOk ? '' : 'disabled'}>${icon('i-cloudup')}Push to Cloud</button></div>
      <p class="mut" id="sv-hint">Kept on this phone and available offline.</p><p class="err" id="sv-err" hidden></p>`,
    buttons: [{ label: 'Cancel', kind: 'danger', value: null }, {
      label: 'Save', kind: 'primary', onClick(h) {
        const v = $('#sv-name', h.el).value.trim(), e = MN.validateName(v, cur.id);
        if (e) { const p = $('#sv-err', h.el); p.textContent = e; p.hidden = false; MN.haptic([20, 40, 20]); return false; }
        return { value: { name: v, dest: $('#sv-dest .on', h.el).dataset.d } };
      }
    }]
  });
  let dest = 'device';
  $('#sv-dest', hd.el).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    dest = b.dataset.d; $$all('#sv-dest button', hd.el).forEach(x => x.classList.toggle('on', x === b));
    $('#sv-hint', hd.el).textContent = dest === 'cloud' ? 'Saves to this Device first, then backs it up to Cloud so you can recover it later.' : 'Kept on this phone and available offline.';
  });
  hd.result.then(r => { if (r) doSave(r.name, r.dest); });
}
const $$all = (s, r) => [...(r || document).querySelectorAll(s)];

async function doSave(name, dest) {
  try {
    const html = MN.sanitize(ed.innerHTML), now = Date.now();
    let n = cur.id && MN.notes.get(cur.id);
    if (!n) n = { id: MN.uuid(), created: now, opened: now, trashed: false, pin: null, cloud: null };
    n.name = name; n.html = html; n.text = MN.plain(html); n.updated = now;
    await MN.ensurePersist();
    await MN.notes.put(n);
    cur = { id: n.id, name }; dirty = false; await MN.delKV('draft'); state();
    MN.toast('Saved to Device', 'ok');
    if (dest === 'cloud') await MN.call('cloud', 'push', MN.notes.get(n.id));
    state();
  } catch (e) { MN.modal.alert({ title: 'Could not save', message: 'Saving to Device failed: ' + (e && e.message || e) + '. Free up phone storage and try again.' }); }
}

MN.x('editor', { open, newNote, requestSave, isDirty: () => dirty, current: () => cur });
MN.on('boot', build);
MN.on('page:editor', () => {
  if (!MN.feature('editor')) { MN.toast('The editor is turned off by the administrator.', 'err'); MN.go('home'); return; }
  if (!cur.id && !dirty && MN.canWrite() && MN.kv.draft && !ed.textContent.trim()) {
    const d = MN.kv.draft; load(null, MN.sanitize(d.html)); cur = { id: d.id && MN.notes.get(d.id) ? d.id : null, name: d.name }; dirty = true; state(); MN.toast('Draft restored', 'info');
  }
  state();
});
MN.on('note:trashed', id => { if (cur.id === id) { load(null, ''); } });
MN.on('note:renamed', n => { if (cur.id === n.id) state(); });
MN.on('auth', () => { if (!MN.canWrite() && ed) { load(null, ''); } });
})();
