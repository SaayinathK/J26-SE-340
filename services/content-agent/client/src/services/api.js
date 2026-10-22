import { readCampaignStream } from "./campaignStream";
// Relative URLs use Vite's same-origin proxy in development.
const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const TOKEN_KEY = "ciftron_token";
async function request(
  path,
  { method = "GET", body, auth = true, signal } = {}
) {
  const token = localStorage.getItem(TOKEN_KEY);
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Cannot reach the API. Check that the backend is running on port 5001."
    );
  }
  const data = await response.json().catch(() => null);
  if (
    response.status === 401 &&
    auth &&
    localStorage.getItem(TOKEN_KEY) === token
  )
    window.dispatchEvent(new Event("adbloom:unauthorized"));
  if (!response.ok || data?.success === false || !data) {
    const missing = data?.missing || data?.missing_fields;
    const message = missing?.length
      ? `Complete your setup before generating: ${missing
          .map((x) => x.replaceAll("_", " "))
          .join(
            ", "
          )}. Save your business details in Business settings, or complete your knowledge base with business facts and a brand voice. No prompt is required.`
      : data?.error ||
        data?.message ||
        `Request failed (${response.status}). Please try again.`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}
async function generateCampaign(
  content_type,
  brief,
  onEvent,
  signal,
  options = {}
) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BASE}/content/generate`, {
    method: "POST",
    signal,
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content_type, brief, ...options }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && localStorage.getItem(TOKEN_KEY) === token)
      window.dispatchEvent(new Event("adbloom:unauthorized"));
    throw new Error(
      data.missing?.length
        ? `Complete your business setup: ${data.missing.join(
            ", "
          )}. Save your details in Business settings first.`
        : data.error || data.message || `Request failed (${response.status}).`
    );
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    throw new Error(
      "The backend does not support campaign progress yet. Restart it to load the latest version."
    );
  }
  return readCampaignStream(response, onEvent);
}
export const api = {
  crmLeads: params => request('/crm/leads?'+new URLSearchParams(params)),
  crm: () => request('/crm'),
  connectCRM: body => request('/crm/connect',{method:'POST',body}),
  syncCRM: () => request('/crm/sync',{method:'POST',body:{}}),
  disconnectCRM: () => request('/crm/disconnect',{method:'POST',body:{}}),
  mapCRM: (id,body) => request(`/crm/campaigns/${encodeURIComponent(id)}`,{method:'PUT',body}),
  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    }),
  register: (name, email, password) =>
    request("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
      auth: false,
    }),
  me: () => request("/api/auth/me"),
  research: id => request(`/research/${encodeURIComponent(id)}`),
  addEvidence: (id,body) => request(`/research/${encodeURIComponent(id)}/evidence`,{method:'POST',body}),
  importCRM: (id,records,confirm_source) => request(`/research/${encodeURIComponent(id)}/import-crm`,{method:'POST',body:{records,confirm_source}}),
  reviewPersona: (id,body) => request(`/research/${encodeURIComponent(id)}/review`,{method:'POST',body}),
  withdrawEvidence: (id,evidence) => request(`/research/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidence)}/withdraw`,{method:'POST',body:{}}),
  learningSummary: () => request("/learning/summary"),
  learning: (id) => request(`/learning/${encodeURIComponent(id)}`),
  metaStatus: () => request("/learning/meta"),
  syncMeta: () => request("/learning/meta/sync", { method: "POST", body: {} }),
  registerVariant: (id, body) =>
    request(`/learning/${encodeURIComponent(id)}/variants`, {
      method: "POST",
      body,
    }),
  recordMetrics: (id, body) =>
    request(`/learning/${encodeURIComponent(id)}/metrics`, {
      method: "POST",
      body,
    }),
  evaluateLearning: (id) =>
    request(`/learning/${encodeURIComponent(id)}/evaluate`, {
      method: "POST",
      body: {},
    }),
  automaticLearning: (id, enabled) =>
    request(`/learning/${encodeURIComponent(id)}/automatic`, {
      method: "POST",
      body: { enabled },
    }),
  linkMetaAd: (id, body) =>
    request(`/learning/${encodeURIComponent(id)}/link-ad`, {
      method: "POST",
      body,
    }),
  getCampaigns: () => request("/campaigns"),
  createCampaign: (body) => request("/campaigns", { method: "POST", body }),
  updateCampaign: (id, body) =>
    request(`/campaigns/${encodeURIComponent(id)}`, { method: "PUT", body }),
  selectWinner: (id, persona_index, version) =>
    request(`/campaigns/${encodeURIComponent(id)}/winner`, {
      method: "POST",
      body: { persona_index, version },
    }),
  getSettings: () => request("/settings"),
  saveSettings: (body) => request("/settings", { method: "POST", body }),
  getKnowledge: () => request("/knowledge"),
  addKnowledge: (type, text) =>
    request("/knowledge", { method: "POST", body: { type, text } }),
  deleteKnowledge: (id) =>
    request(`/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" }),
  generate: (content_type, brief, onEvent, signal, options = {}) =>
    content_type === "meta_ad" && onEvent
      ? generateCampaign(content_type, brief, onEvent, signal, options)
      : request("/content/generate", {
          method: "POST",
          body: { content_type, brief, ...options },
          signal,
        }),
  feedback: (generation_id, feedback) =>
    request("/content/feedback", {
      method: "POST",
      body: { generation_id, feedback },
    }),
  history: (campaignId) =>
    request(
      `/content/history${
        campaignId ? "?campaign_id=" + encodeURIComponent(campaignId) : ""
      }`
    ),
  buildContext: (content_type, brief) =>
    request("/context/build", {
      method: "POST",
      body: { content_type, brief },
    }),
};
