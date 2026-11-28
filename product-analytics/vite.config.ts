import { fileURLToPath } from 'node:url';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./dashboard/', import.meta.url)),
  base: './',
  plugins: [solid()],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
});
