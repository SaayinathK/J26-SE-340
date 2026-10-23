import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({ esbuild: { jsx: 'automatic' }, server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Referrer-Policy':'strict-origin-when-cross-origin' }, proxy: { '/api': process.env.GATEWAY_URL || loadEnv(mode, process.cwd(), '').GATEWAY_URL || 'http://127.0.0.1:4000' } } }));
