// src/api.js — every call goes through the C4 gateway (/api). The tenant comes from the JWT, never from the UI.
const KEY = 'c3_session';

export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
}

export function saveSession(s) {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}

function decodeToken(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
  } catch { return {}; }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function login(email, password) {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new ApiError(r.status, r.status === 401 ? 'Wrong email or password' : 'Sign in failed');
  const { access_token } = await r.json();
  const claims = decodeToken(access_token);
  return { token: access_token, email, role: claims.role || 'viewer', exp: claims.exp };
}

async function call(session, path, { method = 'GET', body, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch('/api/leads' + path, {
      method, signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!r.ok) {
      const msg = data?.detail || data?.error || `Request failed (${r.status})`;
      throw new ApiError(r.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError(504, 'The request took too long. Try again.');
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'Cannot reach the gateway. Is Docker running?');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  dashboard: (s) => call(s, '/dashboard'),
  analytics: (s) => call(s, '/analytics'),
  monitoring: (s) => call(s, '/monitoring'),
  score: (s, lead) => call(s, '/score', { method: 'POST', body: lead }),
  recommendation: (s, id) => call(s, `/${encodeURIComponent(id)}/recommendation`, { timeout: 330000 }),
  outcome: (s, id, outcome) => call(s, `/${encodeURIComponent(id)}/outcome`, { method: 'POST', body: { outcome } }),
};

export const canWrite = (session) => ['agency_admin', 'marketer'].includes(session?.role);
