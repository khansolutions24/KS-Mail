import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(process.cwd(), 'src/shared') } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
