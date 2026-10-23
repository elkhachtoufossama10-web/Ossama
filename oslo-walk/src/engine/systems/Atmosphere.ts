import * as THREE from 'three';
import type { Season, TimePreset, Weather } from '../types';
import { shared } from '../materials';

interface Look {
  sunElev: number; // degrees
  sunAz: number; // degrees, 0 = north, 90 = east
  sunColor: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  zenith: number;
  horizon: number;
  clouds: number;
  cloudTint: number;
  fog: number;
  fogFar: number;
  exposure: number;
  bloom: number;
  bloomThreshold: number;
  night: number;
  stars: number;
  shadowSoft: number;
  envI: number;
}

const PRESETS: Record<TimePreset, Look> = {
  sunny: { sunElev: 38, sunAz: 205, sunColor: 0xfff0dc, sunI: 3.4, hemiSky: 0xc9d9f2, hemiGround: 0x7a6d5c, hemiI: 0.7, zenith: 0x2c6cc4, horizon: 0xbed6ee, clouds: 0.28, cloudTint: 0xffffff, fog: 0xc3d3e2, fogFar: 1100, exposure: 0.82, bloom: 0.1, bloomThreshold: 0.95, night: 0, stars: 0, shadowSoft: 2, envI: 1 },
  overcast: { sunElev: 32, sunAz: 200, sunColor: 0xe9eef3, sunI: 0.75, hemiSky: 0xd5dbe2, hemiGround: 0x5c5a57, hemiI: 1.55, zenith: 0x7f8a96, horizon: 0xc0c5ca, clouds: 1, cloudTint: 0xb9bec4, fog: 0xb3b9bf, fogFar: 650, exposure: 0.95, bloom: 0.06, bloomThreshold: 0.97, night: 0, stars: 0, shadowSoft: 9, envI: 0.9 },
  golden: { sunElev: 5.5, sunAz: 262, sunColor: 0xffaa62, sunI: 3.1, hemiSky: 0xf0c7a6, hemiGround: 0x46382f, hemiI: 0.55, zenith: 0x4372b5, horizon: 0xf6b277, clouds: 0.35, cloudTint: 0xffc49a, fog: 0xe1b58f, fogFar: 950, exposure: 0.9, bloom: 0.22, bloomThreshold: 0.88, night: 0.12, stars: 0, shadowSoft: 2, envI: 0.9 },
  blue: { sunElev: -5, sunAz: 280, sunColor: 0x9fb4e0, sunI: 0.0, hemiSky: 0x4d6aa0, hemiGround: 0x1a1b22, hemiI: 0.42, zenith: 0x0d1f45, horizon: 0x5a76a6, clouds: 0.25, cloudTint: 0x5d6f95, fog: 0x3b5079, fogFar: 800, exposure: 0.95, bloom: 0.35, bloomThreshold: 0.75, night: 0.85, stars: 0.25, shadowSoft: 4, envI: 0.55 },
  night: { sunElev: 32, sunAz: 150, sunColor: 0x8ea6d6, sunI: 0.18, hemiSky: 0x1d2c4c, hemiGround: 0x0c0d12, hemiI: 0.22, zenith: 0x020814, horizon: 0x101f3b, clouds: 0.2, cloudTint: 0x1c2438, fog: 0x0d1528, fogFar: 700, exposure: 1.0, bloom: 0.45, bloomThreshold: 0.72, night: 1, stars: 1, shadowSoft: 3, envI: 0.35 },
};

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;

