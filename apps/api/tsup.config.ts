import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  splitting: false,
  clean: true,
  // Workspace packages ship TypeScript source → bundle them; everything else stays in node_modules
  noExternal: [/^@vitalog\//],
  external: ['pdfjs-dist', 'tesseract.js', '@napi-rs/canvas', 'zod'],
});
