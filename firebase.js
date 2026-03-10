// firebase.js — Firebase Realtime Database helper
// Uses the REST API (no SDK needed, works with ES modules on GitHub Pages)

const CONFIG_KEY = 'livetrace_firebase_config';

export function saveConfig(url, apiKey, projectId) {
  const cfg = { url: url.replace(/\/$/, ''), apiKey, projectId };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY));
  } catch {
    return null;
  }
}

export function hasConfig() {
  const cfg = loadConfig();
  return !!(cfg && cfg.url && cfg.apiKey);
}

// Write to Firebase REST API
export async function fbSet(path, data) {
  const cfg = loadConfig();
  if (!cfg) throw new Error('No Firebase config');
  const res = await fetch(`${cfg.url}/${path}.json?auth=${cfg.apiKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Firebase write failed: ${res.status}`);
  return res.json();
}

// Read once from Firebase
export async function fbGet(path) {
  const cfg = loadConfig();
  if (!cfg) throw new Error('No Firebase config');
  const res = await fetch(`${cfg.url}/${path}.json?auth=${cfg.apiKey}`);
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  return res.json();
}

// Delete from Firebase
export async function fbDelete(path) {
  const cfg = loadConfig();
  if (!cfg) return;
  await fetch(`${cfg.url}/${path}.json?auth=${cfg.apiKey}`, { method: 'DELETE' });
}

// Subscribe to changes via SSE (Firebase streaming)
export function fbListen(path, callback) {
  const cfg = loadConfig();
  if (!cfg) return () => {};

  const url = `${cfg.url}/${path}.json?auth=${cfg.apiKey}`;
  const es = new EventSource(url);

  es.addEventListener('put', e => {
    try {
      const { data } = JSON.parse(e.data);
      if (data !== null) callback(data);
    } catch {}
  });

  es.addEventListener('patch', e => {
    try {
      const { data } = JSON.parse(e.data);
      if (data !== null) callback(data);
    } catch {}
  });

  es.onerror = () => {
    // Auto-reconnects
  };

  // Return unsubscribe function
  return () => es.close();
}

// Test connection
export async function testConnection() {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, msg: 'No config saved' };
  try {
    const res = await fetch(`${cfg.url}/.json?shallow=true&auth=${cfg.apiKey}`);
    if (res.status === 200 || res.status === 204) return { ok: true, msg: 'Connected!' };
    if (res.status === 401) return { ok: false, msg: 'Auth failed — check your API key' };
    if (res.status === 404) return { ok: false, msg: 'Database not found — check your URL' };
    return { ok: false, msg: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, msg: 'Network error: ' + e.message };
  }
}
