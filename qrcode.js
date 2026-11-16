/* MISSION NOTE - qrcode.js (self-contained module)
   Scannable QR codes using the credible CDN library "qrcode-generator" (cdnjs), loaded on first use and cached by the service worker.
   Public: MN.qr.show(text, {title}) and MN.qr.canvas(text, size) */
(function () {
'use strict';
if (!window.MN) return;
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const MAX_BYTES = 2800;
let loading;
const lib = () => {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = SRC; s.crossOrigin = 'anonymous';
    s.onload = () => res(window.qrcode); s.onerror = () => { loading = null; rej(new Error('QR library unavailable offline')); };
    document.head.appendChild(s);
  });
  return loading;
};
async function canvas(text, size) {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BYTES) throw new Error('TOO_LONG');
  const q = await lib(); q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
  const code = q(0, bytes < 1000 ? 'M' : 'L'); code.addData(text, 'Byte'); code.make();
  const n = code.getModuleCount(), quiet = 4, scale = Math.max(2, Math.floor(size / (n + quiet * 2))), px = scale * (n + quiet * 2);
  const c = document.createElement('canvas'); c.width = c.height = px; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, px, px); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (code.isDark(r, k)) x.fillRect((k + quiet) * scale, (r + quiet) * scale, scale, scale);
  c.style.cssText = 'width:100%;height:auto;max-width:100%;image-rendering:pixelated;border-radius:12px;border:2px solid #1877F2;background:#fff';
  return c;
}
async function show(text, o) {
  o = o || {};
  if (!MN.feature('qr')) return MN.toast('QR codes are turned off by the administrator.', 'err');
  MN.loader.show('Making QR code...');
  let c; try { c = await canvas(text, Math.min(720, Math.floor(window.innerWidth * 2))); }
  catch (e) {
    MN.loader.hide();
    return MN.modal.alert({ title: 'QR code not available', message: e.message === 'TOO_LONG' ? 'This note is too long for a QR code (limit is about 2,800 characters). Use WhatsApp, Bluetooth or Export instead.' : 'The QR tool needs internet the first time you use it. Connect and try again.' });
  }
  MN.loader.hide();
  const wrap = document.createElement('div'); wrap.style.textAlign = 'center'; wrap.appendChild(c);
  const p = document.createElement('p'); p.className = 'mut'; p.style.marginTop = '.6rem'; p.textContent = 'Scan with any camera or QR scanner.'; wrap.appendChild(p);
  MN.modal.open({
    title: o.title || 'QR Code', body: wrap, focus: false,
    buttons: [{ label: 'Save image', kind: 'out', onClick() { c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mission-note-qr.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); MN.toast('QR image saved', 'ok'); }); return false; } }, { label: 'Close', kind: 'primary' }]
  });
}
MN.x('qr', { show, canvas });
})();
