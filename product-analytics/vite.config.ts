import { fileURLToPath } from 'node:url';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';
import { dashboardDev } from './analysis/dashboard-dev.ts';

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('./dashboard/', import.meta.url)),
  base: './',
  plugins: [solid(), ...(mode === 'test' ? [] : [dashboardDev()])],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
}));
