'use strict';
// Model implementation is pending; the runtime currently returns HTTP 503.
const origin = process.env.MODEL_HOST || 'http://127.0.0.1:11438';
module.exports = { request: (path, options) => fetch(new URL(path, origin), options) };
