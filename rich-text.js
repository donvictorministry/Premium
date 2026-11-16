/* MISSION NOTE - rich-text.js (self-contained module)
   Horizontally scrollable formatting toolbar + commands for a contenteditable element.
   Public: MN.rich.mount(toolbarEl, editorEl, {onChange}) */
(function () {
'use strict';
if (!window.MN) return;
const { esc, icon, $ } = MN;
const css = document.createElement('style');
css.textContent = `
.rt-tb{display:flex;gap:.35rem;overflow-x:auto;overflow-y:hidden;padding:.45rem .5rem;border-bottom:2px solid var(--p);background:var(--bg);scrollbar-width:none;-webkit-overflow-scrolling:touch;flex:none}
.rt-tb::-webkit-scrollbar{display:none}
.rt-b{flex:none;width:2.9rem;height:2.9rem;display:grid;place-items:center;border-radius:12px;border:2px solid var(--p);color:var(--p);background:var(--bg)}
.rt-b.on{background:var(--p);color:#fff}.rt-b:active{filter:brightness(.85)}
.rt-sep{flex:none;width:2px;margin:.3rem .15rem;background:var(--p);opacity:.35}
.rt-ed{outline:none;padding:1rem;min-height:100%;font-size:1rem;line-height:1.65;overflow-wrap:anywhere;word-break:break-word;caret-color:var(--p)}
.rt-ed[data-empty=true]::before{content:attr(data-ph);color:var(--mut);pointer-events:none;position:absolute}
.rt-ed h1{font-size:1.8rem;line-height:1.3;margin:.5rem 0}.rt-ed h2{font-size:1.5rem;line-height:1.3;margin:.5rem 0}.rt-ed h3{font-size:1.25rem;line-height:1.3;margin:.5rem 0}
.rt-ed ul,.rt-ed ol{padding-left:1.6rem;margin:.4rem 0}.rt-ed blockquote{border-left:4px solid var(--p);padding-left:.8rem;margin:.5rem 0}
.rt-ed a{color:var(--p);text-decoration:underline}
.sw-row{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0}
.sw-row button{width:2.6rem;height:2.6rem;border-radius:50%;border:2px solid var(--p)}
.sw-prev{height:3rem;border-radius:12px;border:2px solid var(--p);display:grid;place-items:center;font-weight:700;margin-top:.5rem}`;
document.head.appendChild(css);

const GROUPS = [
  [['undo', 'i-undo', 'Undo'], ['redo', 'i-redo', 'Redo']],
  [['bold', 'i-bold', 'Bold'], ['italic', 'i-italic', 'Italic'], ['underline', 'i-underline', 'Underline'], ['strike', 'i-strike', 'Strikethrough']],
  [['heading', 'i-heading', 'Headings'], ['size', 'i-size', 'Font size']],
  [['alignL', 'i-al', 'Align left'], ['alignC', 'i-ac', 'Align center'], ['alignR', 'i-ar', 'Align right'], ['alignJ', 'i-aj', 'Justify']],
  [['color', 'i-color', 'Text color'], ['hilite', 'i-hl', 'Highlight']],
  [['ul', 'i-ul', 'Bulleted list'], ['ol', 'i-ol', 'Numbered list'], ['outdent', 'i-outdent', 'Decrease indent'], ['indent', 'i-indent', 'Increase indent']],
  [['link', 'i-link', 'Link'], ['clear', 'i-clear', 'Clear formatting']]
];
const SWATCHES = ['#000000', '#FFFFFF', '#1877F2', '#D93025', '#188038', '#F9AB00', '#8E24AA', '#FFEB3B', '#80DEEA', '#FFCDD2'];
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = v => { v = String(v || '').trim(); if (!HEX.test(v)) return null; v = v.replace('#', ''); if (v.length === 3) v = v.split('').map(c => c + c).join(''); return '#' + v.toUpperCase(); };

function mount(tb, ed, opts) {
  opts = opts || {};
  tb.className = 'rt-tb'; ed.classList.add('rt-ed'); ed.setAttribute('contenteditable', 'true'); ed.setAttribute('spellcheck', 'true'); ed.dataset.ph = opts.placeholder || 'Start writing...';
  tb.innerHTML = GROUPS.map(g => g.map(b => `<button type="button" class="rt-b" data-c="${b[0]}" aria-label="${b[2]}" title="${b[2]}">${icon(b[1])}</button>`).join('')).join('<span class="rt-sep"></span>');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, true); } catch (e) {}
  let saved = null;
  const inEd = n => n && ed.contains(n);
  const save = () => { const s = getSelection(); if (s.rangeCount && inEd(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
  const restore = () => { ed.focus(); if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); } };
  const ex = (c, v) => { restore(); document.execCommand('styleWithCSS', false, true); document.execCommand(c, false, v == null ? null : v); save(); changed(); };
  const empty = () => { ed.dataset.empty = (!ed.textContent.trim() && !ed.querySelector('li,hr')) ? 'true' : 'false'; };
  const changed = () => { empty(); opts.onChange && opts.onChange(); active(); };
  const active = () => {
    const st = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', ul: 'insertUnorderedList', ol: 'insertOrderedList', alignL: 'justifyLeft', alignC: 'justifyCenter', alignR: 'justifyRight', alignJ: 'justifyFull' };
    for (const k in st) { const b = tb.querySelector(`[data-c="${k}"]`); let on = false; try { on = inEd(getSelection().anchorNode) && document.queryCommandState(st[k]); } catch (e) {} b.classList.toggle('on', !!on); }
  };
  document.addEventListener('selectionchange', () => { if (inEd(getSelection().anchorNode)) { save(); active(); } });
  ed.addEventListener('input', changed);
  ed.addEventListener('paste', e => {
    e.preventDefault(); const cd = e.clipboardData, html = cd.getData('text/html'), tx = cd.getData('text/plain');
    if (html) document.execCommand('insertHTML', false, MN.sanitize(html)); else document.execCommand('insertText', false, tx); changed();
  });
  ed.addEventListener('drop', e => e.preventDefault());
  tb.addEventListener('mousedown', e => { if (e.target.closest('.rt-b')) e.preventDefault(); });

  const needSel = () => { restore(); const s = getSelection(); if (!s.rangeCount || s.isCollapsed) { MN.toast('Select some text first.', 'info'); return false; } return true; };
  async function pickColor(kind) {
    const cur = kind === 'color' ? '#1877F2' : '#FFEB3B';
    const hd = MN.modal.open({
      title: kind === 'color' ? 'Text color' : 'Highlight color',
      body: `<label class="field"><span>Hex color (for example #D93025)</span><input class="inp" id="hx" maxlength="7" autocapitalize="characters" value="${cur}"></label><div class="sw-row">${SWATCHES.map(c => `<button type="button" data-h="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div><div class="sw-prev" id="hp">Sample text</div><p class="err" hidden></p>`,
      buttons: [{ label: 'Cancel', kind: 'danger', value: null }, ...(kind === 'hilite' ? [{ label: 'None', kind: 'out', value: 'none' }] : []), { label: 'Apply', kind: 'primary', onClick(h) { const v = normHex($('#hx', h.el).value); if (!v) { const p = $('.err', h.el); p.textContent = 'Enter a valid hex color such as #1877F2.'; p.hidden = false; return false; } return { value: v }; } }]
    });
    const hx = $('#hx', hd.el), hp = $('#hp', hd.el);
    const prev = () => { const v = normHex(hx.value); if (v) { if (kind === 'color') hp.style.color = v; else hp.style.background = v; } };
    hx.addEventListener('input', prev); hd.el.addEventListener('click', e => { const s = e.target.closest('[data-h]'); if (s) { hx.value = s.dataset.h; prev(); } }); prev();
    const v = await hd.result; if (!v) return;
    if (kind === 'color') { ex('foreColor', v); tb.querySelector('[data-c=color]').style.setProperty('--sw', v); }
    else { ex('hiliteColor', v === 'none' ? 'transparent' : v); if (v !== 'none') tb.querySelector('[data-c=hilite]').style.setProperty('--sw', v); }
  }
  const A = {
    undo: () => ex('undo'), redo: () => ex('redo'), bold: () => ex('bold'), italic: () => ex('italic'), underline: () => ex('underline'), strike: () => ex('strikeThrough'),
    alignL: () => ex('justifyLeft'), alignC: () => ex('justifyCenter'), alignR: () => ex('justifyRight'), alignJ: () => ex('justifyFull'),
    ul: () => ex('insertUnorderedList'), ol: () => ex('insertOrderedList'), indent: () => ex('indent'), outdent: () => ex('outdent'),
    clear: () => { restore(); document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'p'); save(); changed(); },
    async heading() { const v = await MN.modal.choose({ title: 'Text style', items: [{ label: 'Normal text', value: 'p' }, { label: 'Heading 1', value: 'h1' }, { label: 'Heading 2', value: 'h2' }, { label: 'Heading 3', value: 'h3' }, { label: 'Quote', value: 'blockquote' }], cancel: 'Cancel' }); if (v) ex('formatBlock', v); },
    async size() {
      const px = await MN.modal.choose({ title: 'Font size', items: [19, 22, 26, 32, 40].map(n => ({ label: n + ' px' + (n === 19 ? ' (default)' : ''), value: n })), cancel: 'Cancel' }); if (!px) return;
      if (!needSel()) return;
      document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, '7');
      ed.querySelectorAll('font[size="7"]').forEach(f => { const s = document.createElement('span'); s.style.fontSize = px + 'px'; while (f.firstChild) s.appendChild(f.firstChild); f.replaceWith(s); });
      document.execCommand('styleWithCSS', false, true); save(); changed();
    },
    color: () => pickColor('color'), hilite: () => pickColor('hilite'),
    async link() {
      const sel = saved && saved.toString();
      const v = await MN.modal.input({ title: 'Insert link', label: 'Web address', value: 'https://', maxlength: 500, inputmode: 'url', ok: 'Add link', validate: x => { x = x.trim(); if (!x || x === 'https://') return 'Enter a web address.'; if (/^(javascript|data):/i.test(x)) return 'That link type is not allowed.'; return ''; } });
      if (v == null) return; let u = v.trim(); if (!/^(https?:|mailto:|tel:)/i.test(u)) u = 'https://' + u;
      restore(); if (!sel) document.execCommand('insertHTML', false, `<a href="${esc(u)}">${esc(u)}</a>`); else document.execCommand('createLink', false, u);
      save(); changed();
    }
  };
  tb.addEventListener('click', e => { const b = e.target.closest('.rt-b'); if (b) A[b.dataset.c](); });
  empty();
  return { focus: () => ed.focus(), refresh: () => { empty(); active(); } };
}
MN.x('rich', { mount });
})();
