// services/lead-intel/web/vite.config.js — dev server on :5173; /api is proxied to the C4 gateway
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.GATEWAY_URL || 'http://127.0.0.1:4000', changeOrigin: true } },
  },
});
