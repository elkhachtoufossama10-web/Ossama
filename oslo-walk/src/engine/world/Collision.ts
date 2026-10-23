import type { AreaData, XZ } from '../types';
import { distToSegment, pointInPolygon } from '../geo';

interface Poly {
  p: XZ[];
  holes: XZ[][];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const CELL = 24;

function mkPoly(p: XZ[], holes: XZ[][] = []): Poly {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of p) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { p, holes, minX, minZ, maxX, maxZ };
}

/**
 * 2D collision world: solid building footprints, walkable land + piers, fountains/pools blocked,
 * and the walkable box of the area. Queries are accelerated with a uniform grid.
 */
export class Collision {
  private solids: Poly[] = [];
  private walk: Poly[] = [];
  private blocked: Poly[] = [];
  private grid = new Map<string, number[]>();
  private walkGrid = new Map<string, number[]>();
  readonly bounds: [number, number, number, number];

  constructor(data: AreaData, margin: number) {
    const [x0, z0, x1, z1] = data.bounds;
    this.bounds = [x0 - margin * 0.5, z0 - margin * 0.5, x1 + margin * 0.5, z1 + margin * 0.5];
    for (const b of data.buildings) {
      // only ground-touching volumes block walking (bridges/cantilevers above 2.5 m don't)
      if ((b.mh ?? 0) > 2.5) continue;
      this.solids.push(mkPoly(b.p, b.holes ?? []));
    }
    for (const l of data.land) this.walk.push(mkPoly(l.p, l.holes));
    for (const a of data.areas) if (a.t === 'pier') this.walk.push(mkPoly(a.p));
    for (const w of data.water) {
      const poly = mkPoly(w);
      // small inland water (pools, fountains) blocks; the sea is handled by "not on land"
      if ((poly.maxX - poly.minX) * (poly.maxZ - poly.minZ) < 40000) this.blocked.push(poly);
    }
    this.index(this.solids, this.grid);
    this.index(this.walk, this.walkGrid);
  }

  private index(list: Poly[], grid: Map<string, number[]>) {
    list.forEach((p, i) => {
      for (let cx = Math.floor(p.minX / CELL); cx <= Math.floor(p.maxX / CELL); cx++)
        for (let cz = Math.floor(p.minZ / CELL); cz <= Math.floor(p.maxZ / CELL); cz++) {
          const k = cx + ',' + cz;
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(i);
        }
    });
  }

  private near(grid: Map<string, number[]>, x: number, z: number) {
    return grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) ?? [];
  }

  insideBuilding(x: number, z: number, r: number) {
    for (const i of this.near(this.grid, x, z)) {
      const s = this.solids[i];
      if (x < s.minX - r || x > s.maxX + r || z < s.minZ - r || z > s.maxZ + r) continue;
      const inHole = s.holes.some((h) => pointInPolygon(x, z, h));
      if (pointInPolygon(x, z, s.p) && !inHole) return true;
      if (r > 0) {
        for (const ring of [s.p, ...s.holes])
          for (let k = 0; k < ring.length; k++) {
            const a = ring[k], b = ring[(k + 1) % ring.length];
            if (distToSegment(x, z, a[0], a[1], b[0], b[1]).d < r) return true;
          }
      }
    }
    return false;
  }

  onWalkableGround(x: number, z: number) {
    for (const i of this.near(this.walkGrid, x, z)) {
      const w = this.walk[i];
      if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) continue;
      if (pointInPolygon(x, z, w.p) && !w.holes.some((h) => pointInPolygon(x, z, h))) {
        return !this.blocked.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && pointInPolygon(x, z, b.p));
      }
    }
    return false;
  }

  inBounds(x: number, z: number) {
    const [x0, z0, x1, z1] = this.bounds;
    return x > x0 && x < x1 && z > z0 && z < z1;
  }

  /** Walkable ignoring the area box (used when placing props). */
  isWalkableRaw(x: number, z: number, r: number) {
    return this.onWalkableGround(x, z) && !this.insideBuilding(x, z, r);
  }

  isWalkable(x: number, z: number, r: number) {
    return this.inBounds(x, z) && this.isWalkableRaw(x, z, r);
  }

  /** Move a circle from (x,z) by (dx,dz) with wall sliding. Returns the new position. */
  move(x: number, z: number, dx: number, dz: number, r: number): [number, number] {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.25));
    let px = x, pz = z;
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (this.isWalkable(px + sx, pz + sz, r)) {
        px += sx;
        pz += sz;
      } else if (this.isWalkable(px + sx, pz, r)) px += sx;
      else if (this.isWalkable(px, pz + sz, r)) pz += sz;
    }
    return [px, pz];
  }

  /** Nearest walkable point (spiral search) — used for spawning. */
  nearestWalkable(x: number, z: number, r = 0.4): [number, number] {
    if (this.isWalkable(x, z, r)) return [x, z];
    for (let rad = 1; rad < 120; rad += 1)
      for (let a = 0; a < 24; a++) {
        const px = x + Math.cos((a / 24) * Math.PI * 2) * rad;
        const pz = z + Math.sin((a / 24) * Math.PI * 2) * rad;
        if (this.isWalkable(px, pz, r)) return [px, pz];
      }
    return [x, z];
  }
}
