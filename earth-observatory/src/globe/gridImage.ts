import type { GridSample, Var } from '../sources/openMeteo';
import { SCALES, colorAt } from './colormaps';

/**
 * Renders the coarse model samples to an equirectangular canvas (−180…180, −90…90) using bilinear interpolation
 * *between neighbouring model grid samples*. Rows poleward of the sampled range are left transparent.
 */
export function renderGrid(g: GridSample, v: Var, width = 720): HTMLCanvasElement {
  const h = width / 2;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(width, h);
  const vals = g.values[v];
  const step = g.lats[0] - g.lats[1];
  const nLon = g.lons.length;
  const scale = SCALES[v];
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    const fi = (g.lats[0] - lat) / step;
    if (fi < -0.5 || fi > g.lats.length - 0.5) continue;
    const i0 = Math.max(0, Math.min(g.lats.length - 1, Math.floor(fi)));
    const i1 = Math.min(g.lats.length - 1, i0 + 1);
    const ty = Math.max(0, Math.min(1, fi - i0));
    for (let x = 0; x < width; x++) {
      const lon = -180 + ((x + 0.5) / width) * 360;
      const fj = (lon - g.lons[0]) / step;
      const j0 = ((Math.floor(fj) % nLon) + nLon) % nLon;
      const j1 = (j0 + 1) % nLon;
      const tx = fj - Math.floor(fj);
      const q = [vals[i0][j0], vals[i0][j1], vals[i1][j0], vals[i1][j1]];
      const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let s = 0, ws = 0;
      for (let k = 0; k < 4; k++) if (q[k] !== null) { s += q[k]! * w[k]; ws += w[k]; }
      if (ws < 0.25) continue;
      const val = s / ws;
      const [r, gg, b] = colorAt(scale, val);
      const o = (y * width + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b;
      img.data[o + 3] = v === 'precipitation' ? (val < 0.1 ? 0 : 230) : 230;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
