import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CityBuild, NavLine } from '../world/City';
import type { Season } from '../types';
import { sampleAlong } from '../geo';

/**
 * Crowd system.
 * Bodies are procedural articulated figures (thighs, shins, arms, torso, head, hair, coat…).
 * Every body part is ONE InstancedMesh shared by all pedestrians, so 80 people cost ~16 draw calls.
 * Optional rigged GLB characters (public/models/manifest.json) replace some of them when present.
 */

type Mode = 'walk' | 'stand' | 'sit' | 'cycle';

interface Agent {
  mode: Mode;
  line: NavLine | null;
  s: number;
  dir: number;
  lateral: number;
  speed: number;
  baseSpeed: number;
  phase: number;
  x: number;
  z: number;
  yaw: number;
  height: number;
  build: number;
  colors: THREE.Color[];
  coatLong: boolean;
  bag: boolean;
  hat: boolean;
  timer: number;
  groupLead: Agent | null;
  gltf?: { root: THREE.Object3D; mixer: THREE.AnimationMixer };
}

// part order — must match PARTS below
const P = { torso: 0, coat: 1, head: 2, hair: 3, thighL: 4, thighR: 5, shinL: 6, shinR: 7, shoeL: 8, shoeR: 9, armL: 10, armR: 11, foreL: 12, foreR: 13, bag: 14, hat: 15 };

const SKIN = [0xf1c7a8, 0xe0ac8a, 0xc98e6b, 0x9a6648, 0x6e4631, 0xf5d5c0];
const HAIR = [0x2a1d16, 0x4a3324, 0x7b5a3c, 0xb08b5a, 0x1b1b1d, 0x8c8c8c, 0xd3b37f];
const COATS: Record<Season, number[]> = {
  winter: [0x1f2326, 0x2b3440, 0x4b3a2e, 0x6b6e70, 0x1c2a3b, 0x7b2d2d, 0x3e4a3a, 0xc9c2b3, 0x111214],
  autumn: [0x3a4a5a, 0x6b5440, 0x8a6a3f, 0x2f3b34, 0x7a3a2b, 0x2a2d33, 0xa7a091, 0x41556e],
  summer: [0xe8e4dc, 0x4f78a8, 0xc94f43, 0x2f6d5a, 0xd9b45a, 0x8aa4c6, 0x303236, 0xb98fb5, 0xf2f0ec],
};
const PANTS = [0x22262d, 0x2f3a4d, 0x3c3f45, 0x5a4b3d, 0x1a1b1e, 0x6d7380, 0x3f4f6a];
const SHOES = [0x15161a, 0x3a2a20, 0xe8e8e8, 0x55504a];

function capsule(r: number, len: number) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -(len / 2 + r), 0); // pivot at the top joint
  return g;
}

export class Pedestrians {
  readonly group = new THREE.Group();
  private parts: THREE.InstancedMesh[] = [];
  private agents: Agent[] = [];
  private rig = new THREE.Object3D();
  private nodes: Record<string, THREE.Object3D> = {};
  private bikes: THREE.InstancedMesh[] = [];
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private city: CityBuild | null = null;
  private max = 0;
  private season: Season = 'summer';
  private endIndex = new Map<string, NavLine[]>();
  private gltfTemplates: { scene: THREE.Object3D; clips: THREE.AnimationClip[] }[] = [];
  private gltfLoaded = false;
  private disposables: { dispose(): void }[] = [];

