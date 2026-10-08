import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { cleanStaleAssets, resolveDataFile } from './scripts/vite-helpers.mjs';

const DATA_ROOT = resolve('dist/data');

/** Dev server: serve the pipeline output (dist/data/<city>/*.json) under /data/, as the deployed site does. */
function serveCityData() {
  return {
    name: 'serve-city-data',
    configureServer(server) {
      server.middlewares.use('/data', (request, response, next) => {
        const file = resolveDataFile(DATA_ROOT, new URL(request.url, 'http://x').pathname);
        if (!file || extname(file) !== '.json' || !existsSync(file) || !statSync(file).isFile()) return next();
        response.setHeader('Content-Type', 'application/json');
        createReadStream(file).pipe(response);
      });
    },
  };
}

/** Build: drop stale hashed assets from earlier builds; emptyOutDir stays off because dist/data lives here. */
function cleanBuildAssets() {
  return {
    name: 'clean-build-assets',
    apply: 'build',
    buildStart() {
      cleanStaleAssets(resolve('dist'));
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [serveCityData(), cleanBuildAssets()],
  server: { fs: { allow: ['..'] } },
  // dist/data holds the pipeline output next to the site, so the build must not wipe it.
  build: { outDir: '../dist', emptyOutDir: false },
  test: {
    root: '.',
    include: ['web/tests/**/*.test.js'],
    environment: 'node',
  },
});
