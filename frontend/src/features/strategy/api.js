import { api } from '../../lib/api-client.js';
export const request = (path, options) => api('/strategy' + path, options);
