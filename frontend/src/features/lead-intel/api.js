import { api } from '../../lib/api-client.js';
export const request = (path, options) => api('/lead-intel'+path,{...options,...(path.endsWith('/recommendation')?{signal:AbortSignal.timeout(340000)}:{})});
