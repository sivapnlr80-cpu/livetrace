// firebase.js — Firebase Realtime Database via REST API
// Works on GitHub Pages with no build step required.
// Uses open database rules (no auth token needed for read/write).

const CONFIG_KEY = 'livetrace_fb_cfg';

// ── CONFIG ────────────────────────────────────────────
export function saveConfig(dbUrl, projectId) {
  // dbUrl: e.g. https://my-project-default-rtdb.firebaseio.com
  const cfg = { dbUrl: dbUrl.replace(/\/$/, ''), projectId: projectId || '' };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); }
  catch { return null; }
}

export function hasConfig() {
  const c = loadConfig();
  return !!(c && c.dbUrl && c.dbUrl.startsWith('https://'));
}

function getUrl(path) {
  const c = loadConfig();
  if (!c || !c.dbUrl) throw new Error('No Firebase config');
  return `${c.dbUrl}/${path}.json`;
}

// ── CRUD ──────────────────────────────────────────────
export async function fbSet(path, data) {
  const res = await fetch(getUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase ${res.status}: ${body}`);
  }
  return res.json();
}

export async function fbGet(path) {
  const res = await fetch(getUrl(path));
  if (!res.ok) throw new Error(`Firebase read ${res.status}`);
  return res.json();
}

// ── REALTIME LISTENER (Server-Sent Events) ────────────
export function fbListen(path, callback) {
  let es;
  let stopped = false;

  function connect() {
    if (stopped) return;
    try {
      const c = loadConfig();
      if (!c || !c.dbUrl) return;
      es = new EventSource(`${c.dbUrl}/${path}.json`);
      es.addEventListener('put', e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.data !== null && msg.data !== undefined) callback(msg.data);
        } catch {}
      });
      es.onerror = () => {
        es.close();
        if (!stopped) setTimeout(connect, 3000); // reconnect
      };
    } catch {}
  }

  connect();
  return () => { stopped = true; if (es) es.close(); };
}

// ── TEST ──────────────────────────────────────────────
export async function testConnection() {
  const c = loadConfig();
  if (!c || !c.dbUrl) return { ok: false, msg: 'No config saved yet.' };
  try {
    const res = await fetch(`${c.dbUrl}/.json?shallow=true`);
    if (res.ok) return { ok: true, msg: 'Connected to Firebase ✅' };
    if (res.status === 401 || res.status === 403)
      return { ok: false, msg: 'Permission denied — set Realtime DB rules to allow read/write (test mode).' };
    return { ok: false, msg: `HTTP ${res.status} — check your Database URL.` };
  } catch (e) {
    return { ok: false, msg: 'Network error: ' + e.message };
  }
}
