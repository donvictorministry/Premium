/* MISSION NOTE - page-cover.js (self-contained module)
   Launch splash cover + desktop-computer blocker (Mission Note is for Android phones only).
   Removing this file removes both; the rest of the app is unaffected. */
(function () {
'use strict';
if (!window.MN) return;
const css = document.createElement('style');
css.textContent = `
.pc{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:1.5rem;text-align:center;background:#1877F2;color:#fff;width:100dvw;height:100dvh}
.pc h1{font-size:2rem;letter-spacing:.3px}.pc p{font-size:1rem;max-width:90dvw;overflow-wrap:anywhere}
.pc .logo{width:6rem;height:6rem;border-radius:26px;background:#fff;display:grid;place-items:center}
.pc .logo svg{width:3.6rem;height:3.6rem;fill:none;stroke:#1877F2;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pc.out{opacity:0;transition:opacity .35s;pointer-events:none}
.pc.block{background:var(--bg,#fff);color:var(--tx,#000)}.pc.block .logo{background:#1877F2}.pc.block .logo svg{stroke:#fff}
.pc .bar{width:9rem;height:.3rem;border-radius:.3rem;background:rgba(255,255,255,.35);overflow:hidden}
.pc .bar i{display:block;height:100%;width:40%;background:#fff;border-radius:.3rem;animation:pcb 1.1s ease-in-out infinite}
@keyframes pcb{0%{margin-left:-40%}100%{margin-left:100%}}`;
document.head.appendChild(css);
const logo = '<div class="logo"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4"/></svg></div>';

const ua = navigator.userAgent || '';
if (!(/Android/i.test(ua) && /Mobile/i.test(ua))) {
  MN.blocked = true;
  const d = document.createElement('div'); d.className = 'pc block';
  d.innerHTML = `${logo}<h1>Android phones only</h1><p>Mission Note is built for Android phones. Open this address in Chrome on your Android phone and install it from the browser menu.</p><p style="opacity:.75">If you are on a phone, turn off "Desktop site" in Chrome's menu.</p>`;
  document.body.appendChild(d);
  const app = document.getElementById('app'); if (app) app.style.display = 'none';
  return;
}
const s = document.createElement('div'); s.className = 'pc'; s.setAttribute('aria-hidden', 'true');
s.innerHTML = `${logo}<h1>Mission Note</h1><p>Private community notes</p><div class="bar"><i></i></div>`;
document.body.appendChild(s);
const t0 = Date.now();
const hide = () => setTimeout(() => { s.classList.add('out'); setTimeout(() => s.remove(), 400); }, Math.max(0, 900 - (Date.now() - t0)));
MN.on('ready', hide); setTimeout(hide, 6000);
})();
