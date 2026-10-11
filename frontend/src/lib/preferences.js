export function storageRead(key, fallback) {
  try { const stored = localStorage.getItem(key); return stored === null ? fallback : JSON.parse(stored); }
  catch { return fallback; }
}
export function storageWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
