import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const target = 'http://localhost:5001';
// Only API fetches are proxied: direct visits to /settings and /knowledge
// must still serve the React app.
const proxy = Object.fromEntries(['/api', '/content', '/context', '/knowledge', '/settings'].map(path => [path, {
  target, changeOrigin: true,
  bypass(req) { if (req.headers.accept?.includes('text/html')) return '/index.html'; },
}]));
export default defineConfig({ plugins: [react()], server: { port: 3000, strictPort: true, proxy } });
