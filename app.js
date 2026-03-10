// app.js — Sender dashboard
import { saveConfig, loadConfig, hasConfig, fbSet, fbListen, testConnection } from './firebase.js';

const S = {
  sessions: {},
  mainMap: null,
  mainMarkers: {},
  mapReady: false,
  listeners: {},
};

// ── INIT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  prefillFirebase();
  loadSavedSessions();
});

function prefillFirebase() {
  const cfg = loadConfig();
  if (cfg && cfg.dbUrl) {
    document.getElementById('fb-url').value = cfg.dbUrl;
    if (cfg.projectId) document.getElementById('fb-pid').value = cfg.projectId;
    showFbStatus('✅ Config loaded', 'var(--g)');
  }
}

// ── FIREBASE SETUP ─────────────────────────────────────
window.saveFirebase = function () {
  const url = document.getElementById('fb-url').value.trim();
  const pid = document.getElementById('fb-pid').value.trim();
  if (!url) { showFbStatus('❌ Database URL is required', 'var(--r)'); return; }
  if (!url.startsWith('https://')) { showFbStatus('❌ URL must start with https://', 'var(--r)'); return; }
  saveConfig(url, pid);
  showFbStatus('✅ Saved!', 'var(--g)');
  showToast('✅', 'Firebase config saved');
};

window.testFirebase = async function () {
  const url = document.getElementById('fb-url').value.trim();
  const pid = document.getElementById('fb-pid').value.trim();
  if (!url) { showFbStatus('❌ Enter the Database URL first', 'var(--r)'); return; }
  saveConfig(url, pid);
  showFbStatus('⏳ Testing connection...', 'var(--dm)');
  const r = await testConnection();
  showFbStatus((r.ok ? '✅ ' : '❌ ') + r.msg, r.ok ? 'var(--g)' : 'var(--r)');
};

function showFbStatus(msg, color) {
  const el = document.getElementById('fb-status');
  el.style.display = 'block';
  el.style.color = color;
  el.textContent = msg;
}

// ── GENERATE CONSENT LINK ──────────────────────────────
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

  try {
    await fbSet(`sessions/${sid}`, { sid, me, rec, dur, pur, status: 'pending', createdAt: Date.now() });
  } catch (e) {
    showToast('❌', 'Firebase error: ' + e.message);
    return;
  }

  // Build URL — embed dbUrl in the link so recipient's phone gets it automatically
  const cfg  = loadConfig();
  const base = getBaseUrl();
  const p    = new URLSearchParams({ sid, dbUrl: cfg.dbUrl });
  const link = `${base}/consent.html?${p.toString()}`;

  S.sessions[sid] = { sid, name: rec, pur, dur };
  saveSessions();

  document.getElementById('link-show').textContent = link;
  document.getElementById('link-result').style.display = 'block';

  renderSessions();
  listenForSession(sid);
  addLog(`📤 Link for <span class="cc">${rec}</span> — ${pur} · <span class="cc">${sid}</span>`);
  showToast('🔗', 'Link ready! Share with ' + rec);
};

function getBaseUrl() {
  // Works on GitHub Pages, localhost, anywhere
  const url = window.location.href;
  // Remove index.html if present, then remove trailing slash
  return url.replace(/\/index\.html.*$/, '').replace(/\/$/, '');
}

