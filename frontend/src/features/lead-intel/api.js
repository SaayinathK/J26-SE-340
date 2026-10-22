// frontend/src/features/lead-intel/api.js — Lead Intelligence (C3) calls, through the gateway at /api/leads
import { call } from '../../lib/api-client.js';

export const api = {
  dashboard: (s) => call(s, '/leads/dashboard'),
  analytics: (s) => call(s, '/leads/analytics'),
  monitoring: (s) => call(s, '/leads/monitoring'),
  score: (s, lead) => call(s, '/leads/score', { method: 'POST', body: lead }),
  recommendation: (s, id) => call(s, `/leads/${encodeURIComponent(id)}/recommendation`, { timeout: 330000 }),
  outcome: (s, id, outcome) => call(s, `/leads/${encodeURIComponent(id)}/outcome`, { method: 'POST', body: { outcome } }),
  history: (s) => call(s, '/leads/history'),
  leadHistory: (s, id) => call(s, `/leads/${encodeURIComponent(id)}/history`),
};
