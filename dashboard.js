// dashboard.js — Author dashboard
import { fbGet, fbSet, fbDelete, fbPoll, fbTest } from './fb.js';

// ── STATE ──────────────────────────────────────────────
const DB_KEY   = 'lt_dburl';       // localStorage key for DB URL
let dbUrl      = '';
let leafMap    = null;
let mapReady   = false;
let trackers   = {};  // sid → { sid, label, status, pos, stopPoll }
let lastLink   = '';

// ── BOOT ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(DB_KEY) || '';
  if (saved) {
    dbUrl = saved;
    document.getElementById('db-url').value = saved;
    setStatus('✅ Firebase URL loaded. Ready to use.', 'ok');
    setBadge('ONLINE');
  }
  loadPersistedTrackers();
});

// ── FIREBASE SETUP ─────────────────────────────────────
window.saveAndTest = async function () {
  const val = document.getElementById('db-url').value.trim().replace(/\/$/, '');
  setStatus('⏳ Testing connection…', 'info');
  const err = await fbTest(val);
  if (err) { setStatus('❌ ' + err, 'err'); return; }
  dbUrl = val;
  localStorage.setItem(DB_KEY, dbUrl);
  setStatus('✅ Connected! Firebase is ready.', 'ok');
  setBadge('ONLINE');
  toast('✅ Firebase connected');
};

function setStatus(msg, type) {
  const el = document.getElementById('fb-status');
  el.textContent = msg;
  el.className = type;
  el.style.display = 'block';
}

function setBadge(text) {
  document.getElementById('status-badge').textContent = text;
}

// ── GENERATE LINK ──────────────────────────────────────
window.generateLink = async function () {
  if (!dbUrl) {
    toast('⚠️ Save your Firebase URL first');
    document.getElementById('db-url').focus();
    return;
  }
  const label = document.getElementById('label').value.trim() || 'Tracker';
  const sid   = 'LT' + Date.now().toString(36).toUpperCase().slice(-5)
              + Math.random().toString(36).slice(2,5).toUpperCase();

  // Write session to Firebase
  try {
    await fbSet(dbUrl, `sessions/${sid}`, {
      sid, label,
      status: 'waiting',  // waiting | active | stopped
      createdAt: Date.now()
    });
  } catch(e) {
    toast('❌ Firebase error: ' + e.message); return;
  }

  // Build the tracking link — embed dbUrl so recipient needs nothing
  const base = location.href.replace(/\/index\.html.*$/, '').replace(/\/$/, '');
  const link = `${base}/track.html?sid=${sid}&db=${encodeURIComponent(dbUrl)}`;

  lastLink = link;
  document.getElementById('link-text').textContent = link;
  document.getElementById('link-section').style.display = 'block';

  // Add to local tracker list and start polling
  addTracker(sid, label, 'waiting');
  persistTrackers();
  toast('🔗 Link generated — share it!');
};

// ── LINK ACTIONS ───────────────────────────────────────
window.copyLink = function () {
  navigator.clipboard.writeText(lastLink || document.getElementById('link-text').textContent)
    .then(() => toast('📋 Copied to clipboard!'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = lastLink; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      toast('📋 Copied!');
    });
};
window.openLink  = () => window.open(document.getElementById('link-text').textContent, '_blank');
window.shareLink = function () {
  const url = document.getElementById('link-text').textContent;
  if (navigator.share) navigator.share({ title: 'LiveTrace', url }).catch(() => window.copyLink());
  else window.copyLink();
};

// ── TRACKER MANAGEMENT ────────────────────────────────
function addTracker(sid, label, status) {
  if (trackers[sid]) return; // already added

  const t = { sid, label, status: status || 'waiting', pos: null, stopPoll: null };
  trackers[sid] = t;

  // Start polling this session
  t.stopPoll = fbPoll(dbUrl, `sessions/${sid}`, session => {
    if (!session) return;
    onSessionUpdate(sid, session);
  }, 2500);

  renderTrackers();
}

function onSessionUpdate(sid, session) {
  const t = trackers[sid];
  if (!t) return;

  const prevStatus = t.status;
  t.status = session.status;

  // Update position if present
  if (session.pos && session.pos.lat) {
    t.pos = session.pos;
    updateMapPin(sid, session.pos, t.label);
    updatePosText(sid, session.pos);
  }

  if (session.status !== prevStatus) {
    if (session.status === 'active' && prevStatus === 'waiting') {
      toast(`📍 ${t.label} is now sharing live!`);
      switchToMap();
    }
    if (session.status === 'stopped') {
      removeMapPin(sid);
      toast(`⛔ ${t.label} stopped sharing`);
    }
  }

  renderTracker(sid);
  persistTrackers();
}

// ── STOP A TRACKER (author stops it) ──────────────────
window.stopTracker = async function (sid) {
  const t = trackers[sid]; if (!t) return;
  try {
    await fbSet(dbUrl, `sessions/${sid}/status`, 'stopped');
  } catch(e) { toast('❌ ' + e.message); return; }
  t.status = 'stopped';
  removeMapPin(sid);
  renderTracker(sid);
  persistTrackers();
  toast(`⛔ Stopped ${t.label}`);
};

