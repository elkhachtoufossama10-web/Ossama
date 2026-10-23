import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { NavLine } from '../world/City';
import { sampleAlong } from '../geo';

interface Car {
  line: NavLine;
  s: number;
  dir: number;
  speed: number;
  max: number;
  bus: boolean;
  color: THREE.Color;
  x: number;
  z: number;
  yaw: number;
}

const CAR_COLORS = [0xe9e9e9, 0x1b1c1f, 0x6a6e73, 0x23324a, 0x8a1d1d, 0xb7b9bb, 0x3a4a3f, 0x0f2c4f, 0xd8d2c2, 0x2a2a2a];

/** Cars and Oslo's red city buses driving on the real street centre-lines (right-hand traffic). */
export class Traffic {
  readonly group = new THREE.Group();
  private cars: Car[] = [];
  private body: THREE.InstancedMesh;
  private busBody: THREE.InstancedMesh;
  private cabin: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private headMat: THREE.MeshStandardMaterial;
  private tailMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private lines: NavLine[] = [];
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private disposables: { dispose(): void }[] = [];
  target = 0;

  constructor(capacity = 40) {
    const paint = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, roughness: 0.05, metalness: 0.2 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.85 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.3 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 0.4 });
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffe9c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const bodyG = new RoundedBoxGeometry(1.8, 0.75, 4.4, 3, 0.18).translate(0, 0.62, 0);
    const busG = new RoundedBoxGeometry(2.55, 2.85, 12, 3, 0.2).translate(0, 1.75, 0);
    const cabG = new RoundedBoxGeometry(1.62, 0.55, 2.3, 3, 0.18).translate(0, 1.2, 0.2);
    const wheelG = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16).rotateZ(Math.PI / 2);
    const lampG = new THREE.BoxGeometry(0.36, 0.12, 0.05);
    const glowG = new THREE.PlaneGeometry(4.2, 9).rotateX(-Math.PI / 2).translate(0, 0.04, -6.5);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, n: number, shadow = true) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(g, mesh);
      return mesh;
    };
    this.body = mk(bodyG, paint, capacity);
    this.busBody = mk(busG, new THREE.MeshPhysicalMaterial({ map: busTexture(), roughness: 0.35, metalness: 0.2, clearcoat: 0.8 }), 8);
    this.cabin = mk(cabG, glass, capacity);
    this.wheels = mk(wheelG, tire, capacity * 4 + 32);
    this.heads = mk(lampG, this.headMat, capacity * 2 + 16, false);
    this.tails = mk(lampG, this.tailMat, capacity * 2 + 16, false);
    this.glow = mk(glowG, this.glowMat, capacity + 8, false);
    this.body.setColorAt(0, new THREE.Color());
    this.disposables.push(paint, glass, tire, this.headMat, this.tailMat, this.glowMat);
  }

  setLines(lines: NavLine[], count: number) {
    this.lines = lines.filter((l) => l.len > 40);
    this.cars = [];
    this.target = this.lines.length ? count : 0;
  }

  private spawn(player: THREE.Vector3) {
    const near = this.lines.filter((l) => l.p.some(([x, z]) => Math.abs(x - player.x) < 260 && Math.abs(z - player.z) < 260));
    if (!near.length) return;
    let tot = 0;
    for (const l of near) tot += l.len;
    let r = Math.random() * tot;
    let line = near[0];
    for (const l of near) if ((r -= l.len) <= 0) {
      line = l;
      break;
    }
    const bus = Math.random() < 0.12 && line.width >= 6 && this.cars.filter((c) => c.bus).length < 6;
    const c: Car = {
      line,
      s: Math.random() * line.len,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: 0,
      max: bus ? 8 : 8.5 + Math.random() * 4,
      bus,
      color: new THREE.Color(CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0]),
      x: 0,
      z: 0,
      yaw: 0,
    };
    // avoid stacking on another car
    if (this.cars.some((o) => o.line === line && o.dir === c.dir && Math.abs(o.s - c.s) < 14)) return;
    this.cars.push(c);
  }

  update(dt: number, player: THREE.Vector3, night: number) {
    while (this.cars.length < this.target) {
      const before = this.cars.length;
      this.spawn(player);
      if (this.cars.length === before) break;
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    let ci = 0, bi = 0, wi = 0, li = 0;
    const keep: Car[] = [];
    for (const c of this.cars) {
      // car-following: slow down behind the car ahead in the same direction
      let limit = c.max;
      for (const o of this.cars) {
        if (o === c || o.line !== c.line || o.dir !== c.dir) continue;
        const gap = (o.s - c.s) * c.dir;
        if (gap > 0 && gap < 16) limit = Math.min(limit, Math.max(0, (gap - (o.bus ? 9 : 6)) * 0.8));
      }
      // yield to the player standing in the road ahead
      const ahead = { x: c.x + Math.sin(c.yaw) * 6, z: c.z + Math.cos(c.yaw) * 6 };
      if (Math.hypot(ahead.x - player.x, ahead.z - player.z) < 3.5) limit = 0;
      c.speed += (limit - c.speed) * (1 - Math.exp(-(limit < c.speed ? 3 : 0.8) * dt));
      c.s += c.speed * c.dir * dt;
      if (c.s < 0 || c.s > c.line.len) continue; // leaves the street → respawn elsewhere
      sampleAlong(c.line.p, c.line.cum, c.s, this.tmp);
      // right-hand traffic: drive on the right of the travel direction (right = (-fz, fx))
      const lane = Math.max(1.6, c.line.width / 4);
      const dx = this.tmp.dx * c.dir, dz = this.tmp.dz * c.dir;
      c.x = this.tmp.x - dz * lane;
      c.z = this.tmp.z + dx * lane;
      c.yaw = Math.atan2(dx, dz);
      if (Math.hypot(c.x - player.x, c.z - player.z) > 320) continue;
      keep.push(c);
      q.setFromAxisAngle(up, c.yaw);
      const pos = new THREE.Vector3(c.x, 0.02, c.z);
      const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const len = c.bus ? 6 : 2.2;
      const halfW = c.bus ? 1.0 : 0.68;
      if (c.bus) {
        m4.compose(pos, q, one);
        this.busBody.setMatrixAt(bi++, m4);
      } else {
        m4.compose(pos, q, one);
        this.body.setMatrixAt(ci, m4);
        this.body.setColorAt(ci, c.color);
        this.cabin.setMatrixAt(ci, m4);
        ci++;
      }
      const wz = c.bus ? [4.2, -3.8] : [1.35, -1.35];
      const wx = c.bus ? 1.15 : 0.82;
      const wr = c.bus ? 1.55 : 1;
      for (const zz of wz)
        for (const xx of [-wx, wx]) {
          m4.compose(pos.clone().addScaledVector(fwd, zz).addScaledVector(right, xx).setY(0.33 * wr), q, new THREE.Vector3(1, wr, wr));
          this.wheels.setMatrixAt(wi++, m4);
        }
      for (const sx of [-halfW, halfW]) {
        m4.compose(pos.clone().addScaledVector(fwd, len + 0.02).addScaledVector(right, sx).setY(c.bus ? 0.9 : 0.7), q, one);
        this.heads.setMatrixAt(li, m4);
        m4.compose(pos.clone().addScaledVector(fwd, -len - 0.02).addScaledVector(right, sx).setY(c.bus ? 0.9 : 0.78), q, one);
        this.tails.setMatrixAt(li, m4);
        li++;
      }
      m4.compose(pos.clone().addScaledVector(fwd, len - 2.2), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI)), one);
      this.glow.setMatrixAt(ci + bi - 1, m4);
    }
    this.cars = keep;
    this.body.count = this.cabin.count = ci;
    this.busBody.count = bi;
    this.wheels.count = wi;
    this.heads.count = this.tails.count = li;
    this.glow.count = night > 0.3 ? ci + bi : 0;
    for (const m of [this.body, this.busBody, this.cabin, this.wheels, this.heads, this.tails, this.glow]) m.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this.headMat.emissiveIntensity = 0.3 + night * 9;
    this.tailMat.emissiveIntensity = 0.4 + night * 4;
    this.glowMat.opacity = night * 0.55;
  }

  /** distance from p to the nearest car (for traffic sound) */
  nearest(p: THREE.Vector3) {
    let best = 1e9;
    for (const c of this.cars) best = Math.min(best, Math.hypot(c.x - p.x, c.z - p.z));
    return best;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 120, 4, 32, 80, 70);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ruter-style red city bus livery with a window band. */
function busTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b5121b';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#16191d';
  g.fillRect(0, 28, 512, 46);
  g.fillStyle = '#8e0f16';
  g.fillRect(0, 110, 512, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
