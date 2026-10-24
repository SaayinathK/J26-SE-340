// frontend/src/hooks/useLoad.js — shared hook: load data from the gateway, with loading / error state and reload()
import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad(fn, deps) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(() => {
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive.current && set({ data, error: null, loading: false }),
      (error) => alive.current && set({ data: null, error, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
