import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AreaData, BuildingData, LineData, LocationId, XZ } from '../types';
import { cumulative, dedupe, distToSegment, hash, pointInPolygon, polygonGeometry, polylineLength, ribbonGeometry, rng } from '../geo';
import type { MaterialKit } from '../materials';
import { Collision } from './Collision';

export interface NavLine {
  p: XZ[];
  cum: number[];
  len: number;
  kind: 'walk' | 'cycle' | 'car';
  width: number;
}

export interface Lamp {
  x: number;
  z: number;
  h: number;
}

export interface CityBuild {
  group: THREE.Group;
  collision: Collision;
  walkLines: NavLine[];
  carLines: NavLine[];
  cycleLines: NavLine[];
  lamps: Lamp[];
  benches: { x: number; z: number; yaw: number }[];
  storefronts: { x: number; z: number; yaw: number }[];
  named: { p: XZ[]; n: string }[];
  trees: { mesh: THREE.InstancedMesh; crown: THREE.InstancedMesh; base: THREE.Color[] };
  waterLevel: number;
  waterBounds: [number, number, number, number];
  hasWater: boolean;
  dispose(): void;
}

const CAR_TYPES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street']);

// Palettes inspired by central Oslo facades (ochre, cream, terracotta, pale grey, dusty pink, brick)
const CLASSIC = [0xcdbf9f, 0xdcd1b8, 0xc4a17e, 0xb98e72, 0xb3ada3, 0xe0d9cb, 0xc9ad8d, 0xbfb29d, 0xd0bcad, 0xa39888, 0xd6c79f, 0x9fa3a1];
const BRICK = [0x8d4b36, 0x9c5a40, 0x7c4433, 0xa86b4e, 0x6f3d2f];
const STONE = [0x9a958c, 0x8a857c, 0xb3ada2, 0x7f7a73, 0xc4bdb0];
const MODERN = [0x5f6a73, 0x7b8691, 0x9aa3a8, 0x3d454c, 0xc8c9c4, 0xe4e3de];

function parseColour(c?: string): THREE.Color | null {
  if (!c) return null;
  try {
    const col = new THREE.Color();
    col.setStyle(c.trim().toLowerCase().replace('grey', 'gray'), THREE.SRGBColorSpace);
    return col;
  } catch {
    return null;
  }
}

function landmarkOverride(name = ''): { style: number; color: number } | null {
  const n = name.toLowerCase();
  if (n.includes('opera')) return { style: 4, color: 0xf1efe9 };
  if (n.includes('slottet') || n.includes('royal palace')) return { style: 0, color: 0xe3d3a5 };
  if (n.includes('stortinget') || n.includes('storting')) return { style: 1, color: 0xc9a66b };
  if (n.includes('domkirke')) return { style: 1, color: 0x8a4a35 };
  if (n.includes('nationaltheatret') || n.includes('nationalteatret')) return { style: 0, color: 0xd8cfb8 };
  if (n.includes('rådhus') || n.includes('city hall')) return { style: 1, color: 0x9a5640 };
  if (n.includes('universitet')) return { style: 0, color: 0xdcd2bb };
  if (n.includes('munch')) return { style: 2, color: 0xa7a9a6 };
  if (n.includes('deichman')) return { style: 2, color: 0xd9dcd8 };
  if (n.includes('sentralstasjon') || n.includes('østbane')) return { style: 3, color: 0xb9ae9c };
  if (n.includes('børs')) return { style: 0, color: 0xd6c7a8 };
  return null;
}

function chooseStyle(b: BuildingData, area: LocationId, r: () => number) {
  const mat = (b.mate || '').toLowerCase();
  if (mat.includes('glass')) return 2;
  if (mat.includes('brick')) return 1;
  if (mat.includes('stone') || mat.includes('granite') || mat.includes('marble')) return 3;
  if (mat.includes('concrete') || mat.includes('metal')) return 2;
  const modernArea = area === 'bjorvika' || area === 'akerbrygge';
  if (b.h > 40) return 2;
  if (modernArea && (b.k === 'office' || b.k === 'apartments' || b.k === 'commercial')) return r() < 0.7 ? 2 : 3;
  const x = r();
  return x < 0.58 ? 0 : x < 0.78 ? 1 : x < 0.93 ? 3 : 2;
}

