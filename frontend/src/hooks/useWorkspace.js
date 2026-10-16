import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client.js';
const empty = { campaigns: [], documents: [], sequences: [], activities: [], synced_at: null };
export function useWorkspace(tenantId, role) {
  const [state, setState] = useState({ tenantId, role, data: empty, loading: true, error: '' });
  const mounted = useRef(false);
  const activeRequest = useRef(0);
  const busyRequest = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (busyRequest.current && !force) return;
    const request = ++activeRequest.current;
    busyRequest.current = request;
    try {
      const data = await api('/platform/snapshot');
      if (mounted.current && request === activeRequest.current) setState({ tenantId, role, data, loading: false, error: '' });
    } catch (error) {
      if (mounted.current && request === activeRequest.current) setState(previous => ({ ...previous, tenantId, role, loading: false, error: error.message }));
    } finally { if (busyRequest.current === request) busyRequest.current = 0; }
  }, [tenantId, role]);
  useEffect(() => {
    mounted.current = true;
    setState({ tenantId, role, data: empty, loading: true, error: '' });
    void refresh();
    const poll = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = setInterval(poll, 5000);
    window.addEventListener('focus', poll);
    return () => { mounted.current = false; ++activeRequest.current; busyRequest.current = 0; clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [refresh, tenantId]);
  const mutate = useCallback(async (path, method, body, options = {}) => {
    const result = await api(path, { method, body, ...options });
    await refresh(true);
    return result;
  }, [refresh]);
  return { ...(state.tenantId === tenantId && state.role === role ? state : { data: empty, loading: true, error: '' }), refresh, mutate };
}
