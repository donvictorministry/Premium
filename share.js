/* MISSION NOTE - share.js (self-contained module)
   Share submenu (Bluetooth, QR Code, WhatsApp), Copy Out, Export (.txt/.html/.mnote) and Import.
   Bluetooth uses the Android share sheet (Web Share API with a file); browsers cannot drive Bluetooth file transfer directly. */
(function () {
'use strict';
if (!window.MN) return;
const { esc } = MN;
const safe = s => String(s || 'note').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80);
const textOf = n => n.name + '\n\n' + MN.plain(n.html);
const guard = n => (MN.pin ? MN.pin.guard(n) : true);
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const htmlDoc = n => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.name)}</title></head><body style="font-family:Roboto,Arial,sans-serif;font-size:19px;line-height:1.6;padding:1rem"><h1>${esc(n.name)}</h1>${MN.sanitize(n.html)}</body></html>`;

async function copyOut(n) {
  if (!await guard(n)) return;
  const txt = textOf(n);
  try {
    if (window.ClipboardItem && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([txt], { type: 'text/plain' }), 'text/html': new Blob([htmlDoc(n)], { type: 'text/html' }) })]);
    else await navigator.clipboard.writeText(txt);
    MN.toast('Copied to clipboard', 'ok');
  } catch (e) {
    try { const t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); MN.toast(ok ? 'Copied to clipboard' : 'Copy failed', ok ? 'ok' : 'err'); } catch (x) { MN.toast('Copy failed', 'err'); }
  }
}
async function exportNote(n) {
  if (!await guard(n)) return;
  const v = await MN.modal.choose({ title: 'Export as', items: [{ label: 'Text file (.txt)', sub: 'Plain text, no formatting', icon: 'i-note', value: 'txt' }, { label: 'Web page (.html)', sub: 'Keeps formatting', icon: 'i-code', value: 'html' }, { label: 'Mission Note file (.mnote)', sub: 'Can be imported back into the app', icon: 'i-export', value: 'mnote' }], cancel: 'Cancel' });
  if (!v) return;
  try {
    const f = safe(n.name);
    if (v === 'txt') download(new Blob([textOf(n)], { type: 'text/plain' }), f + '.txt');
    if (v === 'html') download(new Blob([htmlDoc(n)], { type: 'text/html' }), f + '.html');
    if (v === 'mnote') download(new Blob([JSON.stringify({ format: 'mission-note', v: 1, name: n.name, html: MN.sanitize(n.html), created: n.created, updated: n.updated })], { type: 'application/json' }), f + '.mnote');
    MN.toast('Exported ' + f + '.' + v, 'ok');
  } catch (e) { MN.toast('Export failed', 'err'); }
}
function importFile() {
  if (!MN.requireAuth('Sign in to import notes.')) return;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.mnote,.txt,.html,.htm,text/plain,text/html,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 500000) return MN.toast('That file is too large (limit 500 KB).', 'err');
    MN.loader.show('Importing...');
    try {
      const raw = await f.text(), ext = (f.name.split('.').pop() || '').toLowerCase(); let name = f.name.replace(/\.[^.]+$/, ''), html;
      if (ext === 'mnote') { const j = JSON.parse(raw); if (j.format !== 'mission-note') throw new Error('Not a Mission Note file.'); name = j.name || name; html = MN.sanitize(j.html || ''); }
      else if (ext === 'html' || ext === 'htm') { const d = new DOMParser().parseFromString(raw, 'text/html'); html = MN.sanitize(d.body ? d.body.innerHTML : raw); }
      else html = raw.split(/\r?\n/).map(l => '<p>' + (esc(l) || '<br>') + '</p>').join('');
      name = safe(name).trim() || 'Imported note'; let nm = name, i = 2; while (MN.validateName(nm)) { if (i > 99) throw new Error('Could not name the note.'); nm = name.slice(0, 70) + ' (' + (i++) + ')'; }
      const now = Date.now(); await MN.ensurePersist();
      await MN.notes.put({ id: MN.uuid(), name: nm, html, text: MN.plain(html), created: now, updated: now, opened: 0, trashed: false, pin: null, cloud: null });
      MN.toast('Imported "' + nm + '"', 'ok');
    } catch (e) { MN.modal.alert({ title: 'Import failed', message: e.message || 'The file could not be read.' }); }
    finally { MN.loader.hide(); }
  };
  inp.click();
}
async function bluetooth(n) {
  const file = new File([textOf(n)], safe(n.name) + '.txt', { type: 'text/plain' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: n.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(file, file.name);
  MN.modal.alert({ title: 'Send by Bluetooth', html: '<p>This browser cannot start Bluetooth transfers directly, so the note was saved as a text file in your Downloads.</p><p style="margin-top:.5rem">Open the Files app, long-press the file, tap <b>Share</b> and choose <b>Bluetooth</b>.</p>' });
}
function whatsapp(n) {
  let t = textOf(n); if (t.length > 1500) t = t.slice(0, 1500) + '\n\n(shortened: send the full note with Export)';
  const a = document.createElement('a'); a.href = 'https://wa.me/?text=' + encodeURIComponent(t); a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
async function menu(n) {
  if (!await guard(n)) return;
  const v = await MN.modal.choose({ title: 'Share "' + n.name + '"', items: [{ label: 'Bluetooth', icon: 'i-bt', value: 'bt' }, { label: 'QR Code', icon: 'i-qr', value: 'qr', disabled: !MN.mods.qr }, { label: 'WhatsApp', icon: 'i-share', value: 'wa' }, { label: 'Exit', icon: 'i-close', value: 'x' }] });
  if (v === 'bt') bluetooth(n); else if (v === 'qr') MN.call('qr', 'show', textOf(n), { title: n.name }); else if (v === 'wa') whatsapp(n);
}
MN.x('share', { menu, copyOut, export: exportNote, importFile });
})();
