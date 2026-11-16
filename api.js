/* MISSION NOTE - api.js (self-contained module)
   Backend client, silent analytics, Cloud push/sync/search, and the 4-per-24h scheduler with catch-up.
   Only talks to the core through window.MN. Set API_URL to your deployed Apps Script Web App URL. */
(function () {
'use strict';
if (!window.MN) return;
const API_URL = 'PASTE_YOUR_WEB_APP_URL_HERE'; // <-- ADMIN: paste the Apps Script Web App URL (ends with /exec)
const SLOT = 6 * 3600 * 1000; // 4 runs per 24h
const AUTH_CODES = ['NO_SESSION', 'SESSION_EXPIRED', 'ACCOUNT_BANNED', 'ACCOUNT_REJECTED', 'ACCOUNT_DISABLED', 'SESSIONS_OFF'];

class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const deviceId = () => { if (!MN.kv.device) { MN.kv.device = { id: MN.uuid() }; MN.setKV('device', MN.kv.device); } return MN.kv.device.id; };

async function call(action, payload, opt) {
  opt = opt || {}; payload = payload || {};
  if (API_URL.indexOf('PASTE') === 0) throw new ApiError('NOT_CONFIGURED', 'This app is not connected to its backend yet. The administrator must set API_URL in api.js.');
  if (!navigator.onLine) throw new ApiError('OFFLINE', 'You are offline. Connect to the internet and try again.');
  if (!opt.silent) MN.loader.show(opt.text);
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), opt.timeout || 45000); let res;
    try {
      res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action, device: deviceId(), token: (MN.session && MN.session.token) || undefined }, payload)), signal: ctl.signal, redirect: 'follow' });
    } catch (e) { throw new ApiError('NETWORK', e.name === 'AbortError' ? 'The server took too long to respond. Try again.' : 'Could not reach the server. Check your connection.'); }
    finally { clearTimeout(to); }
    let j; try { j = await res.json(); } catch (e) { throw new ApiError('BAD_RESPONSE', 'The server sent an unexpected response. Try again.'); }
    if (j.cfg) MN.applyConfig(j.cfg);
    if (!j.ok) { if (AUTH_CODES.includes(j.code)) MN.emit('auth:invalid', j); throw new ApiError(j.code, j.message); }
    return j.data;
  } finally { if (!opt.silent) MN.loader.hide(); }
}
function fail(e, title) {
  if (e.code === 'OFFLINE' || e.code === 'NETWORK') return MN.toast(e.message, 'err');
  if (e.code === 'MAINTENANCE') return;
  MN.modal.alert({ title: title || 'Something went wrong', message: e.message || String(e) });
}
async function refreshConfig() { try { await call('config', {}, { text: 'Checking status...' }); MN.toast('Status updated', 'ok'); } catch (e) { fail(e, 'Could not check status'); } }

/* ---------- schedule bookkeeping ---------- */
const sched = () => MN.kv.sched || {};
const setSched = p => MN.setKV('sched', Object.assign({}, sched(), p));
const due = k => Date.now() - (sched()[k] || 0) >= SLOT - 60000;

/* ---------- analytics (always silent: never shows UI) ---------- */
async function collect() {
  let g = {};
  try { const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); g = { city: j.city, region: j.region, country: j.country_name, isp: j.org, timezone: j.timezone }; } } catch (e) {}
  g.timezone = g.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  return Object.assign(g, { language: navigator.language, platform: (navigator.userAgentData && navigator.userAgentData.platform) || 'Android', screen: screen.width + 'x' + screen.height, ua: navigator.userAgent });
}
async function sendAnalytics(event) {
  try { const a = await collect(); await call('analytics', { event, a }, { silent: true, timeout: 20000 }); await setSched({ analytics: Date.now() }); } catch (e) { /* silent; catch-up retries later */ }
}

