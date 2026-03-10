// consent.js — Recipient consent + GPS sharing logic
import { loadConfig, saveConfig, fbGet, fbSet, fbListen } from './firebase.js';

const params = new URLSearchParams(window.location.search);
const SID = params.get('sid');

let watchId = null;
let shareTimer = null;
let shareMap = null;
let shareMarker = null;
let shareCnt = 0;
let shareStart = 0;
let sessionData = null;
let adminListener = null;

// ── INIT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!SID) {
    showDone('❌', 'Invalid Link', 'No session ID found in this link. Please ask the sender for a new link.');
    return;
  }

  // Copy Firebase config from URL params if present (sender can embed it)
  const fbUrl = params.get('fbUrl');
  const fbKey = params.get('fbKey');
  if (fbUrl && fbKey) {
    saveConfig(decodeURIComponent(fbUrl), decodeURIComponent(fbKey), params.get('fbPid') || '');
  }

  if (!loadConfig()) {
    showDone('⚙️', 'Firebase Not Configured', 'Ask the sender to include Firebase config in their link, or configure it manually.');
    return;
  }

  // Load session data from Firebase
  try {
    sessionData = await fbGet(`sessions/${SID}`);
  } catch (e) {
    showDone('❌', 'Session Not Found', 'This session may have expired or the link is invalid.');
    return;
  }

  if (!sessionData) {
    showDone('❌', 'Session Not Found', 'This session may have expired or been revoked.');
    return;
  }

  if (sessionData.status === 'revoked' || sessionData.status === 'admin-revoke') {
    showDone('⛔', 'Session Revoked', 'This location sharing session has been revoked by the requester.');
    return;
  }

  // Fill in the consent page
  document.getElementById('c-from').textContent = sessionData.me || 'Someone';
  document.getElementById('c-name').textContent = sessionData.me || '—';
  document.getElementById('c-dur').textContent  = sessionData.dur == 0 ? 'Until revoked' : sessionData.dur + ' minutes';
  document.getElementById('c-pur').textContent  = sessionData.pur || '—';
  document.getElementById('c-sid').textContent  = SID;

  // Listen for admin revoke
  adminListener = fbListen(`sessions/${SID}/status`, (status) => {
    if (status === 'admin-revoke' || status === 'revoked') {
      stopSharing();
    }
  });
});

// ── GRANT CONSENT ─────────────────────────────────────
window.grantConsent = function () {
  if (!navigator.geolocation) {
    toast('❌', 'GPS not supported on this device');
    return;
  }

  document.getElementById('allow-btn').disabled = true;
  document.getElementById('allow-btn').textContent = '⏳ Getting GPS...';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      // Got GPS — update session status and show sharing UI
      try {
        await fbSet(`sessions/${SID}/status`, 'granted');
      } catch (e) {
        toast('❌', 'Firebase error: ' + e.message);
        document.getElementById('allow-btn').disabled = false;
        document.getElementById('allow-btn').textContent = '✓ Allow & Share';
        return;
      }

      document.getElementById('consent-view').style.display = 'none';
      document.getElementById('sharing-view').style.display = 'block';
      document.getElementById('hdr-pill').innerHTML = '<span style="color:var(--g)">●</span> LIVE';

      startSharingLoop();
    },
    (err) => {
      toast('❌', 'GPS error: ' + err.message);
      document.getElementById('allow-btn').disabled = false;
      document.getElementById('allow-btn').innerHTML = '✓ Allow & Share';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

// ── DENY CONSENT ──────────────────────────────────────
window.denyConsent = async function () {
  try { await fbSet(`sessions/${SID}/status`, 'denied'); } catch {}
  showDone('🚫', 'Request Declined', 'You declined to share your location. You may close this page.');
};

// ── START SHARING GPS ─────────────────────────────────
function startSharingLoop() {
  shareCnt = 0;
  shareStart = Date.now();
  const dur = parseInt(sessionData?.dur || 0);

  // Init share map
  shareMap = L.map('share-map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(shareMap);

  // Elapsed timer + auto-expire
  shareTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - shareStart) / 1000);
    const m   = Math.floor(sec / 60);
    document.getElementById('elapsed').textContent = m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
    if (dur > 0 && sec >= dur * 60) stopSharing();
  }, 1000);

  // Watch GPS and push to Firebase
  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const acc = Math.round(accuracy);
      shareCnt++;

      // Update UI
      document.getElementById('sh-lat').textContent = lat.toFixed(5) + '°';
      document.getElementById('sh-lng').textContent = lng.toFixed(5) + '°';
      document.getElementById('sh-acc').textContent = '±' + acc + 'm';
      document.getElementById('sh-cnt').textContent = shareCnt;

      // Update map
      const ll = [lat, lng];
      if (!shareMarker) {
        const icon = L.divIcon({ className: '', html: '<div class="lt-pin"></div>', iconSize: [16,16], iconAnchor: [8,8] });
        shareMarker = L.marker(ll, { icon }).addTo(shareMap);
        shareMap.setView(ll, 15);
      } else {
        shareMarker.setLatLng(ll);
        shareMap.panTo(ll);
      }

      // Push to Firebase (sender receives via real-time listener)
      try {
        await fbSet(`positions/${SID}`, { lat, lng, acc, ts: Date.now() });
      } catch (e) {
        console.warn('Firebase write error:', e);
      }
    },
    (err) => { toast('❌', 'GPS: ' + err.message); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );

  toast('✅', 'GPS active — sharing with ' + (sessionData?.me || 'requester'));
}

// ── STOP SHARING ──────────────────────────────────────
window.stopSharing = async function () {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  clearInterval(shareTimer);
  if (adminListener) { adminListener(); adminListener = null; }

  try {
    await fbSet(`sessions/${SID}/status`, 'revoked');
    // Clean up position data
    await fbSet(`positions/${SID}`, null);
  } catch {}

  showDone('⛔', 'Sharing Stopped', 'You have revoked location access. You may close this page.');
  document.getElementById('hdr-pill').textContent = 'STOPPED';
};

// ── HELPERS ───────────────────────────────────────────
function showDone(icon, title, msg) {
  document.getElementById('consent-view').style.display  = 'none';
  document.getElementById('sharing-view').style.display  = 'none';
  document.getElementById('done-view').style.display     = 'block';
  document.getElementById('done-icon').textContent  = icon;
  document.getElementById('done-title').textContent = title;
  document.getElementById('done-msg').textContent   = msg;
}

let _tt;
function toast(ico, msg) {
  clearTimeout(_tt);
  document.getElementById('t-ico').textContent = ico;
  document.getElementById('t-msg').textContent = msg;
  const t = document.getElementById('toast');
  t.classList.add('on');
  _tt = setTimeout(() => t.classList.remove('on'), 3500);
}
