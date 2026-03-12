// app.js — Sender dashboard
import { saveDbUrl, getDbUrl, hasDbUrl, dbSet, dbWatch, testDb } from './firebase.js';

const S = {
  sessions: {},   // sid -> { sid, name, pur, dur }
  stoppers: {},   // sid -> [stopFn, stopFn]
  map:      null,
  markers:  {},
  mapReady: false,
};

// ── INIT ──────────────────────────────────────────────
addEventListener('DOMContentLoaded', () => {
  const saved = getDbUrl();
  if (saved) { id('fb-url').value = saved; setFbStatus('✅ Config loaded', 'var(--g)'); }
  loadSessions();
});

// ── FIREBASE SETUP ─────────────────────────────────────
window.saveFirebase = () => {
  const url = id('fb-url').value.trim();
  if (!url.startsWith('https://')) { setFbStatus('❌ Must start with https://', 'var(--r)'); return; }
  saveDbUrl(url);
  setFbStatus('✅ Saved!', 'var(--g)');
  toast('✅', 'Firebase URL saved');
};

window.testFirebase = async () => {
  const url = id('fb-url').value.trim();
  if (url) saveDbUrl(url);
  setFbStatus('⏳ Testing…', 'var(--dm)');
  const r = await testDb(url || getDbUrl());
  setFbStatus((r.ok ? '✅ ' : '❌ ') + r.msg, r.ok ? 'var(--g)' : 'var(--r)');
};

function setFbStatus(msg, color) {
  const el = id('fb-status');
  el.style.display = 'block'; el.style.color = color; el.textContent = msg;
}

// ── GENERATE LINK ──────────────────────────────────────
window.generate = async () => {
  const dbUrl = getDbUrl();
  if (!hasDbUrl()) {
    toast('⚠️', 'Save your Firebase URL first');
    id('firebase-setup-card').scrollIntoView({ behavior: 'smooth' }); return;
  }
  const me  = id('i-me').value.trim();
  const rec = id('i-rec').value.trim();
  if (!me)  { toast('⚠️', 'Enter your name'); return; }
  if (!rec) { toast('⚠️', 'Enter recipient name'); return; }

  const sid = 'LT' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,4).toUpperCase();
  const dur = id('i-dur').value;
  const pur = id('i-pur').value;

  try {
    await dbSet(dbUrl, `sessions/${sid}`, { sid, me, rec, dur, pur, status: 'pending', ts: Date.now() });
  } catch(e) { toast('❌', 'Firebase error: ' + e.message); return; }

  // Embed dbUrl in the link — recipient's phone reads it from URL, no setup needed
  const base = getBase();
  const link = `${base}/consent.html?sid=${sid}&dbUrl=${encodeURIComponent(dbUrl)}`;

  id('link-show').textContent = link;
  id('link-result').style.display = 'block';

  S.sessions[sid] = { sid, name: rec, pur, dur, status: 'pending' };
  saveSessions();
  renderSessions();
  startWatching(sid);
  addLog(`📤 Link for <span class="cc">${rec}</span> — ${pur} · <span class="cc">${sid}</span>`);
  toast('🔗', 'Link ready — share with ' + rec);
};

function getBase() {
  return location.href.split('?')[0].replace(/\/index\.html$/, '').replace(/\/$/, '');
}

// ── COPY / SHARE ───────────────────────────────────────
window.copyLink = () => {
  const url = id('link-show').textContent;
  navigator.clipboard.writeText(url)
    .then(() => toast('📋', 'Copied!'))
    .catch(() => { // fallback
      const t = document.createElement('textarea');
      t.value = url; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      document.execCommand('copy'); document.body.removeChild(t);
      toast('📋', 'Copied!');
    });
};
window.openLink  = () => window.open(id('link-show').textContent, '_blank');
window.shareLink = () => {
  const url = id('link-show').textContent;
  if (navigator.share) navigator.share({ title:'LiveTrace', url }).catch(() => window.copyLink());
  else window.copyLink();
};

