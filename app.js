// app.js — Sender dashboard logic
import { saveConfig, loadConfig, hasConfig, fbSet, fbDelete, fbListen, testConnection } from './firebase.js';

const S = {
  sessions: {},
  mainMap: null,
  mainMarkers: {},
  mapReady: false,
  listeners: {},   // sid -> unsubscribe fn
};

// ── INIT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadSavedSessions();
  prefillFirebase();
});

function prefillFirebase() {
  const cfg = loadConfig();
  if (cfg) {
    if (cfg.url) document.getElementById('fb-url').value = cfg.url;
    if (cfg.apiKey) document.getElementById('fb-key').value = cfg.apiKey;
    if (cfg.projectId) document.getElementById('fb-pid').value = cfg.projectId;
    showFbStatus('✅ Config loaded from storage', 'var(--g)');
  }
}

// ── FIREBASE SETUP ────────────────────────────────────
window.saveFirebase = function () {
  const url = document.getElementById('fb-url').value.trim();
  const key = document.getElementById('fb-key').value.trim();
  const pid = document.getElementById('fb-pid').value.trim();
  if (!url || !key) { showFbStatus('❌ URL and API Key are required', 'var(--r)'); return; }
  saveConfig(url, key, pid);
  showFbStatus('✅ Config saved!', 'var(--g)');
  showToast('✅', 'Firebase config saved');
};

window.testFirebase = async function () {
  const url = document.getElementById('fb-url').value.trim();
  const key = document.getElementById('fb-key').value.trim();
  const pid = document.getElementById('fb-pid').value.trim();
  if (!url || !key) { showFbStatus('❌ Fill in URL and API Key first', 'var(--r)'); return; }
  saveConfig(url, key, pid);
  showFbStatus('⏳ Testing...', 'var(--dm)');
  const result = await testConnection();
  showFbStatus(result.ok ? '✅ ' + result.msg : '❌ ' + result.msg, result.ok ? 'var(--g)' : 'var(--r)');
};

function showFbStatus(msg, color) {
  const el = document.getElementById('fb-status');
  el.style.display = 'block';
  el.style.color = color;
  el.textContent = msg;
}

// ── GENERATE CONSENT LINK ─────────────────────────────
window.generate = async function () {
  if (!hasConfig()) {
    showToast('⚠️', 'Set up Firebase config first');
    document.getElementById('firebase-setup-card').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const me  = document.getElementById('i-me').value.trim();
  const rec = document.getElementById('i-rec').value.trim();
  if (!me)  { showToast('⚠️', 'Enter your name'); return; }
  if (!rec) { showToast('⚠️', 'Enter recipient name'); return; }

  const sid = 'LT' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,4).toUpperCase();
  const dur = document.getElementById('i-dur').value;
  const pur = document.getElementById('i-pur').value;

  // Write session metadata to Firebase
  try {
    await fbSet(`sessions/${sid}`, {
      sid, me, rec, dur, pur,
      status: 'pending',
      createdAt: Date.now()
    });
  } catch (e) {
    showToast('❌', 'Firebase error: ' + e.message);
    return;
  }

  // Build consent URL — embed Firebase config so recipient's device doesn't need it
  const cfg  = loadConfig();
  const base = window.location.href.replace('index.html', '').replace(/\/$/, '');
  const params = new URLSearchParams({
    sid,
    fbUrl: cfg.url,
    fbKey: cfg.apiKey,
    fbPid: cfg.projectId || ''
  });
  const link = `${base}/consent.html?${params.toString()}`;

  S.sessions[sid] = { sid, name: rec, pur, dur };
  document.getElementById('link-show').textContent = link;
  document.getElementById('link-result').style.display = 'block';

  renderSessions();
  startListening(sid);
  addLog(`📤 Link generated for <span class="cc">${rec}</span> — ${pur} · <span class="cc">${sid}</span>`);
  showToast('🔗', 'Link ready! Share it with ' + rec);
};

