import { readCampaignStream } from './campaignStream';
// Relative URLs use Vite's same-origin proxy in development.
const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const TOKEN_KEY = 'ciftron_token';
async function request(path, { method = 'GET', body, auth = true, signal } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  let response;
  try {
    response = await fetch(`${BASE}${path}`, { method, signal, headers: {
      Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the API. Check that the backend is running on port 5001.');
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && auth && localStorage.getItem(TOKEN_KEY) === token) window.dispatchEvent(new Event('ciftron:unauthorized'));
  if (!response.ok || data?.success === false || !data) {
    const missing = data?.missing || data?.missing_fields;
    const message = missing?.length ? `Complete your setup before generating: ${missing.map(x => x.replaceAll('_', ' ')).join(', ')}. Save your business details in Business settings, or complete your knowledge base with business facts and a brand voice. No prompt is required.` : data?.error || data?.message || `Request failed (${response.status}). Please try again.`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}
async function generateCampaign(content_type, brief, onEvent, signal) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BASE}/content/generate`, {
    method:'POST', signal,
    headers:{Accept:'application/x-ndjson', 'Content-Type':'application/json', Authorization:`Bearer ${token}`},
    body:JSON.stringify({content_type,brief}),
  });
  if (!response.ok) {
    const data = await response.json().catch(()=>({}));
    if (response.status === 401 && localStorage.getItem(TOKEN_KEY) === token) window.dispatchEvent(new Event('ciftron:unauthorized'));
    throw new Error(data.missing?.length ? `Complete your business setup: ${data.missing.join(', ')}. Save your details in Business settings first.` : data.error || data.message || `Request failed (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    throw new Error('The backend does not support campaign progress yet. Restart it to load the latest version.');
  }
  return readCampaignStream(response,onEvent);
}
export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (name, email, password) => request('/api/auth/register', { method: 'POST', body: { name, email, password }, auth: false }),
  me: () => request('/api/auth/me'),
  getSettings: () => request('/settings'),
  saveSettings: body => request('/settings', { method: 'POST', body }),
  getKnowledge: () => request('/knowledge'),
  addKnowledge: (type, text) => request('/knowledge', { method: 'POST', body: { type, text } }),
  deleteKnowledge: id => request(`/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  generate: (content_type, brief, onEvent, signal) => content_type === 'meta_ad' && onEvent
    ? generateCampaign(content_type, brief, onEvent, signal)
    : request('/content/generate', { method: 'POST', body: { content_type, brief }, signal }),
  feedback: (generation_id, feedback) => request('/content/feedback', { method: 'POST', body: { generation_id, feedback } }),
  history: () => request('/content/history'),
  buildContext: (content_type, brief) => request('/context/build', { method: 'POST', body: { content_type, brief } }),
};
