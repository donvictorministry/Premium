/* MISSION NOTE - application core (with index.html and styles.css).
   Provides: namespace + event bus, Device storage (IndexedDB), custom modal/toast/loader/notification framework,
   navigation, public info modals, quick tools, Home and Files pages, config/maintenance handling.
   Feature modules (api, editor, account, rich-text, pin, qrcode, share, page-cover) attach through window.MN. */
(function () {
'use strict';
const MN = window.MN = { v: '1.0.0', kv: {}, mods: {}, cfg: null, cache: { notes: [] }, blocked: false, session: null };

/* ---------- utilities ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, c) => `<svg class="ic ${c || ''}"><use href="#${n}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const fmt = ms => ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
Object.assign(MN, { $, $$, esc, icon, sleep, uuid, fmt, debounce });
MN.x = (name, obj) => { MN[name] = obj; MN.mods[name] = obj; return obj; };
MN.call = (mod, fn, ...a) => {
  const m = MN.mods[mod];
  if (m && typeof m[fn] === 'function') return m[fn](...a);
  MN.toast('This feature is not installed on this build.', 'err'); return undefined;
};
MN.haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms || 10); } catch (e) {} };
MN.feature = k => !MN.cfg || !MN.cfg.features || MN.cfg.features[k] !== false;

/* ---------- event bus ---------- */
const L = {};
MN.on = (e, f) => { (L[e] = L[e] || []).push(f); };
MN.off = (e, f) => { L[e] = (L[e] || []).filter(x => x !== f); };
MN.emit = (e, d) => (L[e] || []).slice().forEach(f => { try { f(d); } catch (x) { console.error(e, x); } });

/* ---------- Device storage (IndexedDB) ---------- */
let DB;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('missionnote', 1);
  r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' }); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' }); };
  r.onsuccess = () => { DB = r.result; res(DB); }; r.onerror = () => rej(r.error);
});
const tx = (store, mode, fn) => new Promise((res, rej) => {
  const t = DB.transaction(store, mode), s = t.objectStore(store); let out; const q = fn(s);
  if (q) q.onsuccess = () => { out = q.result; };
  t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
});
MN.db = { all: () => tx('notes', 'readonly', s => s.getAll()), get: id => tx('notes', 'readonly', s => s.get(id)), put: n => tx('notes', 'readwrite', s => s.put(n)), del: id => tx('notes', 'readwrite', s => s.delete(id)) };
MN.setKV = (k, v) => { MN.kv[k] = v; return tx('kv', 'readwrite', s => s.put({ k, v })); };
MN.delKV = k => { delete MN.kv[k]; return tx('kv', 'readwrite', s => s.delete(k)); };
MN.notes = {
  async reload() { MN.cache.notes = await MN.db.all(); return MN.cache.notes; },
  all: () => MN.cache.notes,
  get: id => MN.cache.notes.find(n => n.id === id),
  async put(n) { await MN.db.put(n); const i = MN.cache.notes.findIndex(x => x.id === n.id); if (i < 0) MN.cache.notes.push(n); else MN.cache.notes[i] = n; MN.emit('notes', n); return n; },
  async del(id) { await MN.db.del(id); MN.cache.notes = MN.cache.notes.filter(n => n.id !== id); MN.emit('notes'); }
};
MN.ensurePersist = async () => {
  if (!(navigator.storage && navigator.storage.persist)) return;
  try {
    if (await navigator.storage.persisted()) return;
    if (!MN.kv.persistAsked) {
      await MN.setKV('persistAsked', Date.now());
      await MN.modal.open({ title: 'Keep your notes safe', body: '<p>Mission Note will now ask your browser to protect Device notes from being cleared when storage runs low. If your phone asks for permission, tap Allow.</p>', buttons: [{ label: 'Continue', kind: 'primary' }] }).result;
    }
    await navigator.storage.persist();
  } catch (e) {}
};

/* ---------- text helpers + sanitizer ---------- */
MN.plain = html => {
  const d = new DOMParser().parseFromString('<body>' + String(html || '').replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, '\n') + '</body>', 'text/html');
  return (d.body.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
};
const OK_TAGS = new Set(['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'sub', 'sup', 'hr']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'noscript', 'svg', 'math', 'template', 'form', 'input', 'button', 'textarea', 'select', 'img', 'video', 'audio']);
const OK_CSS = { 'color': 1, 'background-color': 1, 'font-size': 1, 'text-align': 1, 'font-weight': 1, 'font-style': 1, 'text-decoration': 1, 'text-decoration-line': 1, 'margin-left': 1, 'padding-left': 1 };
const OK_VAL = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z-]+|\d+(\.\d+)?(px|pt|em|rem|%))$/i;
MN.sanitize = html => {
  const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  (function walk(n) {
    [...n.childNodes].forEach(c => {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { c.remove(); return; }
      let t = c.tagName.toLowerCase();
      if (DROP.has(t)) { c.remove(); return; }
      if (t === 'font') { const s = document.createElement('span'); if (c.getAttribute('color')) s.style.color = c.getAttribute('color'); while (c.firstChild) s.appendChild(c.firstChild); c.replaceWith(s); c = s; t = 'span'; }
      if (!OK_TAGS.has(t)) { walk(c); c.replaceWith(...c.childNodes); return; }
      [...c.attributes].forEach(a => {
        const nm = a.name.toLowerCase();
        if (nm === 'style') {
          const keep = []; for (let i = 0; i < c.style.length; i++) { const p = c.style[i], v = c.style.getPropertyValue(p).trim(); if (OK_CSS[p] && OK_VAL.test(v)) keep.push(p + ':' + v); }
          if (keep.length) c.setAttribute('style', keep.join(';')); else c.removeAttribute('style');
        } else if (t === 'a' && nm === 'href') { if (!/^(https?:|mailto:|tel:)/i.test(a.value.trim())) c.removeAttribute('href'); }
        else c.removeAttribute(a.name);
      });
      if (t === 'a') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); }
      walk(c);
    });
  })(doc.body);
  return doc.body.innerHTML;
};
MN.validateName = (v, exceptId) => {
  v = String(v || '').trim();
  if (!v) return 'Enter a file name.';
  if (v.length > 80) return 'Use 80 characters or fewer.';
  if (/[\\\/:*?"<>|\u0000-\u001f]/.test(v)) return 'Do not use \\ / : * ? " < > |';
  if (/^\.+$/.test(v) || /[. ]$/.test(v)) return 'The name cannot end with a dot or space.';
  if (MN.cache.notes.some(n => !n.trashed && n.id !== exceptId && n.name.toLowerCase() === v.toLowerCase())) return 'A note with this name already exists.';
  return '';
};
MN.snippet = (text, q) => {
  const t = String(text || ''), i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1; if (i < 0) return esc(t.slice(0, 90));
  const a = Math.max(0, i - 35), b = Math.min(t.length, i + q.length + 55);
  return (a ? '...' : '') + esc(t.slice(a, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length, b)) + (b < t.length ? '...' : '');
};
MN.hlText = (s, q) => { s = String(s); const i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1; return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length)); };
MN.cloudState = n => !n.cloud ? null : (n.cloud.status === 'Failed' ? 'Failed' : ((n.updated > (n.cloud.cloudUpdated || 0)) ? 'Pending' : 'Synced'));

