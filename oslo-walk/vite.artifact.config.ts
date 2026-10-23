import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained HTML page (JS, CSS and fonts inlined) for publishing as a Claude Artifact.
// Map data stays as separate files next to the page (public/data/*.json).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-artifact', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000 },
});
