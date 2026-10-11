import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, authConfig } from '../lib/api-client.js';

const AuthContext = createContext(null);
const empty = { user: null, workspace: null, permissions: [] };

export function AuthProvider({ children }) {
  const [session, setSession] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const channel = useRef(null);
  const refresh = useCallback(async () => {
    try { const result = await api('/auth/me'); setSession(result); setError(''); return result; }
    catch (failure) {
      if (failure.status === 401) { setSession(empty); setError(''); }
      else setError(failure.message);
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    authConfig().then(() => { if (active) return refresh(); }).catch(failure => {
      if (active) { setLoading(false); setError(failure.message || 'Account service is unavailable. Run npm run dev in frontend and try again.'); }
    });
    const expired = () => { setSession(empty); setError('Your session has expired. Please sign in again.'); };
    window.addEventListener('ciftron-session-expired', expired);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('email-agent-auth');
      channel.current.onmessage = () => refresh();
    }
    return () => { active = false; window.removeEventListener('ciftron-session-expired', expired); channel.current?.close(); };
  }, [refresh]);
  useEffect(() => {
    if (!session.user) return;
    const poll = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(poll, 30000);
    window.addEventListener('focus', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [session.user?.user_id, refresh]);

  async function establish(path, body) {
    const result = await api(path, { method: 'POST', body });
    // The browser never persists the bearer token returned for existing API clients.
    setSession({ user: result.user, workspace: result.workspace, permissions: result.permissions });
    setError(''); channel.current?.postMessage('changed');
    return result;
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: {} }); }
    catch (failure) { if (failure.status !== 401) throw failure; }
    window.google?.accounts?.id?.disableAutoSelect();
    setSession(empty); setError(''); channel.current?.postMessage('changed');
  }
  return <AuthContext.Provider value={{ ...session, loading, error, refresh, logout,
    login: body => establish('/auth/login', body), register: body => establish('/auth/register', body),
    googleLogin: body => establish('/auth/google', body), can: permission => session.permissions.includes(permission),
  }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
