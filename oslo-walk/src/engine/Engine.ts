import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import type { AreaData, LocationId, Quality, Settings } from './types';
import { isNight } from './types';
import { createMaterials, makeWaterNormals, shared, type MaterialKit } from './materials';
import { buildCity, type CityBuild } from './world/City';
import { Atmosphere } from './systems/Atmosphere';
import { Player } from './systems/Player';
import { Pedestrians } from './systems/Pedestrians';
import { Traffic } from './systems/Traffic';
import { Precipitation } from './systems/Weather';
import { StreetLights } from './systems/StreetLights';
import { CityAudio } from './systems/Audio';
import { distToSegment } from './geo';

export interface EngineEvents {
  progress(p: number, label: string): void;
  ready(): void;
  error(msg: string): void;
  location(street: string): void;
  lock(locked: boolean): void;
  stats(s: { fps: number; scale: number; people: number }): void;
}

const QUALITY: Record<Quality, { pr: number; shadow: number; extent: number; tex: number; peds: number; cars: number; lights: number; bloom: boolean; ao: boolean; water: boolean; rain: number }> = {
  low: { pr: 0.85, shadow: 1024, extent: 70, tex: 1024, peds: 34, cars: 10, lights: 4, bloom: false, ao: false, water: false, rain: 3500 },
  high: { pr: 1.25, shadow: 2048, extent: 95, tex: 2048, peds: 70, cars: 18, lights: 8, bloom: true, ao: false, water: true, rain: 7000 },
  ultra: { pr: 2, shadow: 4096, extent: 120, tex: 2048, peds: 110, cars: 26, lights: 12, bloom: true, ao: true, water: true, rain: 10000 },
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2600);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private gtao: GTAOPass | null = null;
  private atmosphere: Atmosphere;
  readonly player: Player;
  private mats: MaterialKit | null = null;
  private city: CityBuild | null = null;
  private data: AreaData | null = null;
  private peds: Pedestrians;
  private traffic: Traffic;
  private precip: Precipitation;
  private lights: StreetLights;
  readonly audio = new CityAudio();
  private water: THREE.Mesh | null = null;
  private waterNormals: THREE.Texture;
  private clock = new THREE.Clock();
  private raf = 0;
  private settings: Settings;
  private exploring = false;
  private orbit = 0;
  private locTimer = 0;
  private lastStreet = '';
  private fpsAcc = { t: 0, n: 0 };
  private scale = 1;
  private disposed = false;
  private loadToken = 0;
  private resizeObs: ResizeObserver;

  constructor(private container: HTMLElement, settings: Settings, private ev: EngineEvents) {
    this.settings = { ...settings };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onRestored, false);

    this.atmosphere = new Atmosphere(this.renderer, this.scene);
    this.player = new Player(this.camera, this.renderer.domElement);
    this.player.onStep = (s) => this.audio.step(s, shared.uWet.value > 0.3, shared.uSnow.value > 0.5);
    this.player.onLockChange = (l) => this.ev.lock(l);
    this.peds = new Pedestrians(QUALITY.ultra.peds);
    this.traffic = new Traffic(QUALITY.ultra.cars + 6);
    this.precip = new Precipitation(QUALITY[settings.quality].rain);
    this.lights = new StreetLights(QUALITY[settings.quality].lights);
    this.scene.add(this.peds.group, this.traffic.group, this.precip.group, this.lights.group);
    this.waterNormals = makeWaterNormals(256);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.applyQuality(settings.quality, true);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ loading
  async load(location: LocationId) {
    const token = ++this.loadToken;
    this.ev.progress(0.02, 'Fetching OpenStreetMap data');
    let data: AreaData;
    try {
      data = await fetchWithProgress<AreaData>(`./data/${location}.json`, (p) => this.ev.progress(0.02 + p * 0.5, 'Fetching OpenStreetMap data'));
    } catch (e) {
      this.ev.error(`Could not load the map data for this area (${(e as Error).message}). Check that public/data/${location}.json exists, then retry.`);
      return;
    }
    if (token !== this.loadToken || this.disposed) return;
    this.ev.progress(0.55, 'Building streets and facades');
    await nextFrame();
    try {
      this.clearCity();
      if (!this.mats) this.mats = createMaterials(QUALITY[this.settings.quality].tex, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
      const city = buildCity(data, location, this.mats, this.settings.quality);
      if (token !== this.loadToken) {
        city.dispose();
        return;
      }
      this.city = city;
      this.data = data;
      this.scene.add(city.group);
      this.ev.progress(0.8, 'Placing water, lights and people');
      await nextFrame();
      this.buildWater();
      this.player.collision = city.collision;
      const [sx, sz] = city.collision.nearestWalkable(data.spawn[0], data.spawn[1]);
      this.player.spawn(sx, sz, data.spawn[2]);
      this.lights.setLamps(city.lamps);
      this.peds.setCity(city, this.settings.season, QUALITY[this.settings.quality].peds);
      this.traffic.setLines(city.carLines, QUALITY[this.settings.quality].cars);
      this.applyEnvironment();
      this.ev.progress(0.95, 'Compiling shaders');
      await nextFrame();
      this.renderer.compile(this.scene, this.camera);
      this.lastStreet = '';
      this.ev.progress(1, 'Ready');
      this.ev.ready();
    } catch (e) {
      console.error(e);
      this.ev.error(`Something went wrong while building ${data.title}: ${(e as Error).message}`);
    }
  }

  private clearCity() {
    if (this.city) {
      this.scene.remove(this.city.group);
      this.city.dispose();
      this.city = null;
    }
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      (this.water.material as THREE.Material).dispose();
      this.water = null;
    }
  }

  private buildWater() {
    if (!this.city || !this.city.hasWater) return;
    const [x0, z0, x1, z1] = this.city.waterBounds;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    const q = QUALITY[this.settings.quality];
    if (q.water) {
      const w = new Water(geo, {
        textureWidth: 1024,
        textureHeight: 1024,
        waterNormals: this.waterNormals,
        sunDirection: this.atmosphere.sunDir.clone(),
        sunColor: 0xffffff,
        waterColor: 0x0b2a33,
        distortionScale: 2.4,
        fog: true,
      });
      w.material.uniforms.size.value = 3.5;
      this.water = w;
    } else {
      this.water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0d2b33, roughness: 0.08, metalness: 0.4, normalMap: this.waterNormals, normalScale: new THREE.Vector2(0.4, 0.4) }));
    }
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set((x0 + x1) / 2, this.city.waterLevel, (z0 + z1) / 2);
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  // ------------------------------------------------------------------ settings
  update(next: Partial<Settings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...next };
    const s = this.settings;
    if (next.quality && next.quality !== prev.quality) {
      this.applyQuality(next.quality, false);
      if (this.city) {
        this.peds.setDensity(QUALITY[s.quality].peds);
        this.traffic.setLines(this.city.carLines, QUALITY[s.quality].cars);
        this.clearWaterOnly();
        this.buildWater();
      }
    }
    if (next.time || next.weather || next.season || next.quality) this.applyEnvironment();
    if (next.season && next.season !== prev.season && this.city) this.peds.setCity(this.city, s.season, QUALITY[s.quality].peds);
    this.player.speedMul = s.walkSpeed;
    this.player.reducedMotion = s.reducedMotion;
    this.player.setSensitivity(s.sensitivity);
    this.audio.setVolume(s.volume, s.muted);
  }

  private clearWaterOnly() {
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      (this.water.material as THREE.Material).dispose();
      this.water = null;
    }
  }

  private applyQuality(q: Quality, initial: boolean) {
    const Q = QUALITY[q];
    this.scale = 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    this.renderer.shadowMap.enabled = true;
    this.atmosphere.setShadowQuality(Q.shadow, Q.extent);
    this.bloom.enabled = Q.bloom;
    if (Q.ao && !this.gtao) {
      this.gtao = new GTAOPass(this.scene, this.camera, 512, 512);
      this.gtao.blendIntensity = 0.75;
      this.composer.insertPass(this.gtao, 1);
    }
    if (this.gtao) this.gtao.enabled = Q.ao;
    if (!initial) {
      this.lights.setMaxLights(Q.lights);
      this.scene.remove(this.precip.group);
      this.precip.dispose();
      this.precip = new Precipitation(Q.rain);
      this.scene.add(this.precip.group);
    }
    this.resize();
  }

  private applyEnvironment() {
    const s = this.settings;
    this.atmosphere.apply(s.time, s.weather, s.season);
    const L = this.atmosphere.look;
    this.bloom.strength = L.bloom;
    this.bloom.threshold = L.bloomThreshold;
    this.bloom.radius = 0.5;
    this.precip.set(s.weather === 'rain' ? (s.season === 'winter' ? 'snow' : 'rain') : s.season === 'winter' && s.weather === 'overcast' ? 'snow' : 'none');
    if (this.water instanceof Water) {
      const u = this.water.material.uniforms;
      u.sunDirection.value.copy(this.atmosphere.sunDir);
      u.sunColor.value.setHex(isNight(s.time) ? 0x334466 : L.sunColor);
      u.waterColor.value.setHex(isNight(s.time) ? 0x020a10 : s.weather === 'overcast' || s.weather === 'rain' ? 0x13262b : 0x0b2a33);
    }
    this.tintTrees();
  }

  private tintTrees() {
    if (!this.city) return;
    const { crown, base } = this.city.trees;
    const season = this.settings.season;
    const c = new THREE.Color();
    for (let i = 0; i < crown.count; i++) {
      c.copy(base[i]);
      if (season === 'autumn') {
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        const k = (i * 0.618) % 1;
        c.setHSL(0.05 + k * 0.09, 0.62 + k * 0.2, 0.3 + k * 0.1);
        if (k > 0.82) c.copy(base[i]); // a few trees still green
      } else if (season === 'winter') {
        c.setRGB(0.62, 0.62, 0.64).lerp(new THREE.Color(0.32, 0.28, 0.25), ((i * 0.37) % 1) * 0.5);
      }
      crown.setColorAt(i, c);
    }
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    (crown.material as THREE.MeshStandardMaterial).opacity = 1;
  }

  // ------------------------------------------------------------------ control
  /** Begin exploring (called from a user gesture so audio + pointer lock are allowed). */
  async begin() {
    this.exploring = true;
    this.player.enabled = true;
    await this.audio.start();
    this.audio.setVolume(this.settings.volume, this.settings.muted);
    this.lockPointer();
  }

  lockPointer() {
    if (matchMedia('(pointer: coarse)').matches) return;
    try {
      this.player.controls.lock();
    } catch {
      /* pointer lock refused — mouse drag still not available, but keys work */
    }
  }

  pause() {
    this.player.enabled = false;
    this.player.controls.unlock();
  }

  resume() {
    this.player.enabled = true;
    this.lockPointer();
  }

  get isExploring() {
    return this.exploring;
  }

  respawn() {
    if (!this.data || !this.city) return;
    const [sx, sz] = this.city.collision.nearestWalkable(this.data.spawn[0], this.data.spawn[1]);
    this.player.spawn(sx, sz, this.data.spawn[2]);
  }

  setStick(x: number, y: number) {
    this.player.stick.set(x, y);
  }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    shared.uTime.value += dt;
    const night = shared.uNight.value;
    const cam = this.camera.position;
    if (this.city) {
      if (this.exploring) this.player.update(dt);
      else this.cinematic(dt);
      this.peds.update(dt, this.player.position, night > 0.6, this.settings.weather === 'rain');
      this.traffic.update(dt, this.player.position, night);
      this.lights.update(dt, this.player.position, night > 0.5 ? 1 : night * 0.8, shared.uWet.value);
      this.precip.update(dt, cam, night);
      this.atmosphere.follow(this.player.position);
      if (this.water instanceof Water) this.water.material.uniforms.time.value += dt * 0.6;
      this.audio.update(dt, {
        night,
        rain: this.precip.mode === 'rain',
        snow: this.precip.mode === 'snow',
        nearestCar: this.traffic.nearest(this.player.position),
        water: this.distanceToWater(),
        people: this.peds.nearbyCount(this.player.position, 25),
        day: night < 0.3,
        nearRoad: this.distanceToRoad(),
      });
      this.locTimer -= dt;
      if (this.locTimer < 0) {
        this.locTimer = 0.6;
        this.reportStreet();
      }
    }
    this.composer.render(dt);
    this.adaptive(dt);
  };

  private cinematic(dt: number) {
    // slow drift around the spawn point behind the welcome screen
    if (!this.data) return;
    this.orbit += dt * 0.035;
    const [sx, sz, yaw] = this.data.spawn;
    const r = 6;
    const x = sx + Math.sin(this.orbit) * r * 0.4;
    const z = sz + Math.cos(this.orbit) * r * 0.4;
    this.player.position.set(x, 0, z);
    this.camera.position.set(x, 1.68, z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(0.02, yaw + Math.sin(this.orbit * 0.7) * 0.5, 0, 'YXZ'));
  }

  private distanceToWater() {
    if (!this.data || !this.data.water.length) return 999;
    const p = this.player.position;
    let best = 999;
    for (const w of this.data.water)
      for (let i = 0; i < w.length; i += 2) {
        const a = w[i], b = w[(i + 2) % w.length];
        best = Math.min(best, distToSegment(p.x, p.z, a[0], a[1], b[0], b[1]).d);
      }
    return best;
  }

  private distanceToRoad() {
    if (!this.city) return 999;
    const p = this.player.position;
    let best = 999;
    for (const l of this.city.carLines) {
      const q = l.p;
      if (Math.abs(q[0][0] - p.x) > 400 && Math.abs(q[q.length - 1][0] - p.x) > 400) continue;
      for (let i = 1; i < q.length; i++) best = Math.min(best, distToSegment(p.x, p.z, q[i - 1][0], q[i - 1][1], q[i][0], q[i][1]).d);
    }
    return best;
  }

  private reportStreet() {
    if (!this.city || !this.data) return;
    const p = this.player.position;
    let best = 22, name = '';
    for (const n of this.city.named) {
      const q = n.p;
      for (let i = 1; i < q.length; i++) {
        const d = distToSegment(p.x, p.z, q[i - 1][0], q[i - 1][1], q[i][0], q[i][1]).d;
        if (d < best) {
          best = d;
          name = n.n;
        }
      }
    }
    const label = name || this.data.title;
    if (label !== this.lastStreet) {
      this.lastStreet = label;
      this.ev.location(label);
    }
  }

  private adaptive(dt: number) {
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t < 2) return;
    const fps = this.fpsAcc.n / this.fpsAcc.t;
    this.fpsAcc = { t: 0, n: 0 };
    const maxPr = Math.min(window.devicePixelRatio || 1, QUALITY[this.settings.quality].pr);
    if (fps < 38 && this.scale > 0.55) this.scale = Math.max(0.55, this.scale - 0.12);
    else if (fps > 57 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.06);
    const pr = maxPr * this.scale;
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.01) {
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
    this.ev.stats({ fps: Math.round(fps), scale: this.scale, people: this.peds.count() });
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 78 : 70;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  private onVisibility = () => {
    if (document.hidden) this.audio.suspend();
    else if (this.exploring) void this.audio.start();
    this.clock.getDelta();
  };

  private onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.raf);
    this.ev.error('The graphics context was lost (the GPU was reset or ran out of memory). It will recover automatically; if not, lower the graphics quality and reload.');
  };

  private onRestored = () => {
    this.mats?.dispose();
    this.mats = null;
    this.loop();
    void this.load(this.settings.location);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearCity();
    this.mats?.dispose();
    this.peds.dispose();
    this.traffic.dispose();
    this.precip.dispose();
    this.lights.dispose();
    this.atmosphere.dispose();
    this.player.dispose();
    this.audio.dispose();
    this.waterNormals.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

async function fetchWithProgress<T>(url: string, onp: (p: number) => void): Promise<T> {
  // Single-file builds embed the data as <script type="application/json" id="data-<area>">
  const id = 'data-' + (url.split('/').pop() ?? '').replace('.json', '');
  const inline = document.getElementById(id);
  if (inline?.textContent) {
    onp(1);
    return JSON.parse(inline.textContent) as T;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const j = await res.json();
    onp(1);
    return j as T;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onp(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}
