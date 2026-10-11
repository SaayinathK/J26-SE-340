'use strict';
const origin = process.env.OLLAMA_HOST || 'http://127.0.0.1:11435';
module.exports = { request: (path, options) => fetch(new URL(path, origin), options) };
