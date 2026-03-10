// consent.js — Recipient GPS sharing page
import { saveConfig, loadConfig, fbGet, fbSet, fbListen } from './firebase.js';

const params     = new URLSearchParams(window.location.search);
const SID        = params.get('sid');
const DB_URL     = params.get('dbUrl');   // embedded by sender in the link

let watchId      = null;
let shareTimer   = null;
let shareMap     = null;
let shareMarker  = null;
let shareCnt     = 0;
let shareStart   = 0;
let sessionData  = null;
let unlistenAdmin = null;

window.addEventListener('DOMContentLoaded', async () => {

  // ── STEP 1: Validate link ──────────────────────────
  if (!SID) {
    return showDone('❌', 'Invalid Link', 'No session ID in this URL. Ask the sender for a fresh link.');
  }

  // ── STEP 2: Bootstrap Firebase config from URL ─────
  // The sender embeds ?dbUrl=https://... in the link.
  // This is the ONLY config the recipient needs.
  if (!DB_URL || !DB_URL.startsWith('https://')) {
    return showDone('⚙️', 'Config Missing',
      'This link is missing the Firebase Database URL. ' +
      'Ask the sender to regenerate the link — they must save their Firebase config first.');
  }

  // Save into localStorage so fbGet/fbSet/fbListen helpers work
  saveConfig(DB_URL, '');

  // ── STEP 3: Load session from Firebase ────────────
  showLoading(true);
  try {
    sessionData = await fbGet(`sessions/${SID}`);
  } catch (e) {
    return showDone('❌', 'Connection Failed',
      'Could not reach Firebase. Check your internet and try again.\n\nError: ' + e.message);
  } finally {
    showLoading(false);
  }

  if (!sessionData) {
    return showDone('❌', 'Session Not Found', 'This session has expired or been deleted.');
  }
  if (['revoked', 'admin-revoke', 'denied'].includes(sessionData.status)) {
    return showDone('⛔', 'Session Ended', 'This session has already ended or been revoked.');
  }

  // ── STEP 4: Show consent form ──────────────────────
  document.getElementById('c-from').textContent = sessionData.me || 'Someone';
  document.getElementById('c-name').textContent = sessionData.me || '—';
  document.getElementById('c-dur').textContent  = sessionData.dur == 0 ? 'Until revoked' : sessionData.dur + ' minutes';
  document.getElementById('c-pur').textContent  = sessionData.pur || '—';
  document.getElementById('c-sid').textContent  = SID;

  // Listen for admin revoke
  unlistenAdmin = fbListen(`sessions/${SID}/status`, status => {
    if (status === 'admin-revoke' || status === 'revoked') window.stopSharing();
  });
});

// ── GRANT ──────────────────────────────────────────────
window.grantConsent = function () {
  if (!navigator.geolocation) {
    return toast('❌', 'GPS not available on this device');
  }
  const btn = document.getElementById('allow-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Getting GPS...';

  navigator.geolocation.getCurrentPosition(
    async () => {
      try {
        await fbSet(`sessions/${SID}/status`, 'granted');
      } catch (e) {
        toast('❌', 'Could not write to Firebase: ' + e.message);
        btn.disabled = false; btn.textContent = '✓ Allow & Share'; return;
      }
      document.getElementById('consent-view').style.display  = 'none';
      document.getElementById('sharing-view').style.display  = 'block';
      document.getElementById('hdr-pill').innerHTML = '<span style="color:var(--g)">●</span> LIVE';
      startSharing();
    },
    err => {
      toast('❌', 'GPS error: ' + err.message);
      btn.disabled = false; btn.textContent = '✓ Allow & Share';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
};

// ── DENY ───────────────────────────────────────────────
window.denyConsent = async function () {
  try { await fbSet(`sessions/${SID}/status`, 'denied'); } catch {}
  showDone('🚫', 'Request Declined', 'You declined to share your location. You may close this page.');
};

// ── START SHARING ──────────────────────────────────────
function startSharing() {
  shareCnt = 0; shareStart = Date.now();
  const dur = parseInt(sessionData?.dur || 0);

  // Map
  shareMap = L.map('share-map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(shareMap);

  // Elapsed timer
  shareTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - shareStart) / 1000);
    const m   = Math.floor(sec / 60);
    document.getElementById('elapsed').textContent = m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
    if (dur > 0 && sec >= dur * 60) window.stopSharing();
  }, 1000);

  // GPS watch → push to Firebase
  watchId = navigator.geolocation.watchPosition(
    async pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const acc = Math.round(accuracy);
      shareCnt++;

      document.getElementById('sh-lat').textContent = lat.toFixed(5) + '°';
      document.getElementById('sh-lng').textContent = lng.toFixed(5) + '°';
      document.getElementById('sh-acc').textContent = '±' + acc + 'm';
      document.getElementById('sh-cnt').textContent = shareCnt;

      const ll = [lat, lng];
      if (!shareMarker) {
        const icon = L.divIcon({ className: '', html: '<div class="lt-pin"></div>', iconSize:[16,16], iconAnchor:[8,8] });
        shareMarker = L.marker(ll, { icon }).addTo(shareMap);
        shareMap.setView(ll, 15);
      } else {
        shareMarker.setLatLng(ll);
        shareMap.panTo(ll);
      }

      try {
        await fbSet(`positions/${SID}`, { lat, lng, acc, ts: Date.now() });
      } catch (e) { console.warn('Firebase write:', e.message); }
    },
    err => toast('❌', 'GPS: ' + err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );

  toast('✅', 'Sharing live with ' + (sessionData?.me || 'requester'));
}

// ── STOP ───────────────────────────────────────────────
window.stopSharing = async function () {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  clearInterval(shareTimer);
  if (unlistenAdmin) { unlistenAdmin(); unlistenAdmin = null; }
  try {
    await fbSet(`sessions/${SID}/status`, 'revoked');
    await fbSet(`positions/${SID}`, null);
  } catch {}
  showDone('⛔', 'Sharing Stopped', 'Location access revoked. You may close this page.');
  document.getElementById('hdr-pill').textContent = 'STOPPED';
};

// ── HELPERS ────────────────────────────────────────────
function showLoading(on) {
  document.getElementById('loading-view').style.display = on ? 'block' : 'none';
  document.getElementById('consent-view').style.display = on ? 'none'  : 'block';
}

function showDone(icon, title, msg) {
  ['consent-view','sharing-view','loading-view'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('done-view').style.display  = 'block';
  document.getElementById('done-icon').textContent    = icon;
  document.getElementById('done-title').textContent   = title;
  document.getElementById('done-msg').textContent     = msg;
}

let _tt;
function toast(ico, msg) {
  clearTimeout(_tt);
  document.getElementById('t-ico').textContent = ico;
  document.getElementById('t-msg').textContent = msg;
  const t = document.getElementById('toast'); t.classList.add('on');
  _tt = setTimeout(() => t.classList.remove('on'), 3500);
}
