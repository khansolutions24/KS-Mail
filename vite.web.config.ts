// Browser dev mode: renderer in a normal browser, backend via WebSocket (src/devserver/server.ts)
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
  plugins: [react()],
  server: { port: 5184, strictPort: true }
});
