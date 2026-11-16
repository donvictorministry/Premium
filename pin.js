/* MISSION NOTE - pin.js (self-contained module)
   Frontend-only four-digit PIN lock for notes stored on this Device.
   NOT encryption and NOT Cloud access control: the PIN never leaves the phone and does not lock the Cloud copy. */
(function () {
'use strict';
if (!window.MN) return;
const { $, esc, icon } = MN;
const css = document.createElement('style');
css.textContent = '.pin-in{text-align:center;font-size:1.6rem;letter-spacing:.6rem;font-weight:700}';
document.head.appendChild(css);

const unlocked = new Map(), fails = new Map(); // id -> time / {n, until}
const GRACE = 3 * 60 * 1000;
document.addEventListener('visibilitychange', () => { if (document.hidden) unlocked.clear(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pin-eye]'); if (!b) return;
  const i = b.parentNode.querySelector('input'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.innerHTML = icon(show ? 'i-eyeoff' : 'i-eye');
});
const field = (id, label) => `<label class="field"><span>${esc(label)}</span><div class="inp-wrap"><input id="${id}" class="inp pin-in" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="0000"><button type="button" class="eye" data-pin-eye aria-label="Show or hide PIN">${icon('i-eye')}</button></div></label>`;
const digits = el => el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 4); });
async function hash(pin, salt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const showErr = (h, m) => { const p = $('.err', h.el); p.textContent = m; p.hidden = false; MN.haptic([20, 40, 20]); };
const FORGOT = '<p class="mut" style="margin-top:.6rem">Forgot your PIN? It cannot be recovered. If this note was pushed to Cloud, delete the local copy and restore it from Cloud.</p>';

async function check(n, title, force) {
  if (!n.pin) return true;
  if (!force && unlocked.has(n.id) && Date.now() - unlocked.get(n.id) < GRACE) return true;
  const f = fails.get(n.id);
  if (f && f.until > Date.now()) { MN.toast('Too many wrong PINs. Wait ' + Math.ceil((f.until - Date.now()) / 1000) + ' seconds.', 'err'); return false; }
  const hd = MN.modal.open({
    title: title || 'Enter PIN', body: `<p class="mut">"${esc(n.name)}" is locked on this Device.</p>${field('pn1', 'Four-digit PIN')}<p class="err" hidden></p>${FORGOT}`,
    buttons: [{ label: 'Cancel', kind: 'danger', value: false }, {
      label: 'Unlock', kind: 'primary', async onClick(h) {
        const v = $('#pn1', h.el).value; if (!/^\d{4}$/.test(v)) { showErr(h, 'Enter exactly four digits.'); return false; }
        if (await hash(v, n.pin.s) === n.pin.h) { fails.delete(n.id); unlocked.set(n.id, Date.now()); return { value: true }; }
        const c = (fails.get(n.id) || { n: 0 }); c.n++; if (c.n >= 5) { c.until = Date.now() + 60000; c.n = 0; fails.set(n.id, c); MN.toast('Too many wrong PINs. Try again in 60 seconds.', 'err'); return { value: false }; }
        fails.set(n.id, c); showErr(h, 'Wrong PIN. ' + (5 - c.n) + ' tries left.'); return false;
      }
    }]
  });
  digits($('#pn1', hd.el)); return (await hd.result) === true;
}
async function setNew(n, title) {
  const hd = MN.modal.open({
    title: title || 'Set PIN', body: `<p class="mut">Choose a four-digit PIN. It locks this note on this phone only.</p>${field('pn1', 'New PIN')}${field('pn2', 'Confirm PIN')}<p class="err" hidden></p>`,
    buttons: [{ label: 'Cancel', kind: 'danger', value: false }, {
      label: 'Save PIN', kind: 'primary', async onClick(h) {
        const a = $('#pn1', h.el).value, b = $('#pn2', h.el).value;
        if (!/^\d{4}$/.test(a)) { showErr(h, 'The PIN must be exactly four digits.'); return false; }
        if (a !== b) { showErr(h, 'The two PINs do not match.'); return false; }
        const salt = MN.uuid(); n.pin = { s: salt, h: await hash(a, salt) }; await MN.notes.put(n); unlocked.set(n.id, Date.now()); return { value: true };
      }
    }]
  });
  hd.body.querySelectorAll('input').forEach(digits); return (await hd.result) === true;
}
async function toggle(n) {
  if (!MN.feature('pin')) return MN.toast('PIN is turned off by the administrator.', 'err');
  if (!n.pin) { if (await setNew(n)) MN.toast('PIN set. This note is locked on this Device.', 'ok'); return; }
  const v = await MN.modal.choose({ title: 'PIN options', items: [{ label: 'Change PIN', icon: 'i-lock', value: 'c' }, { label: 'Remove PIN', icon: 'i-trash', value: 'r', danger: true }], cancel: 'Cancel' });
  if (!v || !await check(n, 'Enter current PIN', true)) return;
  if (v === 'c') { if (await setNew(n, 'Change PIN')) MN.toast('PIN changed', 'ok'); }
  else { n.pin = null; await MN.notes.put(n); unlocked.delete(n.id); MN.toast('PIN removed', 'ok'); }
}
MN.x('pin', { toggle, guard: n => check(n) });
})();