/* ---------- search highlight ---------- */
MN.hl = {
  marks: [],
  apply(root, term, scroller) {
    this.clear(); term = (term || '').trim(); if (!term) return 0;
    const low = term.toLowerCase(), w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), found = []; let nd;
    while ((nd = w.nextNode())) { const t = nd.nodeValue.toLowerCase(); let i = 0; while ((i = t.indexOf(low, i)) >= 0) { const r = document.createRange(); r.setStart(nd, i); r.setEnd(nd, i + low.length); found.push(r); i += low.length; } }
    if (!found.length) return 0;
    let rect;
    if (window.Highlight && window.CSS && CSS.highlights) { CSS.highlights.set('mn-hit', new Highlight(...found)); rect = found[0].getBoundingClientRect(); }
    else { for (let k = found.length - 1; k >= 0; k--) { const m = document.createElement('mark'); m.className = 'mn-mark'; found[k].surroundContents(m); this.marks.push(m); } rect = this.marks[this.marks.length - 1].getBoundingClientRect(); }
    const sc = scroller || root, sr = sc.getBoundingClientRect();
    sc.scrollTop += rect.top - (sr.top + sr.height / 2) + rect.height / 2;
    return found.length;
  },
  clear() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('mn-hit');
    this.marks.forEach(m => { const p = m.parentNode; if (!p) return; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize(); });
    this.marks = [];
  }
};

/* ---------- overlay history (Android back button closes overlays) ---------- */
const overlays = []; let sentinel = false, ignorePop = 0;
const ovOpen = o => { overlays.push(o); if (!sentinel) { history.pushState({ mn: 1 }, ''); sentinel = true; } };
const ovClose = o => {
  const i = overlays.indexOf(o); if (i >= 0) overlays.splice(i, 1);
  setTimeout(() => { if (!overlays.length && sentinel) { sentinel = false; ignorePop++; history.back(); } }, 0);
};
window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; if (overlays.length) { history.pushState({ mn: 1 }, ''); sentinel = true; } return; }
  sentinel = false; const o = overlays[overlays.length - 1];
  if (o) { o.close(null, true); if (overlays.length) { history.pushState({ mn: 1 }, ''); sentinel = true; } }
});

/* ---------- loader / toast / notifications ---------- */
let lc = 0;
MN.loader = {
  show(t) { lc++; $('#loader-text').textContent = t || ''; $('#layer-loader').hidden = false; },
  hide() { lc = Math.max(0, lc - 1); if (!lc) $('#layer-loader').hidden = true; },
  async wrap(t, fn) { this.show(t); try { return await fn(); } finally { this.hide(); } }
};
let toastT;
MN.toast = (msg, type) => {
  type = type || 'info'; const lay = $('#layer-toast'); lay.innerHTML = '';
  const el = document.createElement('div'); el.className = 'toast ' + type; el.setAttribute('role', 'status');
  el.innerHTML = icon(type === 'ok' ? 'i-check' : type === 'err' ? 'i-warn' : 'i-info') + '<span>' + esc(msg) + '</span>';
  lay.appendChild(el); clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 2200 + Math.min(2500, msg.length * 25));
  MN.haptic(type === 'err' ? [20, 40, 20] : 12);
};
MN.notify = o => {
  const el = document.createElement('div'); el.className = 'notif';
  el.innerHTML = icon(o.icon || 'i-bell') + `<div class="nb"><b>${esc(o.title || '')}</b>${esc(o.msg || '')}</div>` + (o.action ? `<button class="btn">${esc(o.action)}</button>` : '') + `<button class="ib" aria-label="Dismiss" style="width:2.4rem;height:2.4rem;color:var(--p)">${icon('i-close')}</button>`;
  const rm = () => el.remove(); el.querySelector('.ib').onclick = rm;
  if (o.action) el.querySelector('.btn').onclick = () => { rm(); o.onAction && o.onAction(); };
  $('#layer-notif').appendChild(el); if (!o.sticky) setTimeout(rm, 9000); return el;
};