export function buildCity(data: AreaData, area: LocationId, mats: MaterialKit, quality: 'low' | 'high' | 'ultra'): CityBuild {
  const group = new THREE.Group();
  group.name = `city-${area}`;
  const disposables: { dispose(): void }[] = [];
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material, opts: { cast?: boolean; receive?: boolean; name?: string } = {}) => {
    if (!g) return null;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = !!opts.cast;
    mesh.receiveShadow = opts.receive ?? true;
    mesh.name = opts.name ?? '';
    group.add(mesh);
    disposables.push(g);
    return mesh;
  };
  const merge = (geoms: (THREE.BufferGeometry | null)[]) => {
    const list = geoms.filter((g): g is THREE.BufferGeometry => !!g);
    if (!list.length) return null;
    const m = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    return m;
  };
  const r = rng(area.length * 7919 + data.buildings.length);
  const [bx0, bz0, bx1, bz1] = data.bounds;
  const margin = 60;

  // ------------------------------------------------------------ ground / land
  const landTile = 4.8;
  add(merge(data.land.map((l) => polygonGeometry(l.p, l.holes, 0, landTile))), mats.sidewalk, { name: 'land' });

  // quay walls along the land edge (visible at the harbour)
  const quay: THREE.BufferGeometry[] = [];
  for (const l of data.land) quay.push(skirt(l.p, 0, -2.4));
  add(merge(quay), mats.quay, { name: 'quay' });

  const plazas = data.areas.filter((a) => a.t === 'plaza').map((a) => polygonGeometry(a.p, [], 0.012, 2.4));
  add(merge(plazas), mats.plaza, { name: 'plazas' });
  const grass = data.areas.filter((a) => a.t === 'grass').map((a) => polygonGeometry(a.p, [], 0.02, 3));
  add(merge(grass), mats.grass, { name: 'grass' });
  const piers = data.areas.filter((a) => a.t === 'pier');
  add(merge(piers.map((a) => polygonGeometry(a.p, [], 0.03, 3.2))), mats.pier, { name: 'piers' });
  add(merge(piers.map((a) => skirt(a.p, 0.03, -2.4))), mats.quay, { name: 'pier-sides' });

  // ------------------------------------------------------------ roads & paths
  const roadG: (THREE.BufferGeometry | null)[] = [];
  const curbG: THREE.BufferGeometry[] = [];
  const markG: THREE.BufferGeometry[] = [];
  const cycleG: (THREE.BufferGeometry | null)[] = [];
  const pedG: (THREE.BufferGeometry | null)[] = [];
  const carLines: NavLine[] = [];
  const walkLines: NavLine[] = [];
  const cycleLines: NavLine[] = [];
  const named: { p: XZ[]; n: string }[] = [];
  const lamps: Lamp[] = data.lamps.map(([x, z]) => ({ x, z, h: 7.5 }));

  const navLine = (p: XZ[], kind: NavLine['kind'], width: number): NavLine | null => {
    const d = dedupe(p);
    if (d.length < 2) return null;
    const cum = cumulative(d);
    const len = cum[cum.length - 1];
    if (len < 6) return null;
    return { p: d, cum, len, kind, width };
  };

  for (const rd of data.roads) {
    if (rd.t === 'tram') {
      // tram rails: two thin dark metal strips
      const rail = ribbonGeometry(rd.p, 0.08, 0.03, 1, -0.72);
      const rail2 = ribbonGeometry(rd.p, 0.08, 0.03, 1, 0.72);
      if (rail) curbG.push(rail);
      if (rail2) curbG.push(rail2);
      continue;
    }
    roadG.push(ribbonGeometry(rd.p, rd.w, 0.02, 6));
    for (const s of [-1, 1]) {
      const c = ribbonGeometry(rd.p, 0.3, 0.06, 1, s * (rd.w / 2 + 0.15));
      if (c) curbG.push(c);
    }
    if (rd.w >= 6 && CAR_TYPES.has(rd.t)) markG.push(...dashes(rd.p, 0.12, 3, 6, 0.035));
    if (CAR_TYPES.has(rd.t) || rd.t === 'service') {
      const l = navLine(rd.p, 'car', rd.w);
      if (l && rd.t !== 'service') carLines.push(l);
      // sidewalks alongside streets are walkable lines too
      for (const s of [-1, 1]) {
        const off = offsetLine(rd.p, s * (rd.w / 2 + 1.8));
        const wl = navLine(off, 'walk', 2.5);
        if (wl) walkLines.push(wl);
      }
      // lamps along streets where OSM has none
      const len = polylineLength(rd.p);
      const cum = cumulative(rd.p);
      for (let s = 10; s < len; s += 27) {
        const pt = { x: 0, z: 0, dx: 0, dz: 0 };
        sampleAlongPoly(rd.p, cum, s, pt);
        const side = (Math.floor(s / 27) % 2 ? 1 : -1);
        const lx = pt.x - pt.dz * side * (rd.w / 2 + 0.7);
        const lz = pt.z + pt.dx * side * (rd.w / 2 + 0.7);
        if (!lamps.some((q) => Math.abs(q.x - lx) < 12 && Math.abs(q.z - lz) < 12)) lamps.push({ x: lx, z: lz, h: 8 });
      }
    }
    if (rd.n) named.push({ p: rd.p, n: rd.n });
  }
  for (const pth of data.paths) {
    if (pth.t === 'steps') continue;
    if (pth.t === 'pedestrian') {
      pedG.push(ribbonGeometry(pth.p, pth.w, 0.008, 4.8));
      const len = polylineLength(pth.p);
      const cum = cumulative(pth.p);
      for (let s = 8; s < len; s += 24) {
        const pt = { x: 0, z: 0, dx: 0, dz: 0 };
        sampleAlongPoly(pth.p, cum, s, pt);
        for (const side of [-1, 1]) {
          const lx = pt.x - pt.dz * side * (pth.w / 2 - 0.6);
          const lz = pt.z + pt.dx * side * (pth.w / 2 - 0.6);
          if (!lamps.some((q) => Math.abs(q.x - lx) < 9 && Math.abs(q.z - lz) < 9)) lamps.push({ x: lx, z: lz, h: 6 });
        }
      }
    }
    if (pth.t === 'cycleway') {
      cycleG.push(ribbonGeometry(pth.p, pth.w, 0.015, 6));
      const l = navLine(pth.p, 'cycle', pth.w);
      if (l) cycleLines.push(l);
    }
    if (pth.t === 'footway' || pth.t === 'pedestrian' || pth.t === 'path') {
      const l = navLine(pth.p, 'walk', pth.w);
      if (l) walkLines.push(l);
    }
    if (pth.n) named.push({ p: pth.p, n: pth.n });
  }
  add(merge(roadG), mats.road, { name: 'roads' });
  add(merge(pedG), mats.pedestrian, { name: 'pedestrian-streets' });
  add(merge(curbG), mats.curb, { name: 'curbs' });
  add(merge(markG), mats.marking, { name: 'markings', receive: true });
  const cycleMat = mats.road.clone();
  cycleMat.color = new THREE.Color(0xb0504a);
  disposables.push(cycleMat);
  add(merge(cycleG), cycleMat, { name: 'cycleways' });

  // ------------------------------------------------------------ buildings
  const wallGeoms: THREE.BufferGeometry[] = [];
  const roofGeoms: THREE.BufferGeometry[] = [];
  const storefronts: { x: number; z: number; yaw: number }[] = [];
  const minVisible = 0.5;
  data.buildings.forEach((b, i) => {
    const seed = hash(i * 13.7 + b.p.length);
    const lm = landmarkOverride(b.name);
    let style = lm ? lm.style : chooseStyle(b, area, r);
    let col = lm ? new THREE.Color(lm.color) : parseColour(b.colo);
    if (!col) {
      const pal = style === 1 ? BRICK : style === 2 ? MODERN : style === 3 ? STONE : CLASSIC;
      col = new THREE.Color(pal[Math.floor(seed * pal.length) % pal.length]);
    }
    col.convertSRGBToLinear();
    const h = b.h;
    const mh = b.mh ?? 0;
    if (h - mh < minVisible) return;
    const kind = b.k;
    const shopProne = ['retail', 'commercial', 'yes', 'office', 'apartments', 'hotel'].includes(kind) && h > 7 && mh < 0.5;
    const shop = shopProne && seed > 0.22 && !(b.name || '').toLowerCase().includes('opera') ? 1 : 0;
    const floorH = style === 2 ? 3.6 : 3.3 + hash(i * 3.3) * 0.5;
    const isPart = mh > 0 || kind === 'roof';
    if (kind === 'roof') style = 2;
    const rings: XZ[][] = [b.p, ...(b.holes ?? [])];
    for (const ring of rings) {
      const w = walls(ring, mh, h, col, style, isPart ? 0 : shop, floorH, seed);
      if (w) wallGeoms.push(w);
      if (shop && ring === b.p) {
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k], c = ring[(k + 1) % ring.length];
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (L > 7 && hash(i * 7 + k) > 0.6) {
            const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
            storefronts.push({ x: (a[0] + c[0]) / 2 + nx * 1.2, z: (a[1] + c[1]) / 2 + nz * 1.2, yaw: Math.atan2(nx, nz) });
          }
        }
      }
    }
    const roof = polygonGeometry(b.p, b.holes ?? [], h, 4);
    if (roof) {
      const rc = style === 2 ? new THREE.Color(0x4a4f54) : hash(i * 1.9) > 0.8 ? new THREE.Color(0x6f9484) : new THREE.Color(hash(i * 2.7) > 0.5 ? 0x56595c : 0x6b5047);
      rc.convertSRGBToLinear();
      paint(roof, rc);
      roofGeoms.push(roof);
    }
    if (mh > 0.5) {
      // underside of raised parts (cantilevers, Opera roof planes)
      const under = polygonGeometry(b.p, [], mh, 4);
      if (under) {
        flipFaces(under);
        paint(under, col.clone().multiplyScalar(0.6));
        roofGeoms.push(under);
      }
    }
  });
  const facade = add(merge(wallGeoms), mats.facade, { cast: true, name: 'facades' });
  const roofs = add(merge(roofGeoms), mats.roof, { cast: true, name: 'roofs' });
  if (facade) facade.receiveShadow = true;
  if (roofs) roofs.receiveShadow = true;

  // ------------------------------------------------------------ collision
  const collision = new Collision(data, margin);

  // ------------------------------------------------------------ trees
  const treePts: XZ[] = data.trees;
  const treeCount = Math.min(treePts.length, quality === 'low' ? 450 : 1400);
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.18, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = crownGeometry();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b30, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: false });
  disposables.push(trunkGeo, crownGeo, trunkMat, crownMat);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, treeCount));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(1, treeCount));
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const baseColors: THREE.Color[] = [];
  for (let i = 0; i < treeCount; i++) {
    const [x, z] = treePts[i];
    const s = 0.75 + hash(i * 2.1) * 0.7;
    const th = 2.6 * s;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i) * 6.28);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, th, s));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, th * 0.92, z), q, new THREE.Vector3(s * (2.4 + hash(i * 5) * 0.8), s * (2.9 + hash(i * 6)), s * (2.4 + hash(i * 7) * 0.8)));
    crowns.setMatrixAt(i, m4);
    const c = new THREE.Color().setHSL(0.24 + hash(i * 9) * 0.06, 0.38 + hash(i * 4) * 0.15, 0.2 + hash(i * 3) * 0.08);
    baseColors.push(c);
    crowns.setColorAt(i, c);
  }
  trunks.count = crowns.count = treeCount;
  group.add(trunks, crowns);

  // ------------------------------------------------------------ street furniture
  const benches = data.benches.map(([x, z]) => ({ x, z, yaw: alignYaw(x, z, data.paths.concat(data.roads)) }));
  group.add(instanced(benchGeometry(), new THREE.MeshStandardMaterial({ color: 0x6b5644, roughness: 0.8 }), benches.map((b) => [b.x, 0, b.z, b.yaw]), disposables, 'benches'));
  const lampGeo = lampGeometry();
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, metalness: 0.6 });
  const keptLamps = lamps.filter((l) => l.x > bx0 - margin && l.x < bx1 + margin && l.z > bz0 - margin && l.z < bz1 + margin && collision.isWalkableRaw(l.x, l.z, 0.1));
  group.add(instanced(lampGeo, lampMat, keptLamps.map((l) => [l.x, 0, l.z, 0, l.h]), disposables, 'lamp-posts'));
  const signalGeo = signalGeometry();
  group.add(instanced(signalGeo, new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6, metalness: 0.4 }), data.signals.map(([x, z]) => [x, 0, z, alignYaw(x, z, data.roads)]), disposables, 'signals'));
  const bins = walkLines.slice(0, 120).map((l, i) => {
    const s = l.len * hash(i * 3.1);
    const pt = { x: 0, z: 0, dx: 0, dz: 0 };
    sampleAlongPoly(l.p, l.cum, s, pt);
    return [pt.x - pt.dz * 1.1, 0, pt.z + pt.dx * 1.1, Math.atan2(pt.dx, pt.dz)] as number[];
  }).filter((v) => collision.isWalkableRaw(v[0], v[2], 0.4));
  group.add(instanced(binGeometry(), new THREE.MeshStandardMaterial({ color: 0x2f4c3a, roughness: 0.6, metalness: 0.3 }), bins, disposables, 'bins'));

  // water extent (a big plane under the land — visible wherever there is no land)
  const hasWater = data.water.length > 0;

  for (const m of [lampMat]) disposables.push(m);

  return {
    group,
    collision,
    walkLines: walkLines.filter((l) => l.p.every(([x, z]) => x > bx0 - 20 && x < bx1 + 20 && z > bz0 - 20 && z < bz1 + 20)),
    carLines,
    cycleLines,
    lamps: keptLamps,
    benches,
    storefronts: storefronts.filter((s) => collision.isWalkableRaw(s.x, s.z, 0.4)),
    named,
    trees: { mesh: trunks, crown: crowns, base: baseColors },
    waterLevel: -0.9,
    waterBounds: [bx0 - margin - 400, bz0 - margin - 400, bx1 + margin + 400, bz1 + margin + 400],
    hasWater,
    dispose() {
      disposables.forEach((d) => d.dispose());
      trunks.dispose();
      crowns.dispose();
    },
  };
}

