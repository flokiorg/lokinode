import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors vite.config.ts's "@" -> src alias so tests can use the same
// imports as app code. Per-file `// @vitest-environment jsdom` docblocks
// (used by component tests) opt into a DOM environment without changing
// the default here, so existing plain-logic tests keep running in 'node'.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
