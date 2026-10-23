import * as THREE from 'three';

/** Rain streaks or snowflakes in a box that follows the camera. */
export class Precipitation {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rainPos: Float32Array;
  private snowPos: Float32Array;
  private snowSeed: Float32Array;
  private box = new THREE.Vector3(46, 26, 46);
  mode: 'none' | 'rain' | 'snow' = 'none';

  constructor(private count: number) {
    this.rainPos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * this.box.x, y = Math.random() * this.box.y, z = (Math.random() - 0.5) * this.box.z;
      this.rainPos.set([x, y, z, x + 0.03, y + 0.55, z + 0.01], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rain.frustumCulled = false;

    const n = Math.floor(count * 0.7);
    this.snowPos = new Float32Array(n * 3);
    this.snowSeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.snowPos.set([(Math.random() - 0.5) * this.box.x, Math.random() * this.box.y, (Math.random() - 0.5) * this.box.z], i * 3);
      this.snowSeed[i] = Math.random() * 100;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, map: flake(), transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
    this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
    this.set('none');
  }

  set(mode: 'none' | 'rain' | 'snow') {
    this.mode = mode;
    this.rain.visible = mode === 'rain';
    this.snow.visible = mode === 'snow';
  }

  update(dt: number, cam: THREE.Vector3, night: number) {
    if (this.mode === 'none') return;
    const hx = this.box.x / 2, hz = this.box.z / 2;
    if (this.mode === 'rain') {
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.22 + night * 0.12;
      const p = this.rainPos;
      const fall = 11 * dt;
      for (let i = 0; i < this.count; i++) {
        const o = i * 6;
        p[o + 1] -= fall;
        p[o + 4] -= fall;
        p[o] += 0.6 * dt;
        p[o + 3] += 0.6 * dt;
        if (p[o + 1] < 0) {
          const x = (Math.random() - 0.5) * this.box.x, z = (Math.random() - 0.5) * this.box.z, y = this.box.y;
          p.set([x, y, z, x + 0.03, y + 0.55, z + 0.01], o);
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.set(cam.x, 0, cam.z);
      wrap(p, 6, this.rain.position, hx, hz, 2);
    } else {
      const p = this.snowPos;
      const t = performance.now() / 1000;
      for (let i = 0; i < this.snowSeed.length; i++) {
        const o = i * 3;
        p[o + 1] -= (0.7 + (this.snowSeed[i] % 1) * 0.4) * dt;
        p[o] += Math.sin(t * 0.7 + this.snowSeed[i]) * 0.25 * dt;
        p[o + 2] += Math.cos(t * 0.5 + this.snowSeed[i]) * 0.2 * dt;
        if (p[o + 1] < 0) p[o + 1] += this.box.y;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.position.set(cam.x, 0, cam.z);
      wrap(p, 3, this.snow.position, hx, hz, 1);
    }
  }

  dispose() {
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as THREE.PointsMaterial).map?.dispose();
    (this.snow.material as THREE.Material).dispose();
  }
}

/** Keep particles inside the box as the box moves with the camera (wrap in world space). */
const last = new WeakMap<THREE.Vector3, THREE.Vector3>();
function wrap(p: Float32Array, stride: number, center: THREE.Vector3, hx: number, hz: number, verts: number) {
  const prev = last.get(center);
  last.set(center, center.clone());
  if (!prev) return;
  const mx = center.x - prev.x, mz = center.z - prev.z;
  if (!mx && !mz) return;
  for (let i = 0; i < p.length; i += stride) {
    for (let v = 0; v < verts; v++) {
      p[i + v * 3] -= mx;
      p[i + v * 3 + 2] -= mz;
    }
    if (p[i] > hx) for (let v = 0; v < verts; v++) p[i + v * 3] -= hx * 2;
    if (p[i] < -hx) for (let v = 0; v < verts; v++) p[i + v * 3] += hx * 2;
    if (p[i + 2] > hz) for (let v = 0; v < verts; v++) p[i + v * 3 + 2] -= hz * 2;
    if (p[i + 2] < -hz) for (let v = 0; v < verts; v++) p[i + v * 3 + 2] += hz * 2;
  }
}

function flake() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
