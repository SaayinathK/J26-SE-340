// frontend/src/features/lead-intel/hooks/useLeadApi.js — load one Lead Intelligence endpoint for the signed-in user
// useLeadApi(session, 'dashboard')            -> GET /api/leads/dashboard
// useLeadApi(session, 'leadHistory', leadId)  -> GET /api/leads/{leadId}/history (reloads when leadId changes)
import { useLoad } from '../../../hooks/useLoad.js';
import { api } from '../api.js';

export function useLeadApi(session, name, ...args) {
  return useLoad(() => api[name](session, ...args), [session.token, ...args]);
}
