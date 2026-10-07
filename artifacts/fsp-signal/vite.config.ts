import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  base: '/', plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') }, dedupe: ['react', 'react-dom'] },
  root: import.meta.dirname,
  build: { outDir: path.resolve(import.meta.dirname, 'dist/public'), emptyOutDir: true },
  server: { port: Number(process.env.WEB_PORT || 4310), host: '127.0.0.1', strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || 4312}` } },
  preview: { port: 4310, host: '127.0.0.1' },
});