  constructor(private capacity: number) {
    const mats = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    this.disposables.push(mats, cloth, skin);
    const geos: [THREE.BufferGeometry, THREE.Material][] = [
      [new THREE.CapsuleGeometry(0.16, 0.36, 4, 12).translate(0, 0.32, 0), cloth], // torso (pivot hips)
      [new THREE.CylinderGeometry(0.19, 0.24, 0.62, 12, 1, true).translate(0, -0.12, 0), cloth], // long coat skirt
      [new THREE.SphereGeometry(0.105, 16, 12).scale(1, 1.12, 1.05), skin], // head
      [new THREE.SphereGeometry(0.112, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 1.08), mats], // hair cap
      [capsule(0.072, 0.34), cloth],
      [capsule(0.072, 0.34), cloth],
      [capsule(0.058, 0.36), cloth],
      [capsule(0.058, 0.36), cloth],
      [new THREE.BoxGeometry(0.1, 0.08, 0.26).translate(0, -0.04, 0.05), mats],
      [new THREE.BoxGeometry(0.1, 0.08, 0.26).translate(0, -0.04, 0.05), mats],
      [capsule(0.05, 0.25), cloth],
      [capsule(0.05, 0.25), cloth],
      [capsule(0.042, 0.23), skin],
      [capsule(0.042, 0.23), skin],
      [new THREE.BoxGeometry(0.28, 0.36, 0.14), mats], // backpack
      [new THREE.CylinderGeometry(0.1, 0.11, 0.1, 12).translate(0, 0.04, 0), mats], // beanie
    ];
    for (const [g, m] of geos) {
      const mesh = new THREE.InstancedMesh(g, m, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      // init colour buffer
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.parts.push(mesh);
      this.group.add(mesh);
      this.disposables.push(g);
    }
    // rig hierarchy (joint positions in metres for a 1.75 m person)
    const n = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.nodes[name] = o;
      return o;
    };
    const hips = n('hips', this.rig, 0, 0.95, 0);
    const chest = n('torso', hips, 0, 0.02, 0);
    n('coat', hips, 0, 0, 0);
    n('head', chest, 0, 0.72, 0.01);
    n('hair', chest, 0, 0.745, -0.005);
    n('hat', chest, 0, 0.8, -0.005);
    n('bag', chest, 0, 0.38, -0.2);
    const tl = n('thighL', hips, -0.095, 0.0, 0);
    const tr = n('thighR', hips, 0.095, 0.0, 0);
    const sl = n('shinL', tl, 0, -0.48, 0);
    const sr = n('shinR', tr, 0, -0.48, 0);
    n('shoeL', sl, 0, -0.47, 0);
    n('shoeR', sr, 0, -0.47, 0);
    const al = n('armL', chest, -0.22, 0.56, 0);
    const ar = n('armR', chest, 0.22, 0.56, 0);
    n('foreL', al, 0, -0.35, 0);
    n('foreR', ar, 0, -0.35, 0);

    // bicycles: 2 wheels + frame
    const bikeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.6 });
    const wheel = new THREE.TorusGeometry(0.34, 0.025, 6, 24).rotateY(Math.PI / 2);
    const frame = new THREE.BoxGeometry(0.04, 0.04, 0.95);
    for (const g of [wheel, wheel.clone(), frame]) {
      const m = new THREE.InstancedMesh(g, bikeMat, 24);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.bikes.push(m);
      this.group.add(m);
      this.disposables.push(g);
    }
    this.disposables.push(bikeMat);
    void this.loadGltfManifest();
  }

  /** Optional licensed GLB characters listed in /models/manifest.json: [{ "file": "x.glb" }] */
  private async loadGltfManifest() {
    try {
      if (document.getElementById('data-karljohan')) return; // single-file build: no external models
      const res = await fetch('./models/manifest.json');
      if (!res.ok) return;
      const list = (await res.json()) as { file: string }[];
      const loader = new GLTFLoader();
      for (const item of list) {
        try {
          const g = await loader.loadAsync('./models/' + item.file);
          if (g.animations.length) this.gltfTemplates.push({ scene: g.scene, clips: g.animations });
        } catch (e) {
          console.warn('[pedestrians] could not load', item.file, e);
        }
      }
    } catch {
      /* manifest is optional */
    } finally {
      this.gltfLoaded = true;
    }
  }

  setCity(city: CityBuild, season: Season, count: number) {
    this.clearGltf();
    this.city = city;
    this.season = season;
    this.max = Math.min(this.capacity, count);
    this.endIndex.clear();
    for (const l of city.walkLines)
      for (const p of [l.p[0], l.p[l.p.length - 1]]) {
        const k = Math.round(p[0] / 3) + ',' + Math.round(p[1] / 3);
        if (!this.endIndex.has(k)) this.endIndex.set(k, []);
        this.endIndex.get(k)!.push(l);
      }
    this.agents = [];
  }

  setDensity(count: number) {
    this.max = Math.min(this.capacity, count);
  }

  private makeAgent(mode: Mode, px: number, pz: number): Agent | null {
    const city = this.city!;
    const R = Math.random;
    const season = this.season;
    const coat = COATS[season][(R() * COATS[season].length) | 0];
    const colors = [
      new THREE.Color(coat), // torso
      new THREE.Color(coat).multiplyScalar(0.92), // coat skirt
      new THREE.Color(SKIN[(R() * SKIN.length) | 0]),
      new THREE.Color(HAIR[(R() * HAIR.length) | 0]),
    ];
    const pants = new THREE.Color(PANTS[(R() * PANTS.length) | 0]);
    const shoe = new THREE.Color(SHOES[(R() * SHOES.length) | 0]);
    const sleeve = season === 'summer' && R() < 0.6 ? colors[2] : colors[0];
    colors.push(pants, pants, pants, pants, shoe, shoe, colors[0], colors[0], sleeve, sleeve);
    colors.push(new THREE.Color([0x2b2f36, 0x5a3e2b, 0x8a1f24, 0x1f3a5a][(R() * 4) | 0]));
    colors.push(new THREE.Color([0x7a1f24, 0x1c1c1f, 0xd9d4c8, 0x2b4a6a, 0x6b6b6b][(R() * 5) | 0]));
    const a: Agent = {
      mode,
      line: null,
      s: 0,
      dir: R() < 0.5 ? 1 : -1,
      lateral: (R() - 0.5) * 1.4,
      speed: 0,
      baseSpeed: mode === 'cycle' ? 4 + R() * 1.8 : 1.05 + R() * 0.55,
      phase: R() * 10,
      x: px,
      z: pz,
      yaw: R() * 6.28,
      height: 0.92 + R() * 0.15,
      build: 0.9 + R() * 0.22,
      colors,
      coatLong: season !== 'summer' && R() < (season === 'winter' ? 0.55 : 0.3),
      bag: R() < 0.3,
      hat: season === 'winter' ? R() < 0.45 : R() < 0.06,
      timer: 3 + R() * 20,
      groupLead: null,
    };
    if (mode === 'walk' || mode === 'cycle') {
      const lines = mode === 'cycle' ? (city.cycleLines.length ? city.cycleLines : city.carLines) : city.walkLines;
      const line = this.pickLineNear(lines, px, pz, mode === 'cycle' ? 140 : 110);
      if (!line) return null;
      a.line = line;
      a.s = Math.random() * line.len;
      if (mode === 'cycle') a.lateral = line.kind === 'car' ? line.width / 2 - 0.9 : 0;
      else a.lateral = (Math.random() - 0.5) * Math.min(line.width * 0.6, 3);
    }
    return a;
  }

  private pickLineNear(lines: NavLine[], x: number, z: number, radius: number) {
    const cands = lines.filter((l) => l.p.some(([px, pz]) => Math.abs(px - x) < radius && Math.abs(pz - z) < radius));
    if (!cands.length) return null;
    // weight by length so busy long streets get more people
    let tot = 0;
    for (const c of cands) tot += c.len;
    let r = Math.random() * tot;
    for (const c of cands) if ((r -= c.len) <= 0) return c;
    return cands[0];
  }

  private populate(px: number, pz: number, night: boolean) {
    const city = this.city!;
    const want = Math.round(this.max * (night ? 0.45 : 1));
    let tries = 0;
    while (this.agents.length < want && tries++ < 12) {
      const r = Math.random();
      let a: Agent | null = null;
      if (r < 0.08 && city.benches.length) {
        const near = city.benches.filter((b) => Math.hypot(b.x - px, b.z - pz) < 90 && !this.agents.some((o) => o.mode === 'sit' && Math.hypot(o.x - b.x, o.z - b.z) < 0.5));
        const b = near[(Math.random() * near.length) | 0];
        if (b) {
          a = this.makeAgent('sit', b.x, b.z);
          if (a) {
            a.yaw = b.yaw;
            a.x = b.x + Math.sin(b.yaw) * 0.08 + Math.cos(b.yaw) * (Math.random() - 0.5) * 1.1;
            a.z = b.z + Math.cos(b.yaw) * 0.08 - Math.sin(b.yaw) * (Math.random() - 0.5) * 1.1;
          }
        }
      } else if (r < 0.17 && city.storefronts.length) {
        const near = city.storefronts.filter((s) => Math.hypot(s.x - px, s.z - pz) < 90);
        const s = near[(Math.random() * near.length) | 0];
        if (s) {
          a = this.makeAgent('stand', s.x, s.z);
          if (a) {
            a.yaw = s.yaw + Math.PI + (Math.random() - 0.5) * 0.8;
            a.x = s.x + (Math.random() - 0.5) * 1.5;
            a.z = s.z + (Math.random() - 0.5) * 1.5;
          }
        }
      } else if (r < 0.24 && !night) {
        if (this.agents.filter((x) => x.mode === 'cycle').length < 10) a = this.makeAgent('cycle', px, pz);
      } else {
        a = this.makeAgent('walk', px, pz);
        if (a && Math.random() < 0.28) {
          // a small group walking together
          const n = Math.random() < 0.7 ? 1 : 2;
          for (let i = 0; i < n; i++) {
            const f = this.makeAgent('walk', px, pz);
            if (!f) break;
            f.line = a.line;
            f.s = a.s - (Math.random() - 0.3) * 1.2;
            f.dir = a.dir;
            f.lateral = a.lateral + (i + 1) * 0.55 * (a.lateral > 0 ? -1 : 1);
            f.baseSpeed = a.baseSpeed;
            f.groupLead = a;
            this.agents.push(f);
          }
        }
      }
      if (a) {
        if (a.line) {
          sampleAlong(a.line.p, a.line.cum, a.s, this.tmp);
          a.x = this.tmp.x;
          a.z = this.tmp.z;
        }
        const d = Math.hypot(a.x - px, a.z - pz);
        // don't pop people into existence right in front of the player
        if (d < 25 && this.agents.length > 4 && a.mode !== 'sit') continue;
        this.agents.push(a);
      }
    }
  }

  private connected(line: NavLine, atEnd: boolean) {
    const p = atEnd ? line.p[line.p.length - 1] : line.p[0];
    const k = Math.round(p[0] / 3) + ',' + Math.round(p[1] / 3);
    return (this.endIndex.get(k) ?? []).filter((l) => l !== line);
  }

  update(dt: number, player: THREE.Vector3, night: boolean, rain: boolean) {
    if (!this.city) return;
    this.populate(player.x, player.z, night);
    // recycle far agents
    this.agents = this.agents.filter((a) => {
      const d = Math.hypot(a.x - player.x, a.z - player.z);
      const keep = d < 140;
      if (!keep && a.gltf) this.group.remove(a.gltf.root);
      return keep;
    });
    const col = this.city.collision;
    for (const a of this.agents) {
      if (a.mode === 'walk' || a.mode === 'cycle') {
        const line = a.line!;
        let target = a.baseSpeed * (rain && a.mode === 'walk' ? 1.15 : 1);
        if (a.groupLead && this.agents.includes(a.groupLead)) target = a.groupLead.speed;
        // personal space: slow down behind others, step aside for the player
        for (const o of this.agents) {
          if (o === a) continue;
          const dx = o.x - a.x, dz = o.z - a.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 4) continue;
          const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
          if (dx * fx + dz * fz > 0 && d2 < 1.2 && o.groupLead !== a && a.groupLead !== o) {
            target *= 0.55;
            a.lateral += (a.lateral >= o.lateral ? 1 : -1) * dt * 0.6;
          }
        }
        const pdx = player.x - a.x, pdz = player.z - a.z;
        if (pdx * pdx + pdz * pdz < 2.2) a.lateral += (a.lateral >= 0 ? 1 : -1) * dt * 1.2;
        a.lateral = THREE.MathUtils.clamp(a.lateral, -line.width * 0.45 - 0.6, line.width * 0.45 + 0.6);
        a.speed += (target - a.speed) * (1 - Math.exp(-2 * dt));
        a.s += a.speed * a.dir * dt;
        if (a.s < 0 || a.s > line.len) {
          const atEnd = a.s > line.len;
          const next = a.mode === 'walk' ? this.connected(line, atEnd) : [];
          if (next.length && Math.random() < 0.85) {
            const nl = next[(Math.random() * next.length) | 0];
            const end = atEnd ? line.p[line.p.length - 1] : line.p[0];
            const startsHere = Math.hypot(nl.p[0][0] - end[0], nl.p[0][1] - end[1]) < Math.hypot(nl.p[nl.p.length - 1][0] - end[0], nl.p[nl.p.length - 1][1] - end[1]);
            a.line = nl;
            a.dir = startsHere ? 1 : -1;
            a.s = startsHere ? 0.01 : nl.len - 0.01;
          } else {
            a.dir *= -1;
            a.s = THREE.MathUtils.clamp(a.s, 0, line.len);
          }
        }
        sampleAlong(a.line!.p, a.line!.cum, a.s, this.tmp);
        const dx = this.tmp.dx * a.dir, dz = this.tmp.dz * a.dir;
        let nx = this.tmp.x - this.tmp.dz * a.lateral;
        let nz = this.tmp.z + this.tmp.dx * a.lateral;
        // stay out of buildings (walk lines can hug facades)
        if (col.insideBuilding(nx, nz, 0.3)) {
          a.lateral *= 0.9;
          nx = this.tmp.x;
          nz = this.tmp.z;
        }
        a.x = nx;
        a.z = nz;
        const wantYaw = Math.atan2(dx, dz);
        let dy = wantYaw - a.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * (1 - Math.exp(-6 * dt));
        a.phase += (a.speed / (a.mode === 'cycle' ? 2.1 : 0.72)) * dt * Math.PI;
      } else {
        a.phase += dt * 0.8;
        a.timer -= dt;
        if (a.mode === 'stand' && a.timer < 0) {
          a.timer = 6 + Math.random() * 18;
          a.yaw += (Math.random() - 0.5) * 1.2;
        }
      }
    }
    this.writeInstances(player);
    this.updateGltf(dt, player);
  }

  private pose(a: Agent) {
    const N = this.nodes;
    for (const k in N) N[k].rotation.set(0, 0, 0);
    N.hips.position.set(0, 0.95, 0);
    N.torso.rotation.set(0, 0, 0);
    const ph = a.phase;
    if (a.mode === 'walk') {
      const sw = Math.sin(ph);
      const amp = Math.min(1, a.speed / 1.2);
      N.thighL.rotation.x = sw * 0.42 * amp;
      N.thighR.rotation.x = -sw * 0.42 * amp;
      N.shinL.rotation.x = Math.max(0, -Math.cos(ph)) * 0.75 * amp + 0.05;
      N.shinR.rotation.x = Math.max(0, Math.cos(ph)) * 0.75 * amp + 0.05;
      N.shoeL.rotation.x = -N.thighL.rotation.x * 0.3;
      N.shoeR.rotation.x = -N.thighR.rotation.x * 0.3;
      N.armL.rotation.x = -sw * 0.36 * amp;
      N.armR.rotation.x = sw * 0.36 * amp;
      N.armL.rotation.z = -0.08;
      N.armR.rotation.z = 0.08;
      N.foreL.rotation.x = -0.25 - Math.max(0, -sw) * 0.25 * amp;
      N.foreR.rotation.x = -0.25 - Math.max(0, sw) * 0.25 * amp;
      N.hips.position.y = 0.95 + Math.abs(Math.cos(ph)) * 0.03 * amp - 0.02;
      N.hips.rotation.y = sw * 0.07 * amp;
      N.torso.rotation.y = -sw * 0.12 * amp;
      N.torso.rotation.x = 0.04;
    } else if (a.mode === 'stand') {
      const s = Math.sin(ph * 0.7);
      N.hips.rotation.z = s * 0.015;
      N.thighL.rotation.z = -0.04;
      N.thighR.rotation.z = 0.06 + s * 0.02;
      N.armL.rotation.z = -0.06;
      N.armR.rotation.z = 0.06;
      N.foreR.rotation.x = Math.sin(ph * 0.21) > 0.3 ? -1.25 : -0.15; // occasionally checks a phone
      N.head.rotation.x = N.foreR.rotation.x < -1 ? 0.35 : 0;
      N.torso.rotation.x = 0.02;
    } else if (a.mode === 'sit') {
      N.hips.position.set(0, 0.5, 0);
      N.thighL.rotation.x = -1.45;
      N.thighR.rotation.x = -1.4;
      N.shinL.rotation.x = 1.45;
      N.shinR.rotation.x = 1.35;
      N.armL.rotation.x = -0.5;
      N.armR.rotation.x = -0.5;
      N.foreL.rotation.x = -0.6;
      N.foreR.rotation.x = -0.6;
      N.torso.rotation.x = -0.08 + Math.sin(ph * 0.4) * 0.02;
      N.head.rotation.y = Math.sin(ph * 0.17) * 0.5;
    } else if (a.mode === 'cycle') {
      N.hips.position.set(0, 0.92, -0.18);
      N.torso.rotation.x = 0.55;
      const c = ph * 1.0;
      N.thighL.rotation.x = -1.0 + Math.sin(c) * 0.45;
      N.thighR.rotation.x = -1.0 - Math.sin(c) * 0.45;
      N.shinL.rotation.x = 1.0 + Math.cos(c) * 0.45;
      N.shinR.rotation.x = 1.0 - Math.cos(c) * 0.45;
      N.armL.rotation.x = -1.0;
      N.armR.rotation.x = -1.0;
      N.head.rotation.x = -0.45;
    }
  }

  private writeInstances(player: THREE.Vector3) {
    const visible = this.agents.filter((a) => !a.gltf);
    // nearest first so capacity limits drop the far ones
    visible.sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    const n = Math.min(visible.length, this.capacity);
    const keys = Object.keys(P) as (keyof typeof P)[];
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    let bikeN = 0;
    for (let i = 0; i < n; i++) {
      const a = visible[i];
      this.pose(a);
      this.rig.position.set(a.x, 0, a.z);
      this.rig.rotation.set(0, a.yaw, 0);
      this.rig.scale.set(a.build * a.height, a.height, a.build * a.height);
      this.rig.updateMatrixWorld(true);
      for (const k of keys) {
        const mesh = this.parts[P[k]];
        let m = this.nodes[k].matrixWorld;
        if ((k === 'coat' && !a.coatLong) || (k === 'bag' && !a.bag) || (k === 'hat' && !a.hat)) m = hidden;
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, a.colors[P[k]]);
      }
      if (a.mode === 'cycle' && bikeN < 24) {
        const fwd = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        const base = new THREE.Vector3(a.x, 0.36, a.z);
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw);
        m4.compose(base.clone().addScaledVector(fwd, 0.5), q, new THREE.Vector3(1, 1, 1));
        this.bikes[0].setMatrixAt(bikeN, m4);
        m4.compose(base.clone().addScaledVector(fwd, -0.45), q, new THREE.Vector3(1, 1, 1));
        this.bikes[1].setMatrixAt(bikeN, m4);
        m4.compose(base.clone().setY(0.62), q, new THREE.Vector3(1, 1, 1));
        this.bikes[2].setMatrixAt(bikeN, m4);
        bikeN++;
      }
    }
    for (const mesh of this.parts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const b of this.bikes) {
      b.count = bikeN;
      b.instanceMatrix.needsUpdate = true;
    }
  }

  private updateGltf(dt: number, player: THREE.Vector3) {
    if (!this.gltfLoaded || !this.gltfTemplates.length) return;
    // promote up to 12 nearby walkers to rigged characters
    const withG = this.agents.filter((a) => a.gltf).length;
    if (withG < 12) {
      const cand = this.agents.find((a) => !a.gltf && a.mode === 'walk' && Math.hypot(a.x - player.x, a.z - player.z) > 30);
      if (cand) {
        const t = this.gltfTemplates[(Math.random() * this.gltfTemplates.length) | 0];
        const root = cloneSkinned(t.scene);
        root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        const mixer = new THREE.AnimationMixer(root);
        const clip = t.clips.find((c) => /walk/i.test(c.name)) ?? t.clips[0];
        const act = mixer.clipAction(clip);
        act.time = Math.random() * clip.duration;
        act.play();
        cand.gltf = { root, mixer };
        this.group.add(root);
      }
    }
    for (const a of this.agents) {
      if (!a.gltf) continue;
      a.gltf.root.position.set(a.x, 0, a.z);
      a.gltf.root.rotation.y = a.yaw;
      a.gltf.root.scale.setScalar(a.height);
      a.gltf.mixer.timeScale = a.speed / 1.3;
      a.gltf.mixer.update(dt);
    }
  }

  private clearGltf() {
    for (const a of this.agents) if (a.gltf) this.group.remove(a.gltf.root);
  }

  count() {
    return this.agents.length;
  }

  nearbyCount(p: THREE.Vector3, r: number) {
    let n = 0;
    for (const a of this.agents) if (Math.abs(a.x - p.x) < r && Math.abs(a.z - p.z) < r) n++;
    return n;
  }

  dispose() {
    this.clearGltf();
    this.parts.forEach((p) => p.dispose());
    this.bikes.forEach((p) => p.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}