// ── DELETE A TRACKER FROM LIST ─────────────────────────
window.deleteTracker = function (sid) {
  const t = trackers[sid]; if (!t) return;
  if (t.stopPoll) t.stopPoll();
  removeMapPin(sid);
  delete trackers[sid];
  persistTrackers();
  renderTrackers();
  toast('🗑️ Removed');
};

// ── RENDER ─────────────────────────────────────────────
function renderTrackers() {
  const el = document.getElementById('tracker-list');
  const keys = Object.keys(trackers);
  document.getElementById('tracker-count').textContent = keys.length;

  if (!keys.length) {
    el.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px 0">No trackers yet. Generate a link and share it.</div>';
    return;
  }
  el.innerHTML = '';
  keys.forEach(sid => renderTracker(sid, true));
}

function renderTracker(sid, append = false) {
  const t = trackers[sid]; if (!t) return;

  const isActive  = t.status === 'active';
  const isStopped = t.status === 'stopped';
  const isWaiting = t.status === 'waiting';

  const badgeClass = isActive ? 'badge-live' : isStopped ? 'badge-off' : 'badge-wait';
  const badgeText  = isActive ? '● LIVE' : isStopped ? 'STOPPED' : 'WAITING';

  const posText = t.pos
    ? `📍 ${t.pos.lat.toFixed(5)}, ${t.pos.lng.toFixed(5)} · ±${t.pos.acc}m`
    : isWaiting ? 'Waiting for user to accept...'
    : isStopped ? 'Session ended'
    : 'Getting location...';

  const stopBtn = !isStopped
    ? `<button class="btn btn-danger btn-sm" onclick="stopTracker('${sid}')">⛔ Stop</button>`
    : '';
  const delBtn = `<button class="btn btn-outline btn-sm" onclick="deleteTracker('${sid}')">🗑️</button>`;

  const html = `
    <div class="ti-top">
      <div class="ti-avatar">👤</div>
      <div class="ti-info">
        <div class="ti-name">${esc(t.label)}</div>
        <div class="ti-sub">${sid}</div>
      </div>
      <span class="badge ${badgeClass}">${badgeText}</span>
    </div>
    <div class="ti-pos" id="pos-${sid}">${posText}</div>
    <div class="ti-actions">${stopBtn}${delBtn}</div>`;

  const existing = document.getElementById('tr-' + sid);
  if (existing) {
    existing.className = `tracker-item ${isActive ? 'active' : isStopped ? 'stopped' : ''}`;
    existing.innerHTML = html;
  } else {
    const div = document.createElement('div');
    div.className = `tracker-item ${isActive ? 'active' : ''}`;
    div.id = 'tr-' + sid;
    div.innerHTML = html;
    document.getElementById('tracker-list').appendChild(div);
  }
}

function updatePosText(sid, pos) {
  const el = document.getElementById('pos-' + sid);
  if (el) el.textContent = `📍 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} · ±${pos.acc}m`;
}

// ── MAP ────────────────────────────────────────────────
let markers = {};

function initMap() {
  if (mapReady) return;
  mapReady = true;
  document.getElementById('map-empty').style.display = 'none';
  const mapEl = document.getElementById('map');
  mapEl.style.display = 'block';
  leafMap = L.map('map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(leafMap);
}

function updateMapPin(sid, pos, label) {
  initMap();
  const ll = [pos.lat, pos.lng];
  const popupText = `<b>${esc(label)}</b><br>${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}<br>±${pos.acc}m`;

  if (!markers[sid]) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="map-pin"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7]
    });
    markers[sid] = L.marker(ll, { icon }).addTo(leafMap).bindPopup(popupText);
    leafMap.setView(ll, 15);
  } else {
    markers[sid].setLatLng(ll).setPopupContent(popupText);
    leafMap.panTo(ll);
  }
}

function removeMapPin(sid) {
  if (markers[sid] && leafMap) {
    leafMap.removeLayer(markers[sid]);
    delete markers[sid];
  }
}

function switchToMap() {
  // Nothing needed — map is always visible on desktop, auto-updates
  if (leafMap) setTimeout(() => leafMap.invalidateSize(), 100);
}

// ── PERSIST TRACKERS ──────────────────────────────────
function persistTrackers() {
  // Save minimal info — no stopPoll fn
  const data = {};
  for (const [sid, t] of Object.entries(trackers)) {
    data[sid] = { sid: t.sid, label: t.label, status: t.status };
  }
  localStorage.setItem('lt_trackers', JSON.stringify(data));
}

function loadPersistedTrackers() {
  try {
    const data = JSON.parse(localStorage.getItem('lt_trackers') || '{}');
    if (!dbUrl) return; // need dbUrl to poll
    for (const t of Object.values(data)) {
      addTracker(t.sid, t.label, t.status);
    }
  } catch {}
}

// ── UTILS ──────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let _toastTimer;
function toast(msg) {
  clearTimeout(_toastTimer);
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
