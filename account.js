/* MISSION NOTE - account.js (self-contained module)
   Signup (form -> 6-digit code -> pending feedback), Login, Logout, 10-day session, Account page, write-gating prompts. */
(function () {
'use strict';
if (!window.MN) return;
const { $, esc, icon, sleep } = MN;
const api = (a, p, o) => MN.api.call(a, p, o);
const spinner = t => `<div class="center-screen"><svg class="spinner" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke-width="5"/></svg><p style="font-weight:600">${esc(t)}</p></div>`;
const eye = `<button type="button" class="eye" data-eye aria-label="Show or hide password">${icon('i-eye')}</button>`;
const FEEDBACK = 'Your details have been submitted for review. Account activation take up to five hours. If this is not completed within 24 hours, please reach out through any of the contact channels below.';
const BLOCK = { ACCOUNT_BANNED: 'Your account has been banned by the administrator.', ACCOUNT_REJECTED: 'Your registration was not approved.', ACCOUNT_DISABLED: 'Your account is temporarily disabled by the administrator.', NO_SESSION: 'Your session has ended. Please log in again.', SESSION_EXPIRED: 'Your 10-day session has expired. Please log in again.' };

document.addEventListener('click', e => {
  const b = e.target.closest('[data-eye]'); if (!b) return;
  const i = b.parentNode.querySelector('input'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.innerHTML = icon(show ? 'i-eyeoff' : 'i-eye');
});

async function startSession(r) {
  if (!r.session) return;
  await MN.setSession({ token: r.session.token, exp: r.session.expiresAt, since: Date.now(), user: r.user });
}
function err(el, m) { el.textContent = m; el.hidden = false; MN.haptic([20, 40, 20]); }

/* ---------- signup wizard ---------- */
function signup() {
  if (MN.cfg && MN.cfg.signup === false) return MN.modal.alert({ title: 'Signup is closed', message: 'The administrator has temporarily closed signup. Please try again later.' });
  const W = MN.modal.open({ title: 'Create account', full: true, focus: false }); formScreen(W);
}
function formScreen(W) {
  W.set({
    title: 'Create your account',
    body: `<article class="card"><label class="field"><span>Full name</span><input id="su-n" class="inp" maxlength="80" autocomplete="name"></label>
    <label class="field"><span>Gender</span><select id="su-g" class="inp"><option value="">Select gender</option><option>Male</option><option>Female</option></select></label>
    <label class="field"><span>Email address</span><input id="su-e" class="inp" type="email" inputmode="email" maxlength="120" autocomplete="email"></label>
    <label class="field"><span>Password (6 to 64 characters)</span><div class="inp-wrap"><input id="su-p" class="inp" type="password" maxlength="64" autocomplete="new-password">${eye}</div></label>
    <p class="err" id="su-err" hidden></p></article>`,
    buttons: [{
      label: 'Submit', kind: 'primary', async onClick() {
        const n = $('#su-n', W.el).value.trim(), g = $('#su-g', W.el).value, em = $('#su-e', W.el).value.trim().toLowerCase(), p = $('#su-p', W.el).value, er = $('#su-err', W.el);
        if (n.length < 2) return err(er, 'Enter your full name.'), false;
        if (!g) return err(er, 'Select Male or Female.'), false;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return err(er, 'Enter a valid email address.'), false;
        if (p.length < 6) return err(er, 'Password must be at least 6 characters.'), false;
        try { const r = await api('signup', { fullName: n, gender: g, email: em, password: p }, { text: 'Creating your account...' }); verifyScreen(W, r.email, r.expiresIn); }
        catch (e) { if (e.code === 'OFFLINE' || e.code === 'NETWORK') MN.toast(e.message, 'err'); err(er, e.message); }
        return false;
      }
    }]
  });
}
function verifyScreen(W, email, secs) {
  let end = Date.now() + (secs || 600) * 1000, born = Date.now();
  W.set({
    title: 'Verify your email',
    body: `<article class="card"><p>Verification code has been sent to your submitted email address</p><p class="mut" style="margin-top:.3rem">${esc(email)}</p>
    <p style="margin:.8rem 0 .2rem;font-weight:700">Code expires in <span id="vc-t" style="color:var(--p)">10:00</span></p>
    <label class="field"><span>Paste your six-digit code</span><input id="vc-c" class="inp code-in" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></label><p class="err" id="vc-err" hidden></p></article>`,
    buttons: [{
      label: 'Verify', kind: 'primary', async onClick() {
        const c = $('#vc-c', W.el).value.replace(/\D/g, ''), er = $('#vc-err', W.el);
        if (c.length !== 6) return err(er, 'Enter all six digits.'), false;
        try { const r = await api('verify', { email, code: c }, { text: 'Verifying...' }); clearInterval(W.timer); await finish(W, r); }
        catch (e) { err(er, e.message); }
        return false;
      }
    }, {
      label: 'Resend code', kind: 'out', id: 'vc-rs', async onClick() {
        try { const r = await api('resend', { email }, { text: 'Sending a new code...' }); end = Date.now() + r.expiresIn * 1000; born = Date.now(); $('#vc-err', W.el).hidden = true; MN.toast('A new code was sent', 'ok'); }
        catch (e) { err($('#vc-err', W.el), e.message); }
        return false;
      }
    }]
  });
  const code = $('#vc-c', W.el); code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
  clearInterval(W.timer);
  const tick = () => {
    if (W.closed) return clearInterval(W.timer);
    const left = Math.max(0, Math.round((end - Date.now()) / 1000)), t = $('#vc-t', W.el); if (!t) return;
    t.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    if (!left) t.textContent = '00:00 (expired)';
    const rs = $('#vc-rs', W.el); if (rs) rs.disabled = (Date.now() - born < 30000) && left > 0;
  };
  tick(); W.timer = setInterval(tick, 1000); W.result.then(() => clearInterval(W.timer));
  setTimeout(() => code.focus(), 80);
}
async function finish(W, r) {
  await startSession(r);
  W.set({ title: 'Verifying', body: spinner('Verifying your email...'), buttons: [] }); await sleep(1200);
  W.set({ body: `<div class="center-screen">${icon('i-check', 'big')}<h2>You have verified your email</h2></div>` }); MN.haptic([15, 30, 15]); await sleep(1600);
  W.set({ body: spinner('Checking approval status...') }); await sleep(1600);
  feedbackScreen(W);
}
function feedbackScreen(W) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<article class="card"><div class="empty">${icon('i-info')}<h2>Pending approval</h2><p>${esc(FEEDBACK)}</p></div><div data-contact></div></article>`;
  $('[data-contact]', wrap).appendChild(document.getElementById('tpl-contact-icons').content.cloneNode(true));
  W.set({ title: 'Almost there', body: wrap, buttons: [{ label: 'Close', kind: 'primary' }] });
}

/* ---------- login ---------- */
function login() {
  if (MN.cfg && MN.cfg.login === false) return MN.modal.alert({ title: 'Login is paused', message: 'The administrator has temporarily disabled login. Please try again later.' });
  const hd = MN.modal.open({
    title: 'Log in',
    body: `<label class="field"><span>Email address</span><input id="lg-e" class="inp" type="email" inputmode="email" maxlength="120" autocomplete="email" value="${esc((MN.kv.lastEmail) || '')}"></label>
    <label class="field"><span>Password</span><div class="inp-wrap"><input id="lg-p" class="inp" type="password" maxlength="64" autocomplete="current-password">${eye}</div></label><p class="err" id="lg-err" hidden></p>
    <button class="btn text" id="lg-su" type="button">New here? Create an account</button>`,
    buttons: [{ label: 'Cancel', kind: 'danger', value: null }, {
      label: 'Log in', kind: 'primary', async onClick(h) {
        const em = $('#lg-e', h.el).value.trim().toLowerCase(), p = $('#lg-p', h.el).value, er = $('#lg-err', h.el);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return err(er, 'Enter a valid email address.'), false;
        if (!p) return err(er, 'Enter your password.'), false;
        try {
          const r = await api('login', { email: em, password: p }, { text: 'Signing you in...' });
          MN.setKV('lastEmail', em);
          if (r.needVerify) { h.close(null); const W = MN.modal.open({ title: 'Verify your email', full: true, focus: false }); verifyScreen(W, r.email, r.expiresIn); return false; }
          await startSession(r); h.close(null);
          if (r.user.status === 'Approved') { MN.toast('Welcome back, ' + r.user.name.split(' ')[0], 'ok'); if (MN.feature('cloud')) MN.call('cloud', 'sync', { reason: 'login' }); }
          else { const W = MN.modal.open({ title: 'Almost there', full: true, focus: false }); feedbackScreen(W); }
        } catch (e) { if (e.code === 'OFFLINE' || e.code === 'NETWORK') MN.toast(e.message, 'err'); err(er, e.message); }
        return false;
      }
    }]
  });
  $('#lg-su', hd.el).onclick = () => { hd.close(null); signup(); };
}

/* ---------- gating / status / logout ---------- */
function gate(msg) {
  const s = MN.session, u = s && s.user;
  if (u && s.exp > Date.now() && u.status === 'Pending') return MN.modal.open({ title: 'Waiting for approval', body: `<p>${esc(FEEDBACK)}</p>`, buttons: [{ label: 'Check status', kind: 'primary', onClick() { refresh(); } }, { label: 'Close', kind: 'out' }], stack: true });
  const expired = s && s.exp <= Date.now();
  MN.modal.choose({ title: expired ? 'Session expired' : 'Members only', message: expired ? 'Your 10-day session ended. Log in again to continue.' : (msg || 'Sign up or log in to continue.'), items: [{ label: 'Log in', icon: 'i-user', value: 'l' }, ...(expired ? [] : [{ label: 'Sign up', icon: 'i-plus', value: 's' }])], cancel: 'Not now' }).then(v => { if (v === 'l') login(); if (v === 's') signup(); });
}
async function refresh() {
  if (!MN.session) return gate();
  try {
    const r = await api('me', {}, { text: 'Checking your account...' });
    const s = Object.assign({}, MN.session, { user: r.user }); await MN.setSession(s);
    (r.inbox || []).forEach(m => MN.notify({ icon: 'i-mail', title: 'Message from the administrator', msg: m.m, sticky: true }));
    MN.toast(r.user.status === 'Approved' ? 'Your account is approved' : 'Status: ' + r.user.status, r.user.status === 'Approved' ? 'ok' : 'info');
    if (r.user.status === 'Approved' && MN.feature('cloud') && MN.cloud && !(MN.kv.sched && MN.kv.sched.syncOk)) MN.call('cloud', 'sync', { reason: 'approved' });
  } catch (e) { MN.api.fail(e, 'Could not check status'); }
}
async function logout() {
  if (!MN.session) return;
  if (!await MN.modal.confirm({ title: 'Log out?', message: 'Your session ends immediately. Notes stay on this Device but are hidden until you log in again.', ok: 'Log out', danger: true })) return;
  MN.loader.show('Logging out...');
  try { if (navigator.onLine) await api('logout', {}, { silent: true, timeout: 8000 }); } catch (e) {}
  MN.loader.hide(); await MN.setSession(null); MN.go('home'); MN.toast('Logged out', 'ok');
}
MN.on('auth:invalid', async j => {
  if (j.code === 'SESSIONS_OFF') return MN.modal.alert({ title: 'Sessions paused', message: j.message });
  if (MN.session) { await MN.setSession(null); MN.modal.alert({ title: 'Signed out', message: BLOCK[j.code] || j.message }); }
});

/* ---------- Account page ---------- */
function render() {
  const root = $('#page-account'), s = MN.session, u = s && s.user;
  if (!u) { root.innerHTML = `<article class="card hero"><h2>Your Mission Note account</h2><p>Sign up to write, save and recover notes. Login keeps you signed in for 10 days.</p></article><article class="card"><div class="actions"><button class="btn" data-a="login">Log in</button><button class="btn out" data-a="signup">Sign up</button></div></article>`; return; }
  const exp = s.exp > Date.now(), days = Math.max(0, Math.ceil((s.exp - Date.now()) / 86400000)), notes = MN.cache.notes, sc = MN.kv.sched || {};
  const chip = u.status === 'Approved' ? 'ok' : (u.status === 'Pending' ? '' : 'bad');
  root.innerHTML = `<article class="card"><div class="head"><h2>${esc(u.name)}</h2><span class="chip ${chip}">${esc(u.status)}</span></div><dl class="kv"><dt>Gender</dt><dd>${esc(u.gender)}</dd><dt>Email</dt><dd>${esc(u.email)}</dd><dt>Email status</dt><dd>${u.verified ? 'Verified' : 'Not verified'}</dd><dt>Registered</dt><dd>${esc(u.registered)}</dd><dt>Approved</dt><dd>${esc(u.approved || 'Not yet')}</dd></dl>
  <div class="actions"><button class="btn out" data-a="status">${icon('i-refresh')} Check status</button></div></article>
  <article class="card"><h2>Session</h2><dl class="kv"><dt>Signed in</dt><dd>${MN.fmt(s.since)}</dd><dt>Expires</dt><dd>${MN.fmt(s.exp)}</dd><dt>Remaining</dt><dd>${exp ? days + ' day' + (days === 1 ? '' : 's') : 'Expired'}</dd></dl></article>
  <article class="card"><h2>Storage</h2><dl class="kv"><dt>Device notes</dt><dd>${notes.filter(n => !n.trashed).length}</dd><dt>Cloud-backed</dt><dd>${notes.filter(n => n.cloud && !n.trashed).length}</dd><dt>Not pushed</dt><dd>${notes.filter(n => n.cloud && !n.trashed && MN.cloudState(n) !== 'Synced').length}</dd><dt>Last Cloud check</dt><dd>${sc.syncOk ? MN.fmt(sc.syncOk) : 'Never'}</dd><dt>Protected storage</dt><dd id="ac-persist">...</dd></dl>
  <div class="actions"><button class="btn" data-a="sync">${icon('i-cloud')} Check Cloud now</button></div></article>
  <article class="card"><button class="btn danger block" data-a="logout">${icon('i-logout')} Log out</button></article>`;
  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { const e = $('#ac-persist'); if (e) e.textContent = p ? 'On' : 'Not granted'; });
}
document.addEventListener('click', e => {
  const b = e.target.closest('#page-account [data-a]'); if (!b) return;
  ({ login, signup, status: refresh, logout, sync() { if (MN.cloud) MN.cloud.sync({ reason: 'manual' }); } })[b.dataset.a]();
});

MN.x('account', { open: m => (m === 'signup' ? signup() : login()), gate, refresh, logout });
MN.on('page:account', render); MN.on('auth', render); MN.on('notes', () => { if (MN.page() === 'account') render(); }); MN.on('sync:done', () => { if (MN.page() === 'account') render(); });
MN.on('boot', render);
})();
