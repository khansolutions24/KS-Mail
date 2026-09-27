import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const shared = resolve(root, 'src/shared');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': shared } },
    plugins: [react()],
    server: { port: 5183 }
  }
});
