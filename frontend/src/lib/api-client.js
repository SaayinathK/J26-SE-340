let configPromise;
let csrfToken;

export class ApiError extends Error {
  constructor(message, status, code, data) { super(message); this.status = status; this.code = code; this.details = data; this.guardrail_flags = data?.guardrail_flags; }
}

const unavailable = 'Cannot reach the account gateway. Run npm run dev in frontend to start both services, then refresh this page.';
async function responseData(response) {
  try { return await response.json(); } catch { return null; }
}

export async function authConfig(force = false) {
  if (!configPromise || force) {
    configPromise = fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) })
      .then(async response => {
        const data = await responseData(response);
        if (!response.ok) throw new ApiError(data?.error || unavailable, response.status, data?.code);
        if (typeof data?.csrf_token !== 'string' || data.csrf_token.length < 32) {
          throw new ApiError('The gateway returned an invalid authentication configuration. Restart the gateway and refresh this page.', 502);
        }
        csrfToken = data.csrf_token;
        return data;
      }).catch(error => { configPromise = null; throw error instanceof ApiError ? error : new ApiError(unavailable, 0); });
  }
  return configPromise;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const mutating = !['GET', 'HEAD'].includes(method);
  if (mutating && !csrfToken) await authConfig();
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal: signal || AbortSignal.timeout(path === '/email/sequence' ? 110000 : 20000),
      headers: { ...(mutating ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(unavailable, 0);
  }
  const data = await responseData(response);
  if (!response.ok) {
    if (response.status === 401 && !['/auth/login', '/auth/register', '/auth/google', '/auth/me'].includes(path)) window.dispatchEvent(new Event('ciftron-session-expired'));
    if(response.status===403 && path!=='/auth/me')window.dispatchEvent(new Event('ciftron-permissions-changed'));
    if (data?.code === 'CSRF_INVALID') { configPromise = null; csrfToken = null; }
    throw new ApiError(data?.error || unavailable, response.status, data?.code, data);
  }
  if (!data) throw new ApiError('The gateway returned an invalid response. Restart the gateway and refresh this page.', 502);
  return data;
}