// ── LINK ACTIONS ──────────────────────────────────────
window.copyLink = function () {
  const url = document.getElementById('link-show').textContent;
  navigator.clipboard.writeText(url)
    .then(() => showToast('📋', 'Copied to clipboard!'))
    .catch(() => {
      const t = document.createElement('textarea');
      t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.focus(); t.select();
      document.execCommand('copy'); document.body.removeChild(t);
      showToast('📋', 'Copied!');
    });
};

window.openLink = function () {
  window.open(document.getElementById('link-show').textContent, '_blank');
};

window.shareLink = function () {
  const url = document.getElementById('link-show').textContent;
  if (navigator.share) {
    navigator.share({ title: 'LiveTrace Location Request', text: 'Please share your live location with me.', url })
      .catch(() => window.copyLink());
  } else { window.copyLink(); }
};

// ── LISTEN FOR GPS UPDATES (real-time) ───────────────
function startListening(sid) {
  if (S.listeners[sid]) return;

  // Listen for consent events
  S.listeners[sid + '_status'] = fbListen(`sessions/${sid}/status`, (status) => {
    if (status === 'granted') {
      addLog(`✅ Consent <span class="gc">GRANTED</span> by <span class="cc">${S.sessions[sid]?.name}</span>`);
      setBadge(sid, 'a');
      showToast('✅', S.sessions[sid]?.name + ' started sharing!');
      tab('t-map');
    }
    if (status === 'denied') {
      addLog(`❌ Request <span class="rc">DECLINED</span> · ${sid}`);
      setBadge(sid, 'r');
      showToast('🚫', 'Request was declined');
    }
    if (status === 'revoked') {
      onRevoked(sid);
    }
  });

  // Listen for GPS position updates
  S.listeners[sid + '_pos'] = fbListen(`positions/${sid}`, (pos) => {
    if (pos && pos.lat) {
      S.sessions[sid].active = true;
      setBadge(sid, 'a');
      updateMap({ ...pos, sid, name: S.sessions[sid]?.name });
    }
  });
}

function onRevoked(sid) {
  setBadge(sid, 'r');
  if (S.mainMap && S.mainMarkers[sid]) {
    S.mainMap.removeLayer(S.mainMarkers[sid]);
    delete S.mainMarkers[sid];
  }
  const cnt = Object.keys(S.mainMarkers).length;
  document.getElementById('map-count').textContent = cnt + ' tracking';
  if (cnt === 0) document.getElementById('map-ph').style.display = 'flex';
  addLog(`⛔ Sharing stopped · <span class="rc">${sid}</span>`);
  showToast('⛔', 'Recipient stopped sharing');
  // Clean up listeners
  if (S.listeners[sid + '_pos']) { S.listeners[sid + '_pos'](); delete S.listeners[sid + '_pos']; }
}

window.revokeSession = async function (sid) {
  try { await fbSet(`sessions/${sid}/status`, 'admin-revoke'); } catch (e) {}
  onRevoked(sid);
  showToast('⛔', 'Session revoked');
  addLog(`⛔ You revoked session <span class="rc">${sid}</span>`);
};