const SKY_FS = /* glsl */ `
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uCloudTint, uMoonDir;
uniform float uClouds, uStars, uTime, uSunUp, uNightSky;
varying vec3 vDir;
float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.02+vec2(1.7,9.2); a*=0.5;} return v; }
void main(){
  vec3 d = normalize(vDir);
  float y = max(d.y, -0.2);
  float t = pow(clamp(1.0 - max(y,0.0), 0.0, 1.0), 2.6);
  vec3 col = mix(uZenith, uHorizon, t);
  // below horizon: fade into horizon colour (hidden by fog/city anyway)
  col = mix(col, uHorizon*0.8, smoothstep(0.0, -0.15, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0)*0.25 + pow(sd, 64.0)*0.6) * uSunUp;
  col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 18.0 * uSunUp;          // sun disc
  // moon
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85,0.9,1.0) * smoothstep(0.99955, 0.99975, md) * 3.0 * uNightSky;
  col += vec3(0.25,0.32,0.5) * pow(md, 40.0) * 0.25 * uNightSky;
  // stars
  if (uStars > 0.0 && d.y > 0.0) {
    vec2 sp = d.xz / (d.y + 0.3) * 220.0;
    float s = step(0.9965, h(floor(sp))) * (0.5 + 0.5*sin(uTime*2.0 + h(floor(sp)+3.0)*30.0));
    col += vec3(s) * uStars * smoothstep(0.0, 0.25, d.y) * 0.9;
  }
  // clouds on a virtual plane
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime*0.006, uTime*0.002);
    float c = fbm(cp);
    float cov = mix(0.72, 0.18, uClouds);
    float m = smoothstep(cov, cov + 0.25 + uClouds*0.2, c) * smoothstep(0.0, 0.18, d.y);
    vec3 cc = uCloudTint * (0.75 + 0.35*fbm(cp*2.0 + 4.0));
    cc += uSunColor * pow(sd, 5.0) * 0.5 * uSunUp;
    col = mix(col, cc, m * (0.6 + 0.4*uClouds));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Atmosphere {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private envScene = new THREE.Scene();
  private envSky: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  look: Look = { ...PRESETS.sunny };
  fogFar = 1000;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
        uSunColor: { value: new THREE.Color() },
        uCloudTint: { value: new THREE.Color() },
        uClouds: { value: 0.3 },
        uStars: { value: 0 },
        uSunUp: { value: 1 },
        uNightSky: { value: 0 },
        uTime: shared.uTime,
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0x3a3936 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    this.envScene.add(this.envSky, ground);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.Fog(0xffffff, 40, 1000);
  }

  setShadowQuality(size: number, extent: number) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== size) {
      s.mapSize.set(size, size);
      s.map?.dispose();
      s.map = null;
    }
    const cam = s.camera as THREE.OrthographicCamera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.near = 1;
    cam.far = 600;
    cam.updateProjectionMatrix();
  }

  apply(time: TimePreset, weather: Weather, season: Season) {
    const L: Look = { ...PRESETS[time] };
    const nightish = time === 'night' || time === 'blue';
    if (weather === 'overcast' || weather === 'rain') {
      const o = PRESETS.overcast;
      L.clouds = 1;
      L.cloudTint = nightish ? 0x222a3a : o.cloudTint;
      if (!nightish) {
        const k = time === 'golden' ? 0.55 : 0.85;
        L.sunI *= 1 - k * 0.8;
        L.hemiI = THREE.MathUtils.lerp(L.hemiI, o.hemiI, k);
        L.zenith = mixHex(L.zenith, o.zenith, k);
        L.horizon = mixHex(L.horizon, o.horizon, k);
        L.fog = mixHex(L.fog, o.fog, k);
        L.shadowSoft = o.shadowSoft;
      }
      L.stars = 0;
      L.fogFar *= weather === 'rain' ? 0.45 : 0.7;
      if (weather === 'rain') {
        L.zenith = mixHex(L.zenith, 0x3d434b, nightish ? 0.2 : 0.4);
        L.exposure *= 0.95;
      }
    }
    if (season === 'winter' && !nightish) {
      L.hemiGround = 0xc9ced6;
      L.hemiI *= 1.1;
    }
    this.look = L;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - L.sunElev), THREE.MathUtils.degToRad(180 - L.sunAz));
    // Three: -z = north. setFromSphericalCoords(theta) measures from +z towards +x, so convert compass azimuth
    const u = this.skyMat.uniforms;
    u.uZenith.value.setHex(L.zenith);
    u.uHorizon.value.setHex(L.horizon);
    u.uSunColor.value.setHex(L.sunColor);
    u.uCloudTint.value.setHex(L.cloudTint);
    u.uClouds.value = L.clouds;
    u.uStars.value = L.stars;
    u.uSunUp.value = time === 'night' ? 0 : THREE.MathUtils.clamp((L.sunElev + 4) / 8, 0, 1) * (1 - 0.85 * Math.max(0, L.clouds - 0.6) / 0.4);
    u.uNightSky.value = time === 'night' ? 1 : 0;
    u.uSunDir.value.copy(sunDir);
    if (time === 'night') u.uMoonDir.value.copy(sunDir); // the "sun" light is moonlight at night

    this.sun.color.setHex(L.sunColor);
    this.sun.intensity = L.sunI;
    this.sun.visible = L.sunI > 0.02;
    this.sunDir.copy(sunDir.y < 0.05 ? new THREE.Vector3(sunDir.x, 0.05, sunDir.z).normalize() : sunDir);
    this.sun.shadow.radius = L.shadowSoft;
    this.sun.shadow.intensity = THREE.MathUtils.clamp(L.sunI / 2.5, 0.25, 1);
    this.hemi.color.setHex(L.hemiSky);
    this.hemi.groundColor.setHex(L.hemiGround);
    this.hemi.intensity = L.hemiI;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(L.fog);
    this.fogFar = L.fogFar;
    fog.far = L.fogFar;
    fog.near = Math.min(80, L.fogFar * 0.05);
    shared.uNight.value = L.night;
    shared.uWet.value = weather === 'rain' ? 1 : weather === 'wet' ? 0.75 : 0;
    shared.uSnow.value = season === 'winter' ? 1 : 0;
    shared.uAutumn.value = season === 'autumn' ? 1 : 0;
    this.renderer.toneMappingExposure = L.exposure;
    this.updateEnvironment(L.envI);
  }

  readonly sunDir = new THREE.Vector3(0, 1, 0);

  private updateEnvironment(intensity: number) {
    const prevBg = this.envScene.background;
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = intensity;
    this.envScene.background = prevBg;
  }

  /** Keep the shadow camera centred on the player (snapped to texels to avoid shimmering). */
  follow(target: THREE.Vector3) {
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const cx = Math.round(target.x / texel) * texel;
    const cz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx, 0, cz).addScaledVector(this.sunDir, 300);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(target);
  }

  dispose() {
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.envSky.geometry.dispose();
    this.skyMat.dispose();
  }
}

function mixHex(a: number, b: number, t: number) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}
