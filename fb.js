// fb.js — Tiny Firebase Realtime Database REST helper
// No SDK. Works with test mode rules (open read/write).
// All functions take dbUrl explicitly — no hidden global state.

export async function fbGet(dbUrl, path) {
  const r = await fetch(`${dbUrl}/${path}.json`);
  const t = await r.text();
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${t.slice(0,100)}`);
  if (t === 'null' || t === '') return null;
  return JSON.parse(t);
}

export async function fbSet(dbUrl, path, value) {
  const r = await fetch(`${dbUrl}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SET ${path} → ${r.status}: ${t.slice(0,100)}`);
  return JSON.parse(t);
}

export async function fbDelete(dbUrl, path) {
  await fetch(`${dbUrl}/${path}.json`, { method: 'DELETE' });
}

// Poll a path every `ms` ms, call cb when value changes.
// Returns a stop() function.
export function fbPoll(dbUrl, path, cb, ms = 3000) {
  let prev = '\x00'; // unique sentinel
  let stopped = false;
  let tid = null;

  async function run() {
    if (stopped) return;
    try {
      const val  = await fbGet(dbUrl, path);
      const json = JSON.stringify(val);
      if (json !== prev) { prev = json; cb(val); }
    } catch (_) { /* silent retry */ }
    if (!stopped) tid = setTimeout(run, ms);
  }

  run();
  return () => { stopped = true; clearTimeout(tid); };
}

// Validate a Firebase Realtime DB URL and test connectivity
export async function fbTest(url) {
  if (!url) return 'Enter your database URL first.';
  if (!url.startsWith('https://')) return 'URL must start with https://';
  if (!url.includes('firebase')) return 'Does not look like a Firebase URL.';
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/.json?shallow=true`);
    if (r.ok) return null; // null = no error
    if (r.status === 401 || r.status === 403)
      return 'Permission denied. Open Firebase Console → Realtime Database → Rules and set both read/write to true.';
    return `HTTP ${r.status}. Check your database URL.`;
  } catch {
    return 'Network error. Check your internet connection.';
  }
}
