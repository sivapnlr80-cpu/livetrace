// track.js — runs on recipient's device
// Reads sid + dbUrl from URL params. No config needed from user.
import { fbGet, fbSet, fbPoll } from './fb.js';

// ── READ URL PARAMS ────────────────────────────────────
const params = new URLSearchParams(location.search);
const SID    = params.get('sid') || '';
const DB_URL = (params.get('db') || '').trim().replace(/\/$/, '');

let watchId      = null;
let timerID      = null;
let stopAdminPoll = null;
let startTime    = 0;
let updateCount  = 0;

// ── BOOT ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Basic validation
  if (!SID || !DB_URL) {
    return showDone('❌', 'Invalid Link', 'This link is missing required parameters. Ask the sender for a new link.');
  }

  // Verify session exists
  let session;
  try {
    session = await fbGet(DB_URL, `sessions/${SID}`);
  } catch(e) {
    return showDone('❌', 'Connection Failed', 'Could not connect to server.\n\n' + e.message);
  }

  if (!session) return showDone('❌', 'Expired', 'This link has expired or is invalid.');
  if (session.status === 'stopped') return showDone('⛔', 'Session Ended', 'This tracking session has already ended.');
});

// ── REQUEST LOCATION PERMISSION ────────────────────────────
window.requestLocationPermission = function () {
  if (!navigator.geolocation) {
    showErr('Your device does not support GPS. Cannot share location.');
    return;
  }

  const btn = document.getElementById('accept-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Getting your GPS…';
  hideErr();

  // Request GPS immediately
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      // Got first fix — mark session active and start sharing
      try {
        await fbSet(DB_URL, `sessions/${SID}/status`, 'active');
      } catch(e) {
        showErr('Could not update server: ' + e.message);
        btn.disabled = false; btn.textContent = '✓ Share My Location'; return;
      }

      // Switch to sharing view
      document.getElementById('view-consent').style.display = 'none';
      document.getElementById('view-sharing').style.display = 'block';

      startTime = Date.now();
      startSharing();
    },
    (err) => {
      btn.disabled = false;
      btn.textContent = '✓ Share My Location';
      const msgs = {
        1: 'Location permission denied. Please allow location access and try again.',
        2: 'GPS unavailable. Make sure location is enabled on your device.',
        3: 'GPS timed out. Check your location settings and try again.'
      };
      showErr(msgs[err.code] || 'GPS error: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
};

// ── START CONTINUOUS GPS SHARING ──────────────────────
function startSharing() {
  // Elapsed timer
  timerID = setInterval(() => {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    const m   = Math.floor(sec / 60);
    document.getElementById('elapsed').textContent = m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
  }, 1000);

  // Poll for stop command from author
  stopAdminPoll = fbPoll(DB_URL, `sessions/${SID}/status`, status => {
    if (status === 'stopped') {
      cleanup();
      showDone('⛔', 'Session Ended', 'The requester has stopped tracking. Thank you.');
    }
  }, 3000);

  // Continuous GPS watch — pushes every position update to Firebase
  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);
      updateCount++;

      // Update UI
      setText('s-lat', lat.toFixed(5) + '°');
      setText('s-lng', lng.toFixed(5) + '°');
      setText('s-acc', '±' + acc + 'm');
      setText('s-cnt', updateCount);

      // Push to Firebase — write pos inside the session object
      try {
        await fbSet(DB_URL, `sessions/${SID}/pos`, {
          lat, lng, acc,
          ts: Date.now()
        });
      } catch(e) {
        console.warn('GPS push failed:', e.message);
      }
    },
    (err) => {
      console.warn('GPS watch error:', err.message);
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
  );

  // Stop sharing if page is closed
  window.addEventListener('beforeunload', () => {
    cleanup();
    // Best-effort sync write on unload
    navigator.sendBeacon &&
      navigator.sendBeacon(
        `${DB_URL}/sessions/${SID}/status.json`,
        JSON.stringify('stopped')
      );
  });
}

// ── DECLINE ───────────────────────────────────────────
window.decline = async function () {
  try { await fbSet(DB_URL, `sessions/${SID}/status`, 'declined'); } catch {}
  showDone('🚫', 'Declined', 'You declined to share your location.');
};

// ── CLEANUP ───────────────────────────────────────────
function cleanup() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  clearInterval(timerID);
  if (stopAdminPoll) { stopAdminPoll(); stopAdminPoll = null; }
}

// ── HELPERS ───────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showDone(icon, title, msg) {
  cleanup();
  document.getElementById('view-consent').style.display  = 'none';
  document.getElementById('view-sharing').style.display  = 'none';
  document.getElementById('view-done').style.display     = 'block';
  setText('done-icon',  icon);
  setText('done-title', title);
  setText('done-msg',   msg);
}

function showErr(msg) {
  const el = document.getElementById('err');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideErr() {
  document.getElementById('err').style.display = 'none';
}
