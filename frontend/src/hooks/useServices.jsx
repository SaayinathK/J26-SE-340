import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client.js';
const ServicesContext = createContext(null);
export function ServicesProvider({ children }) {
  const [state, setState] = useState({ services: [], loading: true, error: '', checked_at: null });
  const active = useRef(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try { const result = await api('/services'); if (active.current) setState({ ...result, loading: false, error: '' }); }
    catch (failure) { if (active.current) setState(previous => ({ ...previous, loading: false, error: failure.message })); }
    finally { pending.current = false; }
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    const update = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => { active.current = false; clearInterval(interval); window.removeEventListener('focus', update); };
  }, [refresh]);
  return <ServicesContext.Provider value={{ ...state, refresh }}>{children}</ServicesContext.Provider>;
}
export const useServices = () => useContext(ServicesContext);