/* ---------- Cloud ---------- */
const uniqueName = (name, id) => { let n = name, i = 2; while (MN.notes.all().some(x => !x.trashed && x.id !== id && x.name.toLowerCase() === n.toLowerCase())) n = name + ' (' + (i++) + ')'; return n; };
function fromCloud(c, status) {
  const html = MN.sanitize(c.html);
  return { id: c.id, name: uniqueName(c.name, c.id), html, text: MN.plain(html), created: c.created || c.updated, updated: c.updated, opened: 0, trashed: status === 'Trashed', trashedAt: status === 'Trashed' ? Date.now() : undefined, pin: null, cloud: { status: 'Synced', cloudUpdated: c.updated, syncedAt: Date.now() } };
}
async function download(ids, text) {
  const out = [], missing = [];
  for (let i = 0; i < ids.length; i += 10) { const r = await call('get', { ids: ids.slice(i, i + 10) }, { text: text || 'Restoring notes...' }); out.push(...r.notes); missing.push(...r.missing); }
  return { notes: out, missing };
}
async function push(n, opt) {
  opt = opt || {};
  if (!MN.requireAuth('Sign in to use Cloud.')) return false;
  if (!MN.feature('cloud')) { MN.toast('Cloud is turned off by the administrator.', 'err'); return false; }
  if (n.pin && MN.pin && !opt.pinOk) {
    if (!await MN.pin.guard(n)) return false;
    if (!await MN.modal.confirm({ title: 'PIN stays on this Device', message: 'The PIN locks this note on this phone only. The Cloud copy is not locked by the PIN. Push anyway?', ok: 'Push to Cloud' })) return false;
  }
  try {
    const r = await call('push', { note: { id: n.id, name: n.name, html: n.html, created: n.created, updated: n.updated }, baseUpdated: n.cloud ? n.cloud.cloudUpdated || 0 : 0, force: !!opt.force }, { text: 'Pushing to Cloud...' });
    if (r.conflict) return conflict(n, r);
    n.cloud = { status: 'Synced', cloudUpdated: r.updated, syncedAt: Date.now() }; delete n.op; await MN.notes.put(n);
    MN.toast('Pushed to Cloud', 'ok'); return true;
  } catch (e) {
    if (n.cloud && !['OFFLINE', 'NETWORK', 'NOT_CONFIGURED'].includes(e.code)) { n.cloud.status = 'Failed'; await MN.notes.put(n); }
    fail(e, 'Push to Cloud failed'); return false;
  }
}
async function conflict(n, r) {
  const v = await MN.modal.choose({ title: 'Cloud has a newer version', message: `"${r.cloudName}" was updated in Cloud on ${MN.fmt(r.cloudUpdated)}. Pushing now would replace it.`, items: [{ label: 'Overwrite Cloud with this version', icon: 'i-cloudup', value: 'over', danger: true }, { label: 'Keep both', sub: 'Save the Cloud version as a separate copy on this Device', icon: 'i-copy', value: 'copy' }], cancel: 'Cancel' });
  if (v === 'over') return push(n, { force: true, pinOk: true });
  if (v === 'copy') {
    try {
      const d = await download([n.id], 'Getting Cloud version...'), c = d.notes[0]; if (!c) return false;
      const cp = fromCloud(Object.assign({}, c, { id: MN.uuid(), name: c.name + ' (Cloud copy)' }), 'Active'); cp.cloud = null; await MN.notes.put(cp);
      n.cloud = Object.assign(n.cloud || {}, { cloudUpdated: c.updated, status: 'Pending' }); n.updated = Math.max(n.updated, c.updated + 1); await MN.notes.put(n);
      MN.toast('Cloud version saved as a copy. Push again to update Cloud.', 'ok');
    } catch (e) { fail(e); }
  }
  return false;
}
async function applyOp(n) {
  if (!n.op || !n.cloud) { delete n.op; return; }
  await call('setStatus', { id: n.id, op: n.op }, { text: 'Updating Cloud...' });
  if (n.op !== 'purge') { delete n.op; await MN.notes.put(n); }
}
async function search(q) { try { return (await call('searchCloud', { q }, { text: 'Searching Cloud...' })).results; } catch (e) { fail(e, 'Cloud search failed'); return null; } }
async function openFromCloud(id, q) {
  if (MN.notes.get(id)) return MN.openNote(id, q);
  try {
    const d = await download([id], 'Restoring note...'); if (!d.notes[0]) return MN.toast('That Cloud note is no longer available.', 'err');
    await MN.notes.put(fromCloud(d.notes[0], d.notes[0].status)); MN.toast('Restored to Device', 'ok'); MN.openNote(id, q);
  } catch (e) { fail(e, 'Could not restore note'); }
}