// ── LINK ACTIONS ───────────────────────────────────────
window.copyLink = function () {
  const url = document.getElementById('link-show').textContent;
  navigator.clipboard.writeText(url)
    .then(() => showToast('📋', 'Copied!'))
    .catch(() => {
      const t = document.createElement('textarea');
      t.value = url; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
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
    navigator.share({ title: 'LiveTrace — Location Request', text: 'Share your live location with me.', url })
      .catch(() => window.copyLink());
  } else window.copyLink();
};

// ── LISTEN FOR UPDATES ─────────────────────────────────
function listenForSession(sid) {
  if (S.listeners[sid]) return;

  S.listeners[sid + '_st'] = fbListen(`sessions/${sid}/status`, status => {
    if (status === 'granted') {
      addLog(`✅ Consent <span class="gc">GRANTED</span> by <span class="cc">${S.sessions[sid]?.name}</span>`);
      setBadge(sid, 'a');
      showToast('✅', (S.sessions[sid]?.name || 'Recipient') + ' is sharing live!');
      tab('t-map');
    }
    if (status === 'denied') {
      addLog(`❌ Request <span class="rc">DECLINED</span> · ${sid}`);
      setBadge(sid, 'r');
      showToast('🚫', 'Request was declined');
    }
    if (status === 'revoked') onRevoked(sid);
  });

  S.listeners[sid + '_pos'] = fbListen(`positions/${sid}`, pos => {
    if (pos && pos.lat) {
      setBadge(sid, 'a');
      updateMap({ ...pos, sid, name: S.sessions[sid]?.name || 'User' });
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
  ['_st','_pos'].forEach(k => { if (S.listeners[sid+k]) { S.listeners[sid+k](); delete S.listeners[sid+k]; }});
}

window.revokeSession = async function (sid) {
  try { await fbSet(`sessions/${sid}/status`, 'admin-revoke'); } catch {}
  onRevoked(sid);
  addLog(`⛔ You revoked session <span class="rc">${sid}</span>`);
  showToast('⛔', 'Session revoked');
};

// ── MAP ────────────────────────────────────────────────
function initMap() {
  if (S.mapReady) return; S.mapReady = true;
  document.getElementById('map-ph').style.display = 'none';
  const m = L.map('main-map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m);
  S.mainMap = m;
}

function updateMap(msg) {
  initMap();
  document.getElementById('map-ph').style.display = 'none';
  document.getElementById('map-info').style.display = 'grid';
  const ll = [msg.lat, msg.lng];
  if (!S.mainMarkers[msg.sid]) {
    const icon = L.divIcon({ className: '', html: '<div class="lt-pin"></div>', iconSize: [16,16], iconAnchor: [8,8] });
    S.mainMarkers[msg.sid] = L.marker(ll, { icon }).addTo(S.mainMap)
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
  document.getElementById('m-upd').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

// ── SESSION LIST ───────────────────────────────────────
function loadSavedSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem('lt_sessions') || '{}');
    if (Object.keys(saved).length > 0) {
      Object.assign(S.sessions, saved);
      renderSessions();
      document.getElementById('link-result').style.display = 'block';
      Object.keys(S.sessions).forEach(sid => listenForSession(sid));
    }
  } catch {}
}

function saveSessions() {
  localStorage.setItem('lt_sessions', JSON.stringify(S.sessions));
}

function renderSessions() {
  const el = document.getElementById('s-list');
  if (!Object.keys(S.sessions).length) {
    el.innerHTML = '<div style="color:var(--dm);font-size:12px;padding:6px 0">No sessions yet.</div>';
    return;
  }
  el.innerHTML = '';
  Object.values(S.sessions).forEach(s => {
    const d = document.createElement('div');
    d.className = 'srow'; d.id = 'sr-' + s.sid;
    d.innerHTML = `
      <div class="sav">👤</div>
      <div class="si"><div class="sn">${s.name}</div><div class="sm">${s.pur} · ${s.sid}</div></div>
      <span class="sbadge b-p" id="bd-${s.sid}">PENDING</span>
      <button class="btn btn-r" style="padding:6px 10px;font-size:10px" onclick="revokeSession('${s.sid}')">⛔ Revoke</button>`;
    el.appendChild(d);
  });
}

function setBadge(sid, state) {
  const b = document.getElementById('bd-' + sid); if (!b) return;
  const m = { a: ['b-a','ACTIVE'], p: ['b-p','PENDING'], r: ['b-r','REVOKED'] };
  b.className = 'sbadge ' + (m[state]?.[0] || 'b-p');
  b.textContent = m[state]?.[1] || state.toUpperCase();
}

// ── TABS ───────────────────────────────────────────────
window.tab = function (id) {
  ['t-req','t-map','t-log'].forEach(t => document.getElementById(t).style.display = t === id ? 'block' : 'none');
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('on', ['t-req','t-map','t-log'][i] === id));
  if (id === 't-map' && S.mainMap) setTimeout(() => S.mainMap.invalidateSize(), 80);
};

// ── LOG ────────────────────────────────────────────────
function addLog(msg) {
  const el = document.getElementById('audit-log');
  if (el.children.length === 1 && el.children[0].querySelector('.dm')) el.innerHTML = '';
  const d = new Date();
  const ts = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
  const row = document.createElement('div'); row.className = 'lline';
  row.innerHTML = `<span class="lt2">${ts}</span><span class="lm">${msg}</span>`;
  el.insertBefore(row, el.firstChild);
}

// ── TOAST ──────────────────────────────────────────────
let _tt;
function showToast(ico, msg) {
  clearTimeout(_tt);
  document.getElementById('t-ico').textContent = ico;
  document.getElementById('t-msg').textContent = msg;
  const t = document.getElementById('toast'); t.classList.add('on');
  _tt = setTimeout(() => t.classList.remove('on'), 3500);
}
