import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE = '/a-donde-llego/';
// Production-like: fixture data -> vite build with the Pages base -> vite preview. The build always runs first,
// so a stale dist is never served; reuseExistingServer is off for the same reason.
const env = `ADL_DIST=dist-e2e ADL_BASE=${BASE}`;

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: `http://localhost:${PORT}${BASE}` },
  webServer: {
    command: [
      'PYTHONPATH=pipeline uv run --locked python e2e/build_fixture.py',
      `${env} npx vite build`,
      `${env} npx vite preview --port ${PORT} --strictPort`,
    ].join(' && '),
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