// ---------------------------------------------------------------- helpers
function sampleAlongPoly(p: XZ[], cum: number[], s: number, out: { x: number; z: number; dx: number; dz: number }) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1e-6;
  const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
  out.x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
  out.z = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
  const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1;
  out.dx = (p[i][0] - p[i - 1][0]) / L;
  out.dz = (p[i][1] - p[i - 1][1]) / L;
}

function offsetLine(p: XZ[], off: number): XZ[] {
  const d = dedupe(p);
  return d.map((pt, i) => {
    const a = d[Math.max(0, i - 1)], b = d[Math.min(d.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [pt[0] - ((b[1] - a[1]) / L) * off, pt[1] + ((b[0] - a[0]) / L) * off];
  });
}

function dashes(p: XZ[], width: number, dash: number, period: number, y: number): THREE.BufferGeometry[] {
  const d = dedupe(p);
  const cum = cumulative(d);
  const len = cum[cum.length - 1];
  const out: THREE.BufferGeometry[] = [];
  const pt = { x: 0, z: 0, dx: 0, dz: 0 };
  for (let s = period * 0.5; s + dash < len; s += period) {
    const seg: XZ[] = [];
    for (let k = 0; k <= 2; k++) {
      sampleAlongPoly(d, cum, s + (dash * k) / 2, pt);
      seg.push([pt.x, pt.z]);
    }
    const g = ribbonGeometry(seg, width, y, 1);
    if (g) out.push(g);
  }
  return out;
}

/** Vertical wall strip following a ring, from y0 down/up to y1. */
function skirt(ring: XZ[], yTop: number, yBottom: number) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  let along = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.01) continue;
    const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    pos.push(a[0], yTop, a[1], b[0], yTop, b[1], a[0], yBottom, a[1], b[0], yTop, b[1], b[0], yBottom, b[1], a[0], yBottom, a[1]);
    for (let k = 0; k < 6; k++) nrm.push(nx, 0, nz);
    uv.push(along, yTop, along + L, yTop, along, yBottom, along + L, yTop, along + L, yBottom, along, yBottom);
    along += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Facade walls with the attributes the facade shader expects. */
function walls(ring: XZ[], y0: number, y1: number, color: THREE.Color, style: number, shop: number, floorH: number, seed: number) {
  const pts = dedupe(ring);
  if (pts.length < 3) return null;
  // orient walls outward: outer rings CCW in x/z (as seen from above with z south → use signed area)
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], wall: number[] = [], sty: number[] = [], col: number[] = [];
  const H = y1;
  for (let i = 0; i < pts.length; i++) {
    let a = pts[i], b = pts[(i + 1) % pts.length];
    if (!ccw) [a, b] = [b, a];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    // outward normal of a CCW ring = right-hand side of the travel direction; the triangle
    // winding (top-a, top-b, bottom-a) already faces that way
    const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    const quad = [a[0], y1, a[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], b[0], y0, b[1], a[0], y0, a[1]];
    const quv = [0, y1, L, y1, 0, y0, L, y1, L, y0, 0, y0];
    pos.push(...quad);
    uv.push(...quv);
    const lshop = L > 5 ? shop : 0;
    for (let k = 0; k < 6; k++) {
      nrm.push(nx, 0, nz);
      wall.push(L, H);
      sty.push(seed, style, lshop, floorH);
      col.push(color.r, color.g, color.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 2));
  g.setAttribute('aStyle', new THREE.Float32BufferAttribute(sty, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function paint(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function flipFaces(g: THREE.BufferGeometry) {
  const idx = g.index!.array as Uint16Array | Uint32Array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setY(i, -1);
}

function alignYaw(x: number, z: number, lines: LineData[]) {
  let best = 1e9, yaw = 0;
  for (const l of lines) {
    const p = l.p;
    if (Math.abs(p[0][0] - x) > 200 && Math.abs(p[p.length - 1][0] - x) > 200) continue;
    for (let i = 1; i < p.length; i++) {
      const { d } = distToSegment(x, z, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      if (d < best) {
        best = d;
        yaw = Math.atan2(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) + Math.PI / 2;
      }
    }
  }
  return yaw;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: number[][], disposables: { dispose(): void }[], name: string) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it[3] ?? 0);
    const sy = it[4] ? it[4] / 8 : 1;
    m4.compose(new THREE.Vector3(it[0], it[1], it[2]), q, new THREE.Vector3(1, sy, 1));
    mesh.setMatrixAt(i, m4);
  });
  mesh.count = items.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  disposables.push(geo, mat, { dispose: () => mesh.dispose() });
  return mesh;
}

function crownGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const R = rng(42);
  for (let i = 0; i < 7; i++) {
    const g = new THREE.IcosahedronGeometry(0.42 + R() * 0.18, 1);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, k);
      v.multiplyScalar(0.85 + R() * 0.3);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    g.translate((R() - 0.5) * 0.55, (R() - 0.4) * 0.5, (R() - 0.5) * 0.55);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const m = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  m.computeVertexNormals();
  return m;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function benchGeometry() {
  const parts = [box(1.8, 0.06, 0.45, 0, 0.45, 0), box(1.8, 0.4, 0.05, 0, 0.72, -0.21), box(0.06, 0.45, 0.4, -0.8, 0.22, 0), box(0.06, 0.45, 0.4, 0.8, 0.22, 0)];
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

function lampGeometry() {
  // unit lamp is 8 m tall (instances scale Y by height/8)
  const pole = new THREE.CylinderGeometry(0.06, 0.09, 8, 8);
  pole.translate(0, 4, 0);
  const arm = box(0.9, 0.06, 0.06, 0.45, 7.9, 0);
  const head = box(0.55, 0.12, 0.28, 0.85, 7.85, 0);
  const g = mergeGeometries([pole, arm, head], false);
  [pole, arm, head].forEach((p) => p.dispose());
  return g;
}

function signalGeometry() {
  const pole = new THREE.CylinderGeometry(0.06, 0.07, 3.2, 8);
  pole.translate(0, 1.6, 0);
  const head = box(0.3, 0.9, 0.25, 0, 2.9, 0.12);
  const g = mergeGeometries([pole, head], false);
  [pole, head].forEach((p) => p.dispose());
  return g;
}

function binGeometry() {
  const c = new THREE.CylinderGeometry(0.25, 0.22, 0.9, 12);
  c.translate(0, 0.45, 0);
  return c;
}

export function pointInLand(data: AreaData, x: number, z: number) {
  for (const l of data.land) if (pointInPolygon(x, z, l.p) && !l.holes.some((h) => pointInPolygon(x, z, h))) return true;
  return false;
}
