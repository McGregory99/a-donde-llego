import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { defineConfig } from 'vite';

const DATA_ROOT = resolve('dist/data');

/** Dev server: serve the pipeline output (dist/data/<city>/*.json) under /data/, as the deployed site does. */
function serveCityData() {
  return {
    name: 'serve-city-data',
    configureServer(server) {
      server.middlewares.use('/data', (request, response, next) => {
        const file = normalize(join(DATA_ROOT, decodeURIComponent(new URL(request.url, 'http://x').pathname)));
        if (!file.startsWith(DATA_ROOT) || extname(file) !== '.json' || !existsSync(file) || !statSync(file).isFile()) return next();
        response.setHeader('Content-Type', 'application/json');
        createReadStream(file).pipe(response);
      });
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [serveCityData()],
  server: { fs: { allow: ['..'] } },
  // dist/data holds the pipeline output next to the site, so the build must not wipe it.
  build: { outDir: '../dist', emptyOutDir: false },
  test: {
    root: '.',
    include: ['web/tests/**/*.test.js'],
    environment: 'node',
  },
});
