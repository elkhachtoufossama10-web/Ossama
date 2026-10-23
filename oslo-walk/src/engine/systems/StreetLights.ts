import * as THREE from 'three';
import type { Lamp } from '../world/City';

/**
 * Night lighting for street lamps:
 *  - emissive lamp heads (bloom picks them up)
 *  - soft light pools projected on the pavement (cheap, additive)
 *  - a small pool of real PointLights re-assigned every few frames to the lamps nearest the walker,
 *    so nearby facades, people and wet stone get genuine lighting and reflections
 */
export class StreetLights {
  readonly group = new THREE.Group();
  private heads: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private headMat: THREE.MeshStandardMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private lights: THREE.PointLight[] = [];
  private lamps: Lamp[] = [];
  private timer = 0;
  private level = 0;

  constructor(maxLights: number) {
    this.headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc98a, emissiveIntensity: 0 });
    this.poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffbf7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 });
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.05, 0.24), this.headMat, 1);
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), this.poolMat, 1);
    this.pools.renderOrder = 2;
    this.group.add(this.heads, this.pools);
    this.setMaxLights(maxLights);
  }

  setMaxLights(n: number) {
    for (const l of this.lights) this.group.remove(l);
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffc285, 0, 26, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  setLamps(lamps: Lamp[]) {
    this.lamps = lamps;
    const n = Math.max(1, lamps.length);
    for (const m of [this.heads, this.pools]) {
      m.dispose();
    }
    this.group.remove(this.heads, this.pools);
    this.heads = new THREE.InstancedMesh(this.heads.geometry, this.headMat, n);
    this.pools = new THREE.InstancedMesh(this.pools.geometry, this.poolMat, n);
    this.pools.renderOrder = 2;
    const m4 = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      // lamp head sits ~0.85 m off the pole along the arm (lamp mesh arm points +x)
      m4.makeTranslation(l.x + 0.85, l.h - 0.22, l.z);
      this.heads.setMatrixAt(i, m4);
      m4.makeTranslation(l.x + 0.85, 0.05, l.z);
      this.pools.setMatrixAt(i, m4);
    });
    this.heads.count = this.pools.count = lamps.length;
    this.group.add(this.heads, this.pools);
  }

  update(dt: number, p: THREE.Vector3, night: number, wet: number) {
    this.level += (night - this.level) * Math.min(1, dt * 3);
    const on = this.level;
    this.headMat.emissiveIntensity = on * 5;
    this.poolMat.opacity = on * (0.2 + wet * 0.12);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      if (on > 0.05) {
        const near = this.lamps
          .map((l) => ({ l, d: (l.x - p.x) ** 2 + (l.z - p.z) ** 2 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, this.lights.length);
        this.lights.forEach((light, i) => {
          const n = near[i];
          if (n) light.position.set(n.l.x + 0.85, n.l.h - 0.4, n.l.z);
          else light.position.set(0, -500, 0);
        });
      }
    }
    for (const l of this.lights) l.intensity = on * 28;
  }

  dispose() {
    this.heads.geometry.dispose();
    this.pools.geometry.dispose();
    this.headMat.dispose();
    this.poolMat.map?.dispose();
    this.poolMat.dispose();
    this.heads.dispose();
    this.pools.dispose();
  }
}

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
