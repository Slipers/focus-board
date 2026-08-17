import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
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
