// consent.js — runs on recipient's device
import { saveDbUrl, dbGet, dbSet, dbWatch } from './firebase.js';

// Everything comes from the URL — recipient needs zero setup
const p      = new URLSearchParams(location.search);
const SID    = p.get('sid')   || '';
const DB_URL = (p.get('dbUrl') || '').trim().replace(/\/$/, '');

let gpsWatch     = null;
let elapsedTimer = null;
let stopRevokePoll = null;
let map          = null;
let marker       = null;
let count        = 0;
let startTime    = 0;
let session      = null;

// ── BOOT ──────────────────────────────────────────────
addEventListener('DOMContentLoaded', async () => {
  show('loading-view');
  setPill('LOADING');

  // 1. Validate URL params
  if (!SID) return fatal('❌', 'Bad Link', 'No session ID. Ask sender for a new link.');
  if (!DB_URL.startsWith('https://'))
    return fatal('⚙️', 'Config Missing',
      'Firebase URL missing from link.\n\nAsk the sender to:\n1. Open LiveTrace dashboard\n2. Save their Firebase URL\n3. Regenerate the link');

  // 2. Persist dbUrl so dbGet/dbSet helpers can use it
  saveDbUrl(DB_URL);

  // 3. Load session
  try { session = await dbGet(DB_URL, `sessions/${SID}`); }
  catch(e) { return fatal('❌', 'Connection Error', 'Could not reach Firebase:\n' + e.message); }

  if (!session)
    return fatal('❌', 'Not Found', 'Session not found or expired.');
  if (['revoked','admin-revoke','denied'].includes(session.status))
    return fatal('⛔', 'Session Ended', 'This session has already ended.');

  // 4. Show consent form
  setText('c-from', session.me || 'Someone');
  setText('c-name', session.me || '—');
  setText('c-dur',  session.dur == '0' ? 'Until revoked' : session.dur + ' minutes');
  setText('c-pur',  session.pur || '—');
  setText('c-sid',  SID);
  setPill('REQUEST');
  show('consent-view');
});

// ── ALLOW ─────────────────────────────────────────────
window.grantConsent = function() {
  if (!navigator.geolocation) return popToast('❌', 'GPS not available on this device');
  const btn = id('allow-btn');
  btn.disabled = true; btn.textContent = '⏳ Requesting GPS…';

  navigator.geolocation.getCurrentPosition(async () => {
    // Write status = granted
    try { await dbSet(DB_URL, `sessions/${SID}/status`, 'granted'); }
    catch(e) { popToast('❌', 'Firebase error: ' + e.message); btn.disabled = false; btn.textContent = '✓ Allow & Share'; return; }

    show('sharing-view');
    setPill('LIVE');
    startGPS();
  }, err => {
    popToast('❌', 'GPS: ' + err.message);
    btn.disabled = false; btn.textContent = '✓ Allow & Share';
  }, { enableHighAccuracy: true, timeout: 15000 });
};

// ── DENY ──────────────────────────────────────────────
window.denyConsent = async function() {
  try { await dbSet(DB_URL, `sessions/${SID}/status`, 'denied'); } catch {}
  fatal('🚫', 'Declined', 'You declined to share. You may close this page.');
};

// ── GPS + PUSH TO FIREBASE ────────────────────────────
function startGPS() {
  startTime = Date.now();
  const dur = parseInt(session?.dur || '0');

  // Init map
  map = L.map('share-map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);

  // Elapsed timer
  elapsedTimer = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(s / 60);
    setText('elapsed', m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
    if (dur > 0 && s >= dur * 60) window.stopSharing();
  }, 1000);

  // Poll for admin revoke
  stopRevokePoll = dbWatch(DB_URL, `sessions/${SID}/status`, status => {
    if (status === 'admin-revoke') window.stopSharing();
  }, 4000);

  // Watch GPS → push each update to Firebase
  gpsWatch = navigator.geolocation.watchPosition(async pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = Math.round(pos.coords.accuracy);
    count++;

    // Update UI
    setText('sh-lat', lat.toFixed(5) + '°');
    setText('sh-lng', lng.toFixed(5) + '°');
    setText('sh-acc', '±' + acc + 'm');
    setText('sh-cnt', count);

    // Update map
    const ll = [lat, lng];
    if (!marker) {
      const icon = L.divIcon({ className:'', html:'<div class="lt-pin"></div>', iconSize:[16,16], iconAnchor:[8,8] });
      marker = L.marker(ll, { icon }).addTo(map);
      map.setView(ll, 15);
    } else {
      marker.setLatLng(ll);
      map.panTo(ll);
    }

    // Push position to Firebase — dashboard watches this path
    try {
      await dbSet(DB_URL, `positions/${SID}`, { lat, lng, acc, ts: Date.now(), name: session?.rec || '' });
    } catch(e) {
      console.warn('Push failed:', e.message);
    }

  }, err => popToast('❌', 'GPS error: ' + err.message),
  { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });

  popToast('✅', 'Live — sharing with ' + (session?.me || 'requester'));
}

// ── STOP ──────────────────────────────────────────────
window.stopSharing = async function() {
  if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
  clearInterval(elapsedTimer);
  if (stopRevokePoll) { stopRevokePoll(); stopRevokePoll = null; }
  try {
    await dbSet(DB_URL, `sessions/${SID}/status`, 'revoked');
    await dbSet(DB_URL, `positions/${SID}`,  { cleared: true });  // PUT null causes issues; use sentinel
  } catch {}
  setPill('STOPPED');
  fatal('⛔', 'Sharing Stopped', 'Your location is no longer being shared. You may close this page.');
};

// ── HELPERS ───────────────────────────────────────────
function id(x)         { return document.getElementById(x); }
function setText(x, v) { const el = id(x); if (el) el.textContent = v; }
function setPill(t)    { setText('hdr-pill', t); }

function show(viewId) {
  ['loading-view','consent-view','sharing-view','done-view']
    .forEach(v => id(v).style.display = v === viewId ? (v === 'loading-view' ? 'flex' : 'block') : 'none');
}

function fatal(icon, title, msg) {
  show('done-view');
  setText('done-icon', icon); setText('done-title', title); setText('done-msg', msg);
}

let _t;
function popToast(ico, msg) {
  clearTimeout(_t);
  setText('t-ico', ico); setText('t-msg', msg);
  const t = id('toast'); t.classList.add('on');
  _t = setTimeout(() => t.classList.remove('on'), 4000);
}