let syncing = false;
async function sync(o) {
  o = o || {};
  if (syncing) return;
  if (!MN.canWrite()) { if (!o.scheduled) MN.requireAuth('Sign in to check Cloud.'); return; }
  if (!MN.feature('cloud')) { if (!o.scheduled) MN.toast('Cloud is turned off by the administrator.', 'err'); return; }
  syncing = true; MN.loader.show('Synchronizing...');
  const sum = { restored: 0, updated: 0, conflicts: 0, pending: 0, missing: 0, failed: 0 };
  try {
    if (o.scheduled) await setSched({ syncTry: Date.now() });
    // 1) pending Cloud operations the user already requested (trash / restore / purge)
    for (const n of MN.notes.all().filter(x => x.op && x.cloud)) {
      try { await call('setStatus', { id: n.id, op: n.op }, { silent: true }); if (n.op === 'purge') await MN.notes.del(n.id); else { delete n.op; await MN.notes.put(n); } }
      catch (e) { if (AUTH_CODES.includes(e.code) || e.code === 'MAINTENANCE') throw e; sum.failed++; }
    }
    // 2) Cloud index
    const idx = await call('index', {}, { silent: true });
    if (idx.user && MN.session) { MN.session.user = idx.user; await MN.setSession(MN.session); }
    (idx.inbox || []).forEach(m => MN.notify({ icon: 'i-mail', title: 'Message from the administrator', msg: m.m, sticky: true }));
    const byId = new Map(MN.notes.all().map(n => [n.id, n])), inIdx = new Set(), want = [];
    for (const c of idx.notes) {
      inIdx.add(c.id); const l = byId.get(c.id);
      if (!l) { want.push({ c, mode: 'new' }); continue; }
      if (l.op) continue;
      if (!l.cloud) l.cloud = { status: 'Synced', cloudUpdated: 0 };
      const lc = l.cloud.cloudUpdated || 0;
      if (c.status === 'Trashed' && !l.trashed) { l.trashed = true; l.trashedAt = Date.now(); sum.updated++; }
      if (c.updated === l.updated) { l.cloud.cloudUpdated = c.updated; l.cloud.status = 'Synced'; delete l.cloud.missing; }
      else if (c.updated > lc) want.push({ c, l, mode: l.updated > lc ? 'conflict' : 'pull' });
      else if (l.updated > lc) { l.cloud.status = 'Pending'; sum.pending++; }
      else l.cloud.status = 'Synced';
      await MN.notes.put(l);
    }
    for (const l of MN.notes.all()) if (l.cloud && !l.op && !l.trashed && !inIdx.has(l.id)) { l.cloud.status = 'Pending'; l.cloud.cloudUpdated = 0; l.cloud.missing = true; sum.missing++; await MN.notes.put(l); }
    // 3) download only what is missing or newer in Cloud (never uploads local edits)
    if (want.length) {
      const d = await download(want.map(w => w.c.id), 'Restoring notes...'), got = new Map(d.notes.map(x => [x.id, x]));
      sum.failed += d.missing.length;
      for (const w of want) {
        const c = got.get(w.c.id); if (!c) continue;
        if (w.mode === 'new') { await MN.notes.put(fromCloud(c, w.c.status)); sum.restored++; }
        else if (w.mode === 'pull') { const l = w.l, html = MN.sanitize(c.html); l.html = html; l.text = MN.plain(html); l.name = uniqueName(c.name, l.id); l.updated = c.updated; l.cloud = { status: 'Synced', cloudUpdated: c.updated, syncedAt: Date.now() }; await MN.notes.put(l); sum.updated++; }
        else {
          const cp = fromCloud(Object.assign({}, c, { id: MN.uuid(), name: c.name + ' (Cloud copy)' }), 'Active'); cp.cloud = null; await MN.notes.put(cp);
          const l = w.l; l.cloud.cloudUpdated = c.updated; l.cloud.status = 'Pending'; l.updated = Math.max(l.updated, c.updated + 1); await MN.notes.put(l); sum.conflicts++;
        }
      }
    }
    await setSched({ sync: Date.now(), syncOk: Date.now(), lastSync: sum, syncError: '' });
    const changed = sum.restored + sum.updated + sum.conflicts;
    if (!o.scheduled || changed || sum.failed) {
      const bits = []; if (sum.restored) bits.push(sum.restored + ' restored'); if (sum.updated) bits.push(sum.updated + ' updated'); if (sum.conflicts) bits.push(sum.conflicts + ' kept as copies'); if (sum.pending) bits.push(sum.pending + ' not pushed'); if (sum.missing) bits.push(sum.missing + ' missing in Cloud'); if (sum.failed) bits.push(sum.failed + ' failed');
      MN.toast('Cloud check done' + (bits.length ? ': ' + bits.join(', ') : '. Everything is up to date.'), sum.failed ? 'err' : 'ok');
    }
    MN.emit('sync:done', sum);
  } catch (e) {
    await setSched({ syncError: e.message || 'failed' });
    if (!AUTH_CODES.includes(e.code) && e.code !== 'MAINTENANCE') { if (o.scheduled) MN.toast('Cloud check failed: ' + e.message, 'err'); else fail(e, 'Cloud check failed'); }
  } finally { syncing = false; MN.loader.hide(); }
}

/* ---------- scheduler: 4 checks per 24h + catch-up when the app becomes active ---------- */
let timer, running = false;
async function runDue(reason) {
  if (!MN.ready || running) return; running = true;
  try {
    if (due('analytics') && Date.now() - (sched().analyticsTry || 0) > 600000) { await setSched({ analyticsTry: Date.now() }); await sendAnalytics(reason === 'timer' ? 'scheduled' : 'catchup'); }
    if (MN.canWrite() && MN.feature('cloud') && !(MN.cfg && MN.cfg.maintenance) && navigator.onLine && due('sync') && Date.now() - (sched().syncTry || 0) > 600000) await sync({ scheduled: true, reason });
  } finally { running = false; arm(); }
}
function arm() {
  clearTimeout(timer); const s = sched(), next = [(s.analytics || 0) + SLOT];
  if (MN.canWrite()) next.push((s.sync || 0) + SLOT);
  const delay = Math.min(2147000000, Math.max(5 * 60000, Math.min.apply(null, next) - Date.now()));
  timer = setTimeout(() => runDue('timer'), delay);
}

MN.x('api', { call, fail, refreshConfig, runDue, url: () => API_URL, ApiError });
MN.x('cloud', { push, sync, applyOp, search, openFromCloud, download, fromCloud });
MN.on('boot', () => { deviceId(); MN.setKV('apiUrl', API_URL); });
MN.on('ready', () => {
  runDue('boot');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) runDue('active'); });
  window.addEventListener('online', () => runDue('online'));
});
MN.on('schedule:run', () => runDue('sw'));
MN.on('auth', arm);
})();
