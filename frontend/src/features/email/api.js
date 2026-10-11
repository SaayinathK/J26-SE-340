import { api } from '../../lib/api-client.js';
export const request = (path, options) => api(path.startsWith('/email/') ? path : '/email' + path, options);