// ── MAP ───────────────────────────────────────────────
function initMap() {
  if (S.mapReady) return;
  S.mapReady = true;
  document.getElementById('map-ph').style.display = 'none';
  const m = L.map('main-map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(m);
  S.mainMap = m;
}

function updateMap(msg) {
  initMap();
  document.getElementById('map-ph').style.display = 'none';
  document.getElementById('map-info').style.display = 'grid';
  const ll = [msg.lat, msg.lng];

  if (!S.mainMarkers[msg.sid]) {
    const icon = L.divIcon({ className: '', html: '<div class="lt-pin"></div>', iconSize: [16,16], iconAnchor: [8,8] });
    S.mainMarkers[msg.sid] = L.marker(ll, { icon })
      .addTo(S.mainMap)
      .bindPopup(`<b>${msg.name}</b><br>${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}<br>±${msg.acc}m`);
  } else {
    S.mainMarkers[msg.sid].setLatLng(ll);
    S.mainMarkers[msg.sid].setPopupContent(`<b>${msg.name}</b><br>${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}<br>±${msg.acc}m`);
  }
  S.mainMap.panTo(ll);
  document.getElementById('map-count').textContent = Object.keys(S.mainMarkers).length + ' tracking';
  document.getElementById('m-lat').textContent = msg.lat.toFixed(6) + '°';
  document.getElementById('m-lng').textContent = msg.lng.toFixed(6) + '°';
  document.getElementById('m-acc').textContent = '±' + msg.acc;
  const d = new Date(msg.ts || Date.now());
  document.getElementById('m-upd').textContent =
    d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

// ── SESSIONS ─────────────────────────────────────────
function loadSavedSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem('livetrace_sessions') || '{}');
    Object.assign(S.sessions, saved);
    if (Object.keys(S.sessions).length > 0) {
      renderSessions();
      Object.keys(S.sessions).forEach(sid => startListening(sid));
    }
  } catch {}
}

function saveSessions() {
  localStorage.setItem('livetrace_sessions', JSON.stringify(S.sessions));
}

function renderSessions() {
  const el = document.getElementById('s-list');
  if (Object.keys(S.sessions).length === 0) {
    el.innerHTML = '<div style="color:var(--dm);font-size:12px;padding:6px 0">No sessions yet.</div>';
    return;
  }
  el.innerHTML = '';
  Object.values(S.sessions).forEach(s => {
    const d = document.createElement('div');
    d.className = 'srow'; d.id = 'sr-' + s.sid;
    d.innerHTML = `
      <div class="sav">👤</div>
      <div class="si">
        <div class="sn">${s.name}</div>
        <div class="sm">${s.pur} · ${s.sid}</div>
      </div>
      <span class="sbadge b-p" id="bd-${s.sid}">PENDING</span>
      <button class="btn btn-r" style="padding:6px 10px;font-size:10px" onclick="revokeSession('${s.sid}')">⛔ Revoke</button>`;
    el.appendChild(d);
  });
  saveSessions();
  document.getElementById('link-result').style.display = 'block';
}

function setBadge(sid, state) {
  const b = document.getElementById('bd-' + sid);
  if (!b) return;
  const m = { a: ['b-a','ACTIVE'], p: ['b-p','PENDING'], r: ['b-r','REVOKED'] };
  b.className = 'sbadge ' + (m[state]?.[0] || 'b-p');
  b.textContent = m[state]?.[1] || state.toUpperCase();
}

// ── TABS ─────────────────────────────────────────────
window.tab = function (id) {
  ['t-req','t-map','t-log'].forEach(t => {
    document.getElementById(t).style.display = t === id ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('on', ['t-req','t-map','t-log'][i] === id);
  });
  if (id === 't-map' && S.mainMap) setTimeout(() => S.mainMap.invalidateSize(), 80);
};

// ── LOG ───────────────────────────────────────────────
function addLog(msg) {
  const el = document.getElementById('audit-log');
  if (el.children.length === 1 && el.children[0].querySelector('.dm')) el.innerHTML = '';
  const d = new Date();
  const ts = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
  const row = document.createElement('div');
  row.className = 'lline';
  row.innerHTML = `<span class="lt2">${ts}</span><span class="lm">${msg}</span>`;
  el.insertBefore(row, el.firstChild);
}

// ── TOAST ─────────────────────────────────────────────
let _tt;
function showToast(ico, msg) {
  clearTimeout(_tt);
  document.getElementById('t-ico').textContent = ico;
  document.getElementById('t-msg').textContent = msg;
  const t = document.getElementById('toast');
  t.classList.add('on');
  _tt = setTimeout(() => t.classList.remove('on'), 3500);
}
