// firebase.js — Firebase Realtime Database REST helper
// No SDK needed. Works with Firebase test mode (open read/write rules).

export function saveDbUrl(url) {
  localStorage.setItem('lt_dburl', url.trim().replace(/\/$/, ''));
}
export function getDbUrl() {
  return localStorage.getItem('lt_dburl') || '';
}
export function hasDbUrl() {
  const u = getDbUrl();
  return u.startsWith('https://') && u.includes('firebaseio.com');
}

// ── RAW REST ──────────────────────────────────────────
async function rest(dbUrl, path, method, body) {
  const res = await fetch(`${dbUrl}/${path}.json`, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${text.slice(0, 200)}`);
  if (text === '' || text === 'null') return null;
  return JSON.parse(text);
}

export const dbGet = (dbUrl, path)       => rest(dbUrl, path, 'GET');
export const dbSet = (dbUrl, path, data) => rest(dbUrl, path, 'PUT', data);

// ── POLLING LISTENER ──────────────────────────────────
// Polls every `ms` milliseconds. Calls callback only when data changes.
// Returns a stop() function.
export function dbWatch(dbUrl, path, callback, ms = 2500) {
  let lastJson = '\x00'; // sentinel that never matches real JSON
  let stopped  = false;
  let timer    = null;

  async function tick() {
    if (stopped) return;
    try {
      const data = await dbGet(dbUrl, path);
      const json = JSON.stringify(data);
      if (json !== lastJson) {
        lastJson = json;
        callback(data);
      }
    } catch(e) {
      // network blip — retry silently
    }
    if (!stopped) timer = setTimeout(tick, ms);
  }

  tick(); // fire immediately
  return function stop() { stopped = true; clearTimeout(timer); };
}

// ── TEST ──────────────────────────────────────────────
export async function testDb(dbUrl) {
  if (!dbUrl || !dbUrl.startsWith('https://'))
    return { ok: false, msg: 'URL must start with https://' };
  try {
    const res = await fetch(`${dbUrl}/.json?shallow=true`);
    if (res.ok) return { ok: true, msg: 'Connected ✅' };
    if (res.status === 401 || res.status === 403)
      return { ok: false, msg: 'Permission denied — set Realtime DB to test mode' };
    return { ok: false, msg: `HTTP ${res.status}` };
  } catch(e) {
    return { ok: false, msg: 'Network error: ' + e.message };
  }
}
