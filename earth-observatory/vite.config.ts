import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
// @ts-expect-error plain ESM module shared with the production server
import { handleMetar, handleModelMeta } from './server/relay.mjs';

// Cesium ships pre-built web workers, widgets CSS and assets that must be served as static files.
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig({
  base: './',
  define: { CESIUM_BASE_URL: JSON.stringify(`./${cesiumBaseUrl}`) },
  plugins: [
    react(),
    ({
      name: 'api-relays',
      configureServer(server) {
        server.middlewares.use('/api/metar', (req, res) => handleMetar('/api/metar' + ((req as { url?: string }).url ?? ''), res));
        server.middlewares.use('/api/model-meta', (req, res) => handleModelMeta('/api/model-meta' + ((req as { url?: string }).url ?? ''), res));
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/metar', (req, res) => handleMetar('/api/metar' + ((req as { url?: string }).url ?? ''), res));
        server.middlewares.use('/api/model-meta', (req, res) => handleModelMeta('/api/model-meta' + ((req as { url?: string }).url ?? ''), res));
      },
    }) satisfies Plugin,
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
      ],
    }),
  ],
  build: { chunkSizeWarningLimit: 6000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
