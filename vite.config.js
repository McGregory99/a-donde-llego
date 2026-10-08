import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: '.',
    include: ['web/tests/**/*.test.js'],
    environment: 'node',
  },
});
