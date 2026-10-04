import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  // Hors de `src/` : ce dossier est rempli depuis node_modules par
  // scripts/copy-pdf-assets.mjs, il n'a rien à faire dans les sources.
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: true,
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});