// ── WATCH SESSION ──────────────────────────────────────
// Poll TWO paths: sessions/${sid} (for status) and positions/${sid} (for GPS)
function startWatching(sid) {
  if (S.stoppers[sid]) return;
  const dbUrl = getDbUrl();

  // Watch the whole session object — catches status changes
  const stopSession = dbWatch(dbUrl, `sessions/${sid}`, session => {
    if (!session) return;
    const status = session.status;

    if (status === 'granted') {
      setBadge(sid, 'a');
      addLog(`✅ <span class="gc">GRANTED</span> by <span class="cc">${S.sessions[sid]?.name}</span>`);
      toast('✅', (S.sessions[sid]?.name || 'Recipient') + ' is sharing live!');
      switchTab('t-map');
    }
    if (status === 'denied') {
      setBadge(sid, 'r');
      addLog(`❌ <span class="rc">DECLINED</span> · ${sid}`);
      toast('🚫', 'Location request declined');
    }
    if (status === 'revoked') {
      handleRevoked(sid);
    }
    // Update local session cache
    if (S.sessions[sid]) S.sessions[sid].status = status;
    renderSessionRow(sid);
  }, 2500);

  // Watch positions separately — GPS updates come here
  const stopPos = dbWatch(dbUrl, `positions/${sid}`, pos => {
    if (!pos || pos.cleared || !pos.lat) return;
    setBadge(sid, 'a');
    updateMap(sid, pos);
    updatePosText(sid, pos);
  }, 2500);

  S.stoppers[sid] = [stopSession, stopPos];
}

function handleRevoked(sid) {
  // Stop pollers
  if (S.stoppers[sid]) { S.stoppers[sid].forEach(f => f()); delete S.stoppers[sid]; }
  // Remove map marker
  if (S.map && S.markers[sid]) { S.map.removeLayer(S.markers[sid]); delete S.markers[sid]; }
  setBadge(sid, 'r');
  if (S.sessions[sid]) S.sessions[sid].status = 'revoked';
  renderSessionRow(sid);
  saveSessions();
  const cnt = Object.keys(S.markers).length;
  id('map-count').textContent = cnt + ' tracking';
  if (!cnt) id('map-ph').style.display = 'flex';
  addLog(`⛔ Sharing stopped · <span class="rc">${sid}</span>`);
  toast('⛔', 'Recipient stopped sharing');
}

// ── REVOKE FROM DASHBOARD ──────────────────────────────
window.revokeSession = async (sid) => {
  const dbUrl = getDbUrl();
  try { await dbSet(dbUrl, `sessions/${sid}/status`, 'admin-revoke'); } catch {}
  handleRevoked(sid);
  addLog(`⛔ You revoked <span class="rc">${sid}</span>`);
  toast('⛔', 'Session revoked');
};

// ── DELETE SESSION FROM LIST ───────────────────────────
window.deleteSession = (sid) => {
  if (S.stoppers[sid]) { S.stoppers[sid].forEach(f => f()); delete S.stoppers[sid]; }
  if (S.map && S.markers[sid]) { S.map.removeLayer(S.markers[sid]); delete S.markers[sid]; }
  delete S.sessions[sid];
  saveSessions();
  renderSessions();
  id('map-count').textContent = Object.keys(S.markers).length + ' tracking';
  toast('🗑️', 'Session removed');
};

