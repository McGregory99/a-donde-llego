import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { cleanStaleAssets, resolveBase, resolveDataFile } from './scripts/vite-helpers.mjs';

// ADL_DIST lets the e2e run build into its own folder without touching a developer's real dist/data.
const DIST = resolve(process.env.ADL_DIST ?? 'dist');
const DATA_ROOT = resolve(DIST, 'data');

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
      cleanStaleAssets(DIST);
    },
  };
}

export default defineConfig({
  root: 'web',
  base: resolveBase(),
  plugins: [serveCityData(), cleanBuildAssets()],
  server: { fs: { allow: ['..'] } },
  // dist/data holds the pipeline output next to the site, so the build must not wipe it.
  build: {
    outDir: DIST,
    // acerca.js uses top-level await (es2022).
    target: 'es2022',
    emptyOutDir: false,
    rollupOptions: { input: { index: resolve('web/index.html'), acerca: resolve('web/acerca.html') } },
  },
  test: {
    root: '.',
    include: ['web/tests/**/*.test.js'],
    environment: 'node',
  },
});