/* ---------- reusable custom modal framework ---------- */
MN.modal = {
  open(o) {
    o = o || {};
    const el = document.createElement('div'); el.className = 'mdl' + (o.full ? ' full' : '');
    el.innerHTML = `<div class="box" role="dialog" aria-modal="true"><div class="mh"><h2></h2>${o.noX ? '' : `<button class="ib x" aria-label="Close">${icon('i-close')}</button>`}</div><div class="mb"></div><div class="mf" hidden></div></div>`;
    const mb = $('.mb', el), mf = $('.mf', el); let done; const result = new Promise(r => { done = r; });
    const hd = {
      el, body: mb, result, closed: false,
      set(p) {
        if (p.title !== undefined) $('h2', el).textContent = p.title;
        if (p.body !== undefined) { mb.innerHTML = ''; if (typeof p.body === 'string') mb.innerHTML = p.body; else mb.appendChild(p.body); }
        if (p.buttons) {
          mf.innerHTML = ''; mf.hidden = !p.buttons.length; mf.classList.toggle('stack', !!p.stack);
          p.buttons.forEach(b => {
            const bt = document.createElement('button'); bt.className = 'btn ' + (b.kind === 'primary' || !b.kind ? '' : b.kind); bt.textContent = b.label; if (b.id) bt.id = b.id;
            bt.onclick = async () => { if (b.onClick) { const r = await b.onClick(hd); if (r === false) return; if (r && r.value !== undefined) return hd.close(r.value); } hd.close(b.value !== undefined ? b.value : b.label); };
            mf.appendChild(bt);
          });
        }
      },
      close(v, fromPop) { if (hd.closed) return; hd.closed = true; el.remove(); ovClose(hd); if (o.onClose) o.onClose(v); done(v === undefined ? null : v); }
    };
    hd.set({ title: o.title || '', body: o.body || '', buttons: o.buttons || [], stack: o.stack });
    const x = $('.x', el); if (x) x.onclick = () => hd.close(null);
    if (!o.full && o.dismiss !== false) el.addEventListener('click', e => { if (e.target === el) hd.close(null); });
    $('#layer-modal').appendChild(el); ovOpen(hd);
    setTimeout(() => { const f = $('input:not([type=range]),textarea', el); if (f && o.focus !== false) f.focus(); }, 60);
    return hd;
  },
  confirm(o) { return this.open({ title: o.title, body: `<p>${esc(o.message)}</p>`, buttons: [{ label: o.cancel || 'Cancel', kind: 'out', value: false }, { label: o.ok || 'Confirm', kind: o.danger ? 'danger' : 'primary', value: true }] }).result.then(v => v === true); },
  alert(o) { return this.open({ title: o.title, body: o.html || `<p>${esc(o.message)}</p>`, buttons: [{ label: o.ok || 'OK', kind: 'primary', value: true }] }).result; },
  input(o) {
    const id = 'in' + Date.now();
    return new Promise(res => {
      const hd = this.open({
        title: o.title,
        body: `${o.note ? `<p class="mut" style="margin-bottom:.4rem">${esc(o.note)}</p>` : ''}<label class="field"><span>${esc(o.label || '')}</span><input id="${id}" class="inp" type="${o.type || 'text'}" ${o.inputmode ? `inputmode="${o.inputmode}"` : ''} maxlength="${o.maxlength || 80}" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}" autocomplete="off"></label><p class="err" hidden></p>`,
        buttons: [{ label: 'Cancel', kind: 'danger', value: null }, { label: o.ok || 'OK', kind: 'primary', onClick(h) { const v = $('#' + id, h.el).value, e = o.validate ? o.validate(v) : ''; if (e) { const p = $('.err', h.el); p.textContent = e; p.hidden = false; MN.haptic([20, 40, 20]); return false; } return { value: v.trim ? v.trim() : v }; } }]
      });
      hd.result.then(res);
    });
  },
  choose(o) {
    return new Promise(res => {
      const hd = this.open({ title: o.title, body: (o.message ? `<p class="mut" style="margin-bottom:.4rem">${esc(o.message)}</p>` : '') + o.items.map((it, i) => `<button class="li ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled style="opacity:.5"' : ''}>${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join(''), buttons: o.cancel ? [{ label: o.cancel, kind: 'out', value: null }] : [], focus: false });
      hd.body.addEventListener('click', e => { const b = e.target.closest('.li'); if (b && !b.disabled) hd.close(o.items[+b.dataset.i].value); });
      hd.result.then(res);
    });
  }
};
document.addEventListener('pointerdown', e => { if (e.target.closest('button,.ni,.row,.cbtn,.li')) MN.haptic(8); }, { passive: true });

/* ---------- preferences ---------- */
MN.setTheme = dark => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); try { localStorage.setItem('mn.theme', dark ? 'dark' : 'light'); } catch (e) {} };
MN.setFont = px => { px = Math.min(22, Math.max(19, px | 0)); document.documentElement.style.setProperty('--fs', px + 'px'); try { localStorage.setItem('mn.fs', px); } catch (e) {} return px; };
MN.isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

/* ---------- session (managed by account.js, read by core) ---------- */
MN.setSession = async s => { MN.session = s; if (s) await MN.setKV('session', s); else await MN.delKV('session'); MN.emit('auth', s); };
MN.canWrite = () => { const s = MN.session; return !!(s && s.token && s.exp > Date.now() && s.user && s.user.verified && s.user.status === 'Approved'); };
MN.requireAuth = msg => { if (MN.canWrite()) return true; if (MN.mods.account) MN.mods.account.gate(msg); else MN.toast('Sign in to use this feature.', 'err'); return false; };

/* ---------- config from server (piggybacked on every backend response) ---------- */
MN.applyConfig = cfg => {
  if (!cfg) return;
  MN.cfg = cfg; MN.setKV('cfg', cfg);
  const lock = $('#layer-lock');
  if (cfg.maintenance) {
    lock.hidden = false;
    lock.innerHTML = `<div class="card" style="width:100%;text-align:center"><div class="empty">${icon('i-warn')}<h2>Under maintenance</h2><p>${esc(cfg.maintenanceMessage || 'Mission Note will be back shortly.')}</p></div><button class="btn block" id="lock-retry">${icon('i-refresh')} Check again</button></div>`;
    $('#lock-retry').onclick = () => MN.call('api', 'refreshConfig');
  } else lock.hidden = true;
  const tk = $('#ticker'), list = (cfg.announcements || []).filter(Boolean);
  if (cfg.ticker && list.length) { tk.hidden = false; $('.tk-track', tk).innerHTML = list.map(m => `<span>${esc(m)}</span>`).join(''); tk.style.setProperty('--tk', Math.max(18, list.join('').length * 0.28 + 12) + 's'); }
  else tk.hidden = true;
  MN.emit('cfg', cfg); renderRight();
};

/* ---------- navigation ---------- */
let cur = 'home';
MN.page = () => cur;
MN.go = (p, o) => {
  if (!['home', 'editor', 'files', 'account'].includes(p)) return;
  cur = p;
  $$('.page').forEach(e => { e.hidden = e.dataset.page !== p; });
  $$('#bnav button').forEach(b => b.classList.toggle('on', b.dataset.go === p));
  $('#btn-save').hidden = p !== 'editor';
  MN.emit('page', p); MN.emit('page:' + p, o);
};
function drawer(side, open) {
  const d = $('#drawer-' + side), sc = $('#drawer-scrim');
  if (!open) { if (d._h) d._h.close(); return; }
  if (d._h && !d._h.closed) return;
  d.hidden = false; sc.hidden = false;
  const h = { closed: false, close() { if (h.closed) return; h.closed = true; d.hidden = true; sc.hidden = true; ovClose(h); } };
  d._h = h; ovOpen(h); sc.onclick = () => h.close();
}
MN.closeDrawers = () => { drawer('left', false); drawer('right', false); };

/* ---------- left sidebar: public information (read-only, never gated) ---------- */
const INFO = [['About the App', 'sec-about', 'i-info'], ['About the Developer', 'sec-developer', 'i-code'], ['How to Use', 'sec-howto', 'i-book'], ['Terms of Use', 'sec-terms', 'i-terms'], ['Proprietary Software Warning', 'sec-proprietary', 'i-warn'], ['Support Us', 'sec-support', 'i-heart'], ['Contact Us', 'sec-contact', 'i-mail']];
function renderLeft() {
  $('#drawer-left').innerHTML = '<h3>Mission Note</h3>' + INFO.map((x, i) => `<button class="row" data-i="${i}">${icon(x[2])}<span>${esc(x[0])}</span></button>`).join('');
}
MN.info = i => {
  const [title, tpl] = INFO[i], t = document.getElementById(tpl), frag = t.content.cloneNode(true);
  $$('[data-contact]', frag).forEach(n => n.appendChild(document.getElementById('tpl-contact-icons').content.cloneNode(true)));
  const wrap = document.createElement('div'); wrap.appendChild(frag);
  const hd = MN.modal.open({ title, full: true, body: wrap, focus: false });
  requestAnimationFrame(() => $$('[data-bio]', hd.el).forEach(b => { const btn = b.parentNode.querySelector('[data-more]'); if (b.scrollHeight > b.clientHeight + 2) btn.hidden = false; }));
};
document.addEventListener('click', e => {
  const m = e.target.closest('[data-more]'); if (!m) return;
  const b = m.parentNode.querySelector('[data-bio]'); b.classList.toggle('open'); m.textContent = b.classList.contains('open') ? 'Show Less' : 'Show More';
});

/* ---------- right sidebar: quick tools ---------- */
function renderRight() {
  const f = MN.feature, px = parseInt(getComputedStyle(document.documentElement).fontSize, 10) || 19;
  $('#drawer-right').innerHTML = '<h3>Quick tools</h3>' +
    `<button class="row" data-t="dark">${icon(MN.isDark() ? 'i-moon' : 'i-sun')}<span>Dark Mode</span><span class="switch sw ${MN.isDark() ? 'on' : ''}"></span></button>` +
    (f('todo') ? `<button class="row" data-t="todo">${icon('i-todo')}<span>To-do List</span></button>` : '') +
    (f('calculator') ? `<button class="row" data-t="calc">${icon('i-calc')}<span>Calculator</span></button>` : '') +
    `<button class="row" data-t="font">${icon('i-fs')}<span>Font Size<small>${px}px</small></span></button>` +
    `<button class="row" data-t="install">${icon('i-install')}<span>Install App</span></button>` +
    (f('share') ? `<button class="row" data-t="shareapp">${icon('i-share')}<span>Share App</span></button>` : '');
}
let deferred = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; MN.toast('Mission Note installed', 'ok'); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const TOOLS = {
  dark() { MN.setTheme(!MN.isDark()); renderRight(); },
  todo() {
    if (!MN.requireAuth('Sign in to use your to-do list.')) return; MN.closeDrawers();
    const hd = MN.modal.open({ title: 'To-do List', body: `<label class="field"><span>Up to 500 characters</span><textarea id="td" class="inp" maxlength="500" rows="9" placeholder="Write your tasks here"></textarea></label><p class="mut" id="td-n">0 / 500</p>`, buttons: [{ label: 'Clear', kind: 'out', onClick() { const t = $('#td'); t.value = ''; $('#td-n').textContent = '0 / 500'; MN.setKV('todo', ''); MN.toast('To-do cleared', 'ok'); return false; } }, { label: 'Save', kind: 'primary', async onClick() { await MN.setKV('todo', $('#td').value.slice(0, 500)); MN.toast('To-do saved', 'ok'); } }] });
    const t = $('#td', hd.el); t.value = MN.kv.todo || ''; $('#td-n', hd.el).textContent = t.value.length + ' / 500';
    t.addEventListener('input', () => { $('#td-n', hd.el).textContent = t.value.length + ' / 500'; });
  },
  calc() {
    if (!MN.requireAuth('Sign in to use the calculator.')) return; MN.closeDrawers();
    let acc = null, op = null, cur = '0', fresh = true;
    const keys = ['C', '\u232B', '%', '\u00F7', '7', '8', '9', '\u00D7', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '=', ''];
    const hd = MN.modal.open({ title: 'Calculator', body: `<div class="calc-d" id="cd">0</div><div class="calc-k">${keys.map(k => k ? `<button data-k="${k}" class="${/[\u00F7\u00D7+\-=]/.test(k) ? 'op' : ''}">${k}</button>` : '<span></span>').join('')}</div>`, focus: false });
    const show = () => { $('#cd', hd.el).textContent = cur; };
    const num = () => parseFloat(cur), fix = v => String(Math.round(v * 1e10) / 1e10);
    const run = () => { if (acc === null || !op) return num(); const a = acc, b = num(); return op === '+' ? a + b : op === '-' ? a - b : op === '\u00D7' ? a * b : (b === 0 ? NaN : a / b); };
    hd.el.addEventListener('click', e => {
      const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k;
      if (/\d/.test(k)) { cur = fresh || cur === '0' ? k : cur + k; fresh = false; }
      else if (k === '.') { if (fresh) { cur = '0.'; fresh = false; } else if (!cur.includes('.')) cur += '.'; }
      else if (k === 'C') { acc = null; op = null; cur = '0'; fresh = true; }
      else if (k === '\u232B') { cur = cur.length > 1 ? cur.slice(0, -1) : '0'; }
      else if (k === '%') { cur = fix(num() / 100); fresh = true; }
      else if (k === '=') { if (op) { const r = run(); cur = isNaN(r) ? 'Cannot divide by 0' : fix(r); acc = null; op = null; fresh = true; if (isNaN(r)) cur = 'Error'; } }
      else { if (op && !fresh) { const r = run(); acc = isNaN(r) ? null : r; cur = isNaN(r) ? 'Error' : fix(r); } else acc = num(); op = k; fresh = true; }
      if (cur === 'Error') { acc = null; op = null; } show();
    });
  },
  font() {
    MN.closeDrawers(); const now = parseInt(getComputedStyle(document.documentElement).fontSize, 10) || 19;
    const hd = MN.modal.open({ title: 'Font Size', body: `<p class="mut">Choose 19px to 22px.</p><input id="fr" class="range" type="range" min="19" max="22" step="1" value="${now}"><p style="text-align:center;font-weight:700" id="fv">${now}px</p>`, buttons: [{ label: 'Done', kind: 'primary' }], focus: false });
    $('#fr', hd.el).addEventListener('input', e => { const v = MN.setFont(+e.target.value); $('#fv', hd.el).textContent = v + 'px'; renderRight(); });
  },
  async install() {
    MN.closeDrawers();
    if (standalone()) return MN.toast('Mission Note is already installed.', 'ok');
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice; deferred = null; return r.outcome === 'accepted' ? MN.toast('Installing...', 'ok') : MN.toast('Install cancelled'); }
    MN.modal.alert({ title: 'Install Mission Note', html: '<p>Open the Chrome menu (three dots), then tap <b>Install app</b> or <b>Add to Home screen</b>.</p>' });
  },
  async shareapp() {
    MN.closeDrawers(); const url = location.href.split('#')[0].split('?')[0];
    if (navigator.share) { try { await navigator.share({ title: 'Mission Note', text: 'Join me on Mission Note, a private community notebook.', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const hd = MN.modal.open({ title: 'Share App', body: `<p class="mut">Send this link to a friend:</p><p style="font-weight:700;overflow-wrap:anywhere">${esc(url)}</p>`, buttons: [{ label: 'Copy link', kind: 'primary', async onClick() { try { await navigator.clipboard.writeText(url); MN.toast('Link copied', 'ok'); } catch (e) { MN.toast('Could not copy', 'err'); } return false; } }, ...(MN.mods.qr && MN.feature('qr') ? [{ label: 'QR Code', kind: 'out', onClick() { MN.qr.show(url, { title: 'Mission Note' }); return false; } }] : []), { label: 'Close', kind: 'out' }], stack: true });
  }
};

/* ---------- Home ---------- */
function renderHome() {
  const root = $('#page-home'), s = MN.session, u = s && s.user, notes = MN.cache.notes.filter(n => !n.trashed).sort((a, b) => b.updated - a.updated);
  const recent = notes.filter(n => n.opened).sort((a, b) => b.opened - a.opened).slice(0, 3);
  const item = n => `<div class="ni" data-open="${n.id}">${icon('i-note')}<div class="meta"><div class="nm">${esc(n.name)}</div><div class="sub">${fmt(n.updated)}</div></div>${n.pin ? icon('i-lock') : ''}</div>`;
  let acct;
  if (MN.canWrite()) acct = `<article class="card"><div class="head"><h2>Your account</h2><span class="chip ok">${icon('i-check')} Approved</span></div><p>Signed in as <b>${esc(u.name)}</b>.</p></article>`;
  else if (u && u.status === 'Pending') acct = `<article class="card"><div class="head"><h2>Waiting for approval</h2><span class="chip">Pending</span></div><p>Your email is verified. The administrator is reviewing your account.</p><div class="actions"><button class="btn" data-act="status">${icon('i-refresh')} Check status</button></div></article>`;
  else acct = `<article class="card"><h2>Login or Signup</h2><p>Members write, save and recover notes. Everyone can read the information pages in the menu.</p><div class="actions"><button class="btn" data-act="login">Login</button><button class="btn out" data-act="signup">Signup</button></div></article>`;
  root.innerHTML = `<article class="card hero"><h2>${u ? 'Welcome back, ' + esc(u.name.split(' ')[0]) : 'Welcome to Mission Note'}</h2><p>Private rich-text notes for our community. Keep them on your Device, back them up to Cloud.</p><button class="btn" data-go="editor">${icon('i-edit')} Write a note</button></article>
  <article class="card"><div class="head"><h2>Note Editor</h2></div><p>Bold, colours, headings, lists, links and more.</p><div class="actions"><button class="btn" data-act="new">${icon('i-newfile')} New note</button>${MN.kv.draft ? `<button class="btn out" data-act="draft">Continue draft</button>` : ''}</div></article>
  <article class="card"><div class="head"><h2>Saved Notes</h2><span class="chip">${notes.length}</span></div>${notes.length ? `<div class="nl">${notes.slice(0, 3).map(item).join('')}</div><div class="actions"><button class="btn out" data-go="files">See all in Files</button></div>` : `<p class="mut">Nothing saved yet. Your notes will appear here.</p>`}</article>
  <article class="card"><div class="head"><h2>Recent Files</h2></div>${recent.length ? `<div class="nl">${recent.map(item).join('')}</div>` : `<p class="mut">Notes you open will show up here.</p>`}</article>${acct}`;
}
document.addEventListener('click', e => {
  const g = e.target.closest('#page-home [data-go]'); if (g) return MN.go(g.dataset.go);
  const o = e.target.closest('#page-home [data-open]'); if (o) return openNote(o.dataset.open);
  const a = e.target.closest('#page-home [data-act]'); if (!a) return;
  ({
    new() { if (MN.requireAuth('Sign up to write notes.')) MN.call('editor', 'newNote', true); },
    draft() { if (MN.requireAuth('Sign in to continue your draft.')) { MN.go('editor'); } },
    login() { MN.call('account', 'open', 'login'); }, signup() { MN.call('account', 'open', 'signup'); }, status() { MN.call('account', 'refresh'); }
  })[a.dataset.act]();
});

/* ---------- note actions ---------- */
async function guard(n) { return MN.pin ? MN.pin.guard(n) : true; }
async function openNote(id, hl) {
  if (!MN.requireAuth('Sign in to open your notes.')) return;
  const n = MN.notes.get(id); if (!n) return MN.toast('Note not found', 'err');
  MN.call('editor', 'open', id, { highlight: hl });
}
MN.openNote = openNote;
async function renameNote(n) {
  if (!await guard(n)) return;
  const v = await MN.modal.input({ title: 'Rename note', label: 'File name', value: n.name, validate: x => MN.validateName(x, n.id), ok: 'Rename' }); if (v == null) return;
  n.name = v; n.updated = Date.now(); await MN.notes.put(n); MN.toast('Renamed', 'ok');
  if (n.cloud) MN.toast('Rename will reach Cloud when you push this note.', 'info');
  MN.emit('note:renamed', n);
}
async function deleteNote(n) {
  if (!await guard(n)) return;
  if (!await MN.modal.confirm({ title: 'Delete note?', message: `"${n.name}" will move to Deleted. You can restore it from Files.`, ok: 'Delete', danger: true })) return;
  n.trashed = true; n.trashedAt = Date.now(); if (n.cloud) n.op = 'trash'; await MN.notes.put(n); MN.emit('note:trashed', n.id);
  if (n.cloud && MN.cloud) { try { await MN.cloud.applyOp(n); } catch (e) { MN.toast('Deleted here. Cloud will update at the next sync.', 'info'); return; } }
  MN.toast('Moved to Deleted', 'ok');
}
async function noteMenu(id) {
  const n = MN.notes.get(id); if (!n) return;
  const v = await MN.modal.choose({ title: n.name, items: [
    { label: 'Rename', icon: 'i-edit', value: 'rename' }, { label: 'Open', icon: 'i-open', value: 'open' },
    { label: 'PIN', icon: 'i-lock', value: 'pin', sub: n.pin ? 'PIN is on' : 'Not set' }, { label: 'Delete', icon: 'i-trash', value: 'delete', danger: true },
    { label: 'Copy Out', icon: 'i-copy', value: 'copy' }, { label: 'Push to Cloud', icon: 'i-cloudup', value: 'push', sub: n.cloud ? 'Cloud: ' + MN.cloudState(n) : 'Device only' },
    { label: 'Export', icon: 'i-export', value: 'export' }, { label: 'Share', icon: 'i-share', value: 'share' }, { label: 'Exit', icon: 'i-close', value: 'exit' }] });
  const fresh = MN.notes.get(id) || n;
  switch (v) {
    case 'rename': return renameNote(fresh); case 'open': return openNote(id);
    case 'pin': return MN.feature('pin') ? MN.call('pin', 'toggle', fresh) : MN.toast('PIN is turned off by the administrator.', 'err');
    case 'delete': return deleteNote(fresh);
    case 'copy': return MN.call('share', 'copyOut', fresh);
    case 'push': return MN.feature('cloud') ? MN.call('cloud', 'push', fresh) : MN.toast('Cloud is turned off by the administrator.', 'err');
    case 'export': return MN.feature('export') ? MN.call('share', 'export', fresh) : MN.toast('Export is turned off by the administrator.', 'err');
    case 'share': return MN.feature('share') ? MN.call('share', 'menu', fresh) : MN.toast('Sharing is turned off by the administrator.', 'err');
  }
}
MN.noteMenu = noteMenu;

/* ---------- Files ---------- */
const fs = { view: 'notes', mode: 'list', q: '', scope: 'device', cloud: null };
let filesBuilt = false;
function buildFiles() {
  const root = $('#page-files');
  if (!MN.canWrite()) { filesBuilt = false; root.innerHTML = `<article class="card"><div class="empty">${icon('i-lock')}<h2>Files are for members</h2><p>Sign in with an approved account to see your notes.</p></div><div class="actions" style="justify-content:center"><button class="btn" data-act="login">Login</button><button class="btn out" data-act="signup">Signup</button></div></article>`; return false; }
  if (filesBuilt) return true; filesBuilt = true;
  root.innerHTML = `<div class="toolbar-row"><div class="inp-wrap"><input id="fq" class="inp" type="search" placeholder="Search names and contents" autocomplete="off"><button class="eye" id="fq-go" aria-label="Search">${icon('i-search')}</button></div><button class="ib" id="fl-mode" aria-label="Toggle list or grid" style="color:var(--p)"></button></div>
  <div class="toolbar-row"><div class="seg" id="fl-scope" style="flex:1"><button data-s="device" class="on">Device</button><button data-s="cloud">Cloud search</button></div></div>
  <div class="toolbar-row" style="flex-wrap:wrap"><button class="btn out" id="fl-import">${icon('i-import')} Import</button><button class="btn out" id="fl-trash">${icon('i-trash')} Deleted</button><button class="btn out" id="fl-sync">${icon('i-refresh')} Check Cloud</button></div><div id="fl-body"></div>`;
  $('#fq').addEventListener('input', debounce(e => { fs.q = e.target.value; if (fs.scope === 'device') { fs.cloud = null; renderFileList(); } }, 200));
  $('#fq').addEventListener('keydown', e => { if (e.key === 'Enter') searchGo(); });
  $('#fq-go').onclick = searchGo;
  $('#fl-mode').onclick = () => { fs.mode = fs.mode === 'list' ? 'grid' : 'list'; renderFileList(); };
  $$('#fl-scope button').forEach(b => b.onclick = () => { fs.scope = b.dataset.s; fs.cloud = null; $$('#fl-scope button').forEach(x => x.classList.toggle('on', x === b)); $('#fq').placeholder = fs.scope === 'cloud' ? 'Search Cloud, then tap the magnifier' : 'Search names and contents'; renderFileList(); });
  $('#fl-import').onclick = () => MN.feature('import') ? MN.call('share', 'importFile') : MN.toast('Import is turned off by the administrator.', 'err');
  $('#fl-trash').onclick = () => { fs.view = fs.view === 'trash' ? 'notes' : 'trash'; renderFileList(); };
  $('#fl-sync').onclick = () => MN.feature('cloud') ? MN.call('cloud', 'sync', { reason: 'manual' }) : MN.toast('Cloud is turned off by the administrator.', 'err');
  return true;
}
async function searchGo() {
  if (fs.scope !== 'cloud') { fs.q = $('#fq').value; return renderFileList(); }
  if (!MN.feature('cloudSearch') || !MN.feature('cloud')) return MN.toast('Cloud search is turned off by the administrator.', 'err');
  const q = $('#fq').value.trim(); if (q.length < 2) return MN.toast('Type at least 2 characters.', 'err');
  fs.q = q; const r = await MN.call('cloud', 'search', q); if (r) { fs.cloud = r; renderFileList(); }
}
function noteHTML(n, q, extra) {
  const cs = MN.cloudState(n), badges = [`<span class="chip">${icon('i-device')} Device</span>`];
  if (cs) badges.push(`<span class="chip ${cs === 'Synced' ? 'ok' : cs === 'Failed' ? 'bad' : ''}">${icon('i-cloud')} ${cs === 'Pending' ? 'Not pushed' : cs}</span>`);
  if (n.pin) badges.push(`<span class="chip">${icon('i-lock')} Locked</span>`);
  return `<div class="ni" data-id="${n.id}">${icon('i-note')}<div class="meta"><div class="nm">${MN.hlText(n.name, q)}</div><div class="sub">${fmt(n.updated)}</div>${extra || ''}<div class="badges">${badges.join('')}</div></div><button class="ib" data-menu="${n.id}" aria-label="Note options" style="color:var(--p)">${icon('i-dots')}</button></div>`;
}
function renderFileList() {
  if (!buildFiles()) return;
  const body = $('#fl-body'), q = fs.q.trim(), grid = fs.mode === 'grid';
  $('#fl-mode').innerHTML = icon(grid ? 'i-list' : 'i-grid'); $('#fl-trash').lastChild.textContent = fs.view === 'trash' ? ' Back to notes' : ' Deleted';
  const all = MN.cache.notes;
  if (fs.view === 'trash') {
    const t = all.filter(n => n.trashed).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
    body.innerHTML = `<div class="sec-h">Deleted notes</div>` + (t.length ? `<div class="nl ${grid ? 'grid' : ''}">${t.map(n => `<div class="ni" data-trash="${n.id}">${icon('i-trash')}<div class="meta"><div class="nm">${esc(n.name)}</div><div class="sub">Deleted ${fmt(n.trashedAt)}</div><div class="badges"><span class="chip">Tap to restore or remove</span></div></div></div>`).join('')}</div>` : `<div class="empty">${icon('i-trash')}<p>Nothing deleted.</p></div>`);
    return;
  }
  if (fs.scope === 'cloud') {
    if (!fs.cloud) { body.innerHTML = `<div class="empty">${icon('i-cloud')}<p>Cloud search only runs when you ask. Type a word and tap the magnifier.</p></div>`; return; }
    body.innerHTML = `<div class="sec-h">Cloud results (${fs.cloud.length})</div>` + (fs.cloud.length ? `<div class="nl ${grid ? 'grid' : ''}">${fs.cloud.map(r => `<div class="ni" data-cloud="${r.id}">${icon('i-cloud')}<div class="meta"><div class="nm">${MN.hlText(r.name, q)}</div><div class="sub">${fmt(r.updated)}</div>${r.snippet ? `<div class="snip">${MN.snippet(r.snippet, q)}</div>` : ''}<div class="badges"><span class="chip">${icon('i-cloud')} Cloud</span>${MN.notes.get(r.id) ? `<span class="chip ok">On this Device</span>` : ''}</div></div></div>`).join('')}</div>` : `<div class="empty">${icon('i-search')}<p>No Cloud notes match "${esc(q)}".</p></div>`);
    return;
  }
  let list = all.filter(n => !n.trashed).sort((a, b) => b.updated - a.updated), html = '';
  if (q) {
    const lq = q.toLowerCase(); list = list.map(n => { const nh = n.name.toLowerCase().includes(lq), ch = !n.pin && (n.text || '').toLowerCase().includes(lq); return (nh || ch) ? { n, snip: ch ? `<div class="snip">${MN.snippet(n.text, q)}</div>` : '' } : null; }).filter(Boolean);
    html = `<div class="sec-h">Results (${list.length})</div>` + (list.length ? `<div class="nl ${grid ? 'grid' : ''}">${list.map(x => noteHTML(x.n, q, x.snip)).join('')}</div>` : `<div class="empty">${icon('i-search')}<p>No notes match "${esc(q)}".</p></div>`);
  } else {
    const rec = list.filter(n => n.opened).sort((a, b) => b.opened - a.opened).slice(0, 5);
    if (rec.length) html += `<div class="sec-h">Recent files</div><div class="recent">${rec.map(n => `<div class="ni" data-id="${n.id}">${icon('i-note')}<div class="meta"><div class="nm">${esc(n.name)}</div><div class="sub">${fmt(n.opened)}</div></div></div>`).join('')}</div>`;
    html += `<div class="sec-h">Saved notes (${list.length})</div>` + (list.length ? `<div class="nl ${grid ? 'grid' : ''}">${list.map(n => noteHTML(n)).join('')}</div>` : `<div class="empty">${icon('i-folder')}<h2>No notes yet</h2><p>Write in Editor, then tap Save.</p><div class="actions" style="justify-content:center"><button class="btn" data-go="editor">Open Editor</button></div></div>`);
  }
  body.innerHTML = html;
}
document.addEventListener('click', async e => {
  const root = e.target.closest('#page-files'); if (!root) return;
  const a = e.target.closest('[data-act]'); if (a) return ({ login() { MN.call('account', 'open', 'login'); }, signup() { MN.call('account', 'open', 'signup'); } })[a.dataset.act]();
  const g = e.target.closest('[data-go]'); if (g) return MN.go(g.dataset.go);
  const m = e.target.closest('[data-menu]'); if (m) return noteMenu(m.dataset.menu);
  const t = e.target.closest('[data-trash]'); if (t) {
    const n = MN.notes.get(t.dataset.trash), v = await MN.modal.choose({ title: n.name, items: [{ label: 'Restore', icon: 'i-restore', value: 'r' }, { label: 'Delete forever', icon: 'i-trash', value: 'd', danger: true }], cancel: 'Cancel' });
    if (v === 'r') { n.trashed = false; delete n.trashedAt; if (n.cloud) n.op = 'restore'; await MN.notes.put(n); if (n.cloud && MN.cloud) { try { await MN.cloud.applyOp(n); } catch (x) {} } MN.toast('Note restored', 'ok'); }
    if (v === 'd') {
      if (!await guard(n)) return;
      if (!await MN.modal.confirm({ title: 'Delete forever?', message: n.cloud ? 'This removes the note from this phone and marks the Cloud copy as deleted. This cannot be undone here.' : 'This removes the note from this phone. This cannot be undone.', ok: 'Delete forever', danger: true })) return;
      if (n.cloud && MN.cloud) { try { n.op = 'purge'; await MN.cloud.applyOp(n); } catch (x) { return MN.toast('Connect to the internet to remove the Cloud copy first.', 'err'); } }
      await MN.notes.del(n.id); MN.toast('Deleted forever', 'ok');
    }
    return;
  }
  const c = e.target.closest('[data-cloud]'); if (c) return MN.call('cloud', 'openFromCloud', c.dataset.cloud, fs.q);
  const n = e.target.closest('[data-id]'); if (n) openNote(n.dataset.id, fs.q.trim() || undefined);
});

/* ---------- wiring ---------- */
function wire() {
  $('#btn-left').onclick = () => { renderLeft(); drawer('left', true); };
  $('#btn-right').onclick = () => { renderRight(); drawer('right', true); };
  $('#btn-save').onclick = () => MN.call('editor', 'requestSave');
  $('#bnav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) MN.go(b.dataset.go); });
  $('#drawer-left').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (!r) return; MN.closeDrawers(); MN.info(+r.dataset.i); });
  $('#drawer-right').addEventListener('click', e => { const r = e.target.closest('[data-t]'); if (r) TOOLS[r.dataset.t](); });
  MN.on('notes', () => { renderHome(); if (cur === 'files') renderFileList(); else filesBuilt && renderFileList(); });
  MN.on('auth', () => { filesBuilt = false; renderHome(); if (cur === 'files') renderFileList(); });
  MN.on('page:home', renderHome); MN.on('page:files', () => { fs.cloud = null; renderFileList(); });
  window.addEventListener('offline', () => MN.toast('You are offline. Device notes still work.', 'info'));
  window.addEventListener('online', () => MN.toast('Back online', 'ok'));
}

/* ---------- service worker + updates ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const prompt = w => MN.notify({ icon: 'i-refresh', title: 'Update available', msg: 'A newer version of Mission Note is ready.', action: 'Update', sticky: true, onAction: () => w.postMessage({ type: 'SKIP_WAITING' }) });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); }); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    if (reg.periodicSync && navigator.permissions) { navigator.permissions.query({ name: 'periodic-background-sync' }).then(p => { if (p.state === 'granted') reg.periodicSync.register('mn-schedule', { minInterval: 6 * 3600 * 1000 }).catch(() => {}); }).catch(() => {}); }
  }).catch(() => {});
  let reloading = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'RUN_SCHEDULE') MN.emit('schedule:run'); });
}

/* ---------- boot ---------- */
async function boot() {
  if (MN.blocked) return;
  try {
    await openDB();
    (await tx('kv', 'readonly', s => s.getAll())).forEach(r => { MN.kv[r.k] = r.v; });
    await MN.notes.reload();
  } catch (e) { document.body.innerHTML = '<p style="padding:2rem">Device storage is unavailable in this browser mode. Open Mission Note in normal (non-private) Chrome.</p>'; return; }
  MN.session = MN.kv.session || null;
  if (MN.session && MN.session.exp <= Date.now()) { MN.session.expired = true; }
  wire(); renderHome(); renderLeft(); renderRight();
  if (MN.kv.cfg) MN.applyConfig(MN.kv.cfg);
  MN.emit('boot'); MN.go('home');
  registerSW();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
  MN.ready = true; MN.emit('ready');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
