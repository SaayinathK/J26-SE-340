// frontend/src/lib/api-client.js — every call goes through the C4 gateway (/api) only, never to an agent directly.
// The tenant comes from the JWT, never from the UI. Each feature builds its own calls on call().
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

// FastAPI validation errors -> one plain sentence ("pages_per_visit: must be 0 or more")
function readable(detail) {
  if (!Array.isArray(detail)) return JSON.stringify(detail);
  return detail.map((d) => {
    const field = (d.loc || []).filter((x) => x !== 'body').join('.');
    const text = String(d.msg || '').replace(/^Value error, /, '');
    return field ? `${field.replace(/_/g, ' ')}: ${text}` : text;
  }).join(' · ');
}

// Never show raw HTML to the user: a short sentence for each kind of failure
function plainStatus(status) {
  if (status === 502 || status === 503) return 'The Lead Intelligence service is not reachable right now (it may still be starting). Wait a minute and try again.';
  if (status === 504) return 'The service took too long to answer. Try again.';
  if (status === 429) return 'Too many tries. Wait a few minutes and try again.';
  if (status >= 500) return 'Something went wrong on the server. Try again.';
  return `Request failed (${status})`;
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function login(email, password) {
  let r;
  try {
    r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the app server. Is Docker running?');
  }
  if (!r.ok) throw new ApiError(r.status, r.status === 401 ? 'Wrong email or password' : r.status === 400 ? 'Sign in failed' : plainStatus(r.status));
  const { access_token } = await r.json();
  const claims = decodeToken(access_token);
  return { token: access_token, email, role: claims.role || 'viewer', exp: claims.exp };
}

export async function call(session, path, { method = 'GET', body, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch('/api' + path, {
      method, signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }   // e.g. an nginx HTML error page
    if (!r.ok) {
      const msg = data?.detail || data?.error || plainStatus(r.status);
      throw new ApiError(r.status, typeof msg === 'string' ? msg : readable(msg));
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


export const canWrite = (session) => ['agency_admin', 'marketer'].includes(session?.role);