// ── MAP ────────────────────────────────────────────────
function initMap() {
  if (S.mapReady) return; S.mapReady = true;
  id('map-ph').style.display = 'none';
  const m = L.map('main-map').setView([20, 78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m);
  S.map = m;
}

function updateMap(sid, pos) {
  initMap();
  id('map-ph').style.display = 'none';
  id('map-info').style.display = 'grid';
  const ll   = [pos.lat, pos.lng];
  const name = S.sessions[sid]?.name || 'User';

  if (!S.markers[sid]) {
    const icon = L.divIcon({ className:'', html:'<div class="lt-pin"></div>', iconSize:[16,16], iconAnchor:[8,8] });
    S.markers[sid] = L.marker(ll, { icon }).addTo(S.map).bindPopup(`<b>${name}</b><br>±${pos.acc}m`);
  } else {
    S.markers[sid].setLatLng(ll);
    S.markers[sid].setPopupContent(`<b>${name}</b><br>${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}<br>±${pos.acc}m`);
  }
  S.map.panTo(ll);
  id('map-count').textContent = Object.keys(S.markers).length + ' tracking';
  id('m-lat').textContent = pos.lat.toFixed(6) + '°';
  id('m-lng').textContent = pos.lng.toFixed(6) + '°';
  id('m-acc').textContent = '±' + pos.acc + 'm';
  const d = new Date(pos.ts || Date.now());
  id('m-upd').textContent = String(d.getHours()).padStart(2,'0') + ':'
    + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

function updatePosText(sid, pos) {
  const el = id('pos-' + sid);
  if (el) el.textContent = `📍 ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
}

// ── SESSION LIST ───────────────────────────────────────
function loadSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem('lt_sessions') || '{}');
    if (Object.keys(saved).length) {
      Object.assign(S.sessions, saved);
      id('link-result').style.display = 'block';
      renderSessions();
      Object.keys(S.sessions).forEach(startWatching);
    }
  } catch {}
}

function saveSessions() {
  localStorage.setItem('lt_sessions', JSON.stringify(S.sessions));
}

function renderSessions() {
  const el = id('s-list');
  if (!Object.keys(S.sessions).length) {
    el.innerHTML = '<div style="color:var(--dm);font-size:12px;padding:8px 0">No sessions yet.</div>'; return;
  }
  el.innerHTML = '';
  Object.values(S.sessions).forEach(s => {
    const row = document.createElement('div');
    row.className = 'srow'; row.id = 'sr-' + s.sid;
    row.innerHTML = buildSessionRow(s);
    el.appendChild(row);
  });
}

function renderSessionRow(sid) {
  const el = id('sr-' + sid);
  const s  = S.sessions[sid];
  if (!el || !s) return;
  el.innerHTML = buildSessionRow(s);
}

function buildSessionRow(s) {
  const isActive  = s.status === 'granted';
  const isRevoked = ['revoked','admin-revoke','denied'].includes(s.status);

  // Revoke button only when active/pending; delete always available
  const revokeBtn = !isRevoked
    ? `<button class="btn btn-r" style="padding:6px 10px;font-size:10px" onclick="revokeSession('${s.sid}')">⛔ Revoke</button>`
    : '';
  const deleteBtn = `<button class="btn btn-ghost" style="padding:6px 10px;font-size:10px" onclick="deleteSession('${s.sid}')" title="Remove from list">🗑️ Delete</button>`;

  return `
    <div class="sav">👤</div>
    <div class="si">
      <div class="sn">${s.name}</div>
      <div class="sm" id="pos-${s.sid}">${s.pur} · ${s.sid}</div>
    </div>
    <span class="sbadge ${badgeClass(s.status)}" id="bd-${s.sid}">${badgeLabel(s.status)}</span>
    <div style="display:flex;gap:6px;flex-shrink:0">${revokeBtn}${deleteBtn}</div>`;
}

function badgeClass(status) {
  if (status === 'granted') return 'b-a';
  if (['revoked','admin-revoke','denied'].includes(status)) return 'b-r';
  return 'b-p';
}
function badgeLabel(status) {
  const m = { granted:'ACTIVE', revoked:'REVOKED', denied:'DECLINED', 'admin-revoke':'REVOKED', pending:'PENDING' };
  return m[status] || 'PENDING';
}

function setBadge(sid, state) {
  // 'a'=active, 'r'=revoked, 'p'=pending
  const el = id('bd-' + sid); if (!el) return;
  const map = { a:['b-a','ACTIVE'], r:['b-r','REVOKED'], p:['b-p','PENDING'] };
  el.className = 'sbadge ' + (map[state]?.[0] || 'b-p');
  el.textContent = map[state]?.[1] || 'PENDING';
}

// ── TABS ───────────────────────────────────────────────
function switchTab(tabId) {
  ['t-req','t-map','t-log'].forEach(t =>
    id(t).style.display = t === tabId ? 'block' : 'none');
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('on', ['t-req','t-map','t-log'][i] === tabId));
  if (tabId === 't-map' && S.map) setTimeout(() => S.map.invalidateSize(), 80);
}
window.tab = switchTab;

// ── LOG ────────────────────────────────────────────────
function addLog(msg) {
  const el = id('audit-log');
  if (el.children.length === 1 && el.children[0].querySelector('.dm')) el.innerHTML = '';
  const now = new Date();
  const ts  = String(now.getHours()).padStart(2,'0') + ':'
            + String(now.getMinutes()).padStart(2,'0') + ':'
            + String(now.getSeconds()).padStart(2,'0');
  const row = document.createElement('div'); row.className = 'lline';
  row.innerHTML = `<span class="lt2">${ts}</span><span class="lm">${msg}</span>`;
  el.insertBefore(row, el.firstChild);
}

// ── TOAST ──────────────────────────────────────────────
let _tt;
function toast(ico, msg) {
  clearTimeout(_tt);
  id('t-ico').textContent = ico; id('t-msg').textContent = msg;
  const t = id('toast'); t.classList.add('on');
  _tt = setTimeout(() => t.classList.remove('on'), 3500);
}

function id(x) { return document.getElementById(x); }
