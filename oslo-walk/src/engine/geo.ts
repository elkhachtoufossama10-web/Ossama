import * as THREE from 'three';
import type { XZ } from './types';

/** Flat polygon (with holes) at height y; uv = world metres / uvScale. */
export function polygonGeometry(outer: XZ[], holes: XZ[][], y: number, uvScale = 1): THREE.BufferGeometry | null {
  if (outer.length < 3) return null;
  const o = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.filter((h) => h.length >= 3).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  if (THREE.ShapeUtils.isClockWise(o)) o.reverse();
  for (const h of hs) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(o, hs);
  } catch {
    return null;
  }
  const all = o.concat(...hs);
  const pos = new Float32Array(all.length * 3);
  const uv = new Float32Array(all.length * 2);
  all.forEach((v, i) => {
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = v.y;
    uv[i * 2] = v.x / uvScale;
    uv[i * 2 + 1] = v.y / uvScale;
  });
  const idx: number[] = [];
  // triangulateShape returns CCW in x/y; our plane maps y->z so flip winding to face +Y
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  faceUp(g);
  return g;
}

/** Make every triangle of a flat XZ geometry face +Y and set up-normals. */
export function faceUp(g: THREE.BufferGeometry) {
  const pos = g.attributes.position.array as Float32Array;
  const idxArr = g.index!.array as Uint16Array | Uint32Array;
  for (let i = 0; i < idxArr.length; i += 3) {
    const a = idxArr[i] * 3, b = idxArr[i + 1] * 3, c = idxArr[i + 2] * 3;
    const cross = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]);
    if (cross > 0) {
      const t = idxArr[i + 1];
      idxArr[i + 1] = idxArr[i + 2];
      idxArr[i + 2] = t;
    }
  }
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

/**
 * Ribbon along a polyline. uv.x = across (0..1), uv.y = distance along (metres / uvLen).
 * Joints use averaged (miter-limited) normals so segments connect without gaps.
 */
export function ribbonGeometry(pts: XZ[], width: number, y: number, uvLen = 1, offset = 0): THREE.BufferGeometry | null {
  const p = dedupe(pts);
  if (p.length < 2) return null;
  const n = p.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    // normal (perpendicular)
    let nx = -dz;
    let nz = dx;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const d1x = p[i][0] - p[i - 1][0], d1z = p[i][1] - p[i - 1][1];
      const l1 = Math.hypot(d1x, d1z) || 1;
      const n1x = -d1z / l1, n1z = d1x / l1;
      const cos = nx * n1x + nz * n1z;
      scale = Math.min(2.5, 1 / Math.max(0.4, cos));
    }
    nx *= scale;
    nz *= scale;
    if (i > 0) dist += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    const hw = width / 2;
    const cx = p[i][0] + nx * offset;
    const cz = p[i][1] + nz * offset;
    pos.set([cx + nx * hw, y, cz + nz * hw, cx - nx * hw, y, cz - nz * hw], i * 6);
    uv.set([0, dist / uvLen, 1, dist / uvLen], i * 4);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  faceUp(g);
  return g;
}

export function dedupe(pts: XZ[]): XZ[] {
  const out: XZ[] = [];
  for (const q of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 0.05) out.push(q);
  }
  return out;
}

export function pointInPolygon(x: number, z: number, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  const cx = ax + t * dx, cz = az + t * dz;
  return { d: Math.hypot(px - cx, pz - cz), cx, cz };
}

export function polylineLength(p: XZ[]) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}

/** Point and direction at distance s along a polyline (with precomputed cumulative lengths). */
export function sampleAlong(p: XZ[], cum: number[], s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const total = cum[cum.length - 1];
  s = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1e-6;
  const t = (s - cum[i - 1]) / seg;
  const ax = p[i - 1][0], az = p[i - 1][1], bx = p[i][0], bz = p[i][1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const L = Math.hypot(bx - ax, bz - az) || 1;
  out.dx = (bx - ax) / L;
  out.dz = (bz - az) / L;
  return out;
}

export function cumulative(p: XZ[]) {
  const c = [0];
  for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return c;
}

/** Deterministic hash → [0,1) */
export function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
