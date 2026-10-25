// Production server: serves the built app from dist/ and the /api relays (METAR, model metadata). No secrets are needed.
// Usage: npm run build && npm start   (PORT=8080 by default)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMetar, handleModelMeta } from './relay.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.xml': 'application/xml', '.ttf': 'font/ttf' };

createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/metar')) return await handleMetar(req.url, res);
    if (req.url.startsWith('/api/model-meta')) return await handleModelMeta(req.url, res);
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
    const s = await stat(file).catch(() => null);
    const target = s?.isFile() ? file : join(root, 'index.html');
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    if (target.includes('/assets/') || target.includes('/cesium/')) res.setHeader('Cache-Control', 'public, max-age=604800');
    res.end(await readFile(target));
  } catch (e) {
    console.error(new Date().toISOString(), req.url, e);
    res.statusCode = 500;
    res.end('error');
  }
}).listen(Number(process.env.PORT) || 8080, () => console.log(`Earth Observatory on http://localhost:${process.env.PORT || 8080}`));
