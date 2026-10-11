import { useCallback, useEffect, useState } from 'react';
import { request as api } from '../api.js';
export function useServiceStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setStatus(await api('/status')); setError(''); }
    catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => {
    let active = true;
    const update = async () => {
      try { const next = await api('/status'); if (active) { setStatus(next); setError(''); } }
      catch (failure) { if (active) setError(failure.message); }
    };
    void update();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void update(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return { status, error, refresh };
}
