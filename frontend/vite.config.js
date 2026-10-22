// frontend/vite.config.js — dev server on :3000; /api is proxied to the C4 gateway (never to an agent)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 3000,
    proxy: { '/api': { target: process.env.GATEWAY_URL || 'http://127.0.0.1:4000', changeOrigin: true } },
  },
});
