import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../api.js';

export function useEmailIntelligence(workspaceId) {
  const [state, setState] = useState({ learning: null, insights: { outcomes: [], reviews: [] }, integrations: { preferences: [] }, loading: true, error: '' });
  const active = useRef(false);
  const serial = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++serial.current;
    try {
      const [learning, insights, integrations] = await Promise.all([request('/learning'), request('/insights'), request('/integrations')]);
      if (active.current && current === serial.current) setState({ learning, insights, integrations, loading: false, error: '' });
    } catch (error) {
      if (active.current && current === serial.current) setState(previous => ({ ...previous, loading: false, error: error.message }));
    }
  }, [workspaceId]);
  useEffect(() => {
    active.current = true;
    setState({ learning: null, insights: { outcomes: [], reviews: [] }, integrations: { preferences: [] }, loading: true, error: '' });
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { active.current = false; ++serial.current; clearInterval(timer); };
  }, [refresh]);
  return { ...state, refresh };
}
