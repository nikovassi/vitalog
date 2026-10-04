/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync } from 'node:fs';

const staticDemo = process.env.VITE_STATIC_DEMO === 'true';

export default defineConfig({
  // GitHub Pages serves the static demo under /vitalog/
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    // SPA deep links on GitHub Pages: unknown paths are served 404.html → same app
    { name: 'pages-404', apply: 'build', closeBundle() { if (staticDemo) copyFileSync('dist/index.html', 'dist/404.html'); } },
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in dev → cookies stay first-party, SameSite works as in production
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('victory-vendor')) return 'charts';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
