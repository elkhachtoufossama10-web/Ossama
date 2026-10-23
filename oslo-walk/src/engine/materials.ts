import * as THREE from 'three';

/** Uniforms shared by every custom material so weather / time changes apply instantly. */
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 day … 1 full night (drives emissive windows)
  uWet: { value: 0 }, // 0 dry … 1 soaked
  uSnow: { value: 0 }, // 0 none … 1 snow cover
  uAutumn: { value: 0 }, // fallen leaves on the ground
};

const GLSL_NOISE = /* glsl */ `
float ow_hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float ow_noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(ow_hash(i),ow_hash(i+vec2(1,0)),f.x), mix(ow_hash(i+vec2(0,1)),ow_hash(i+vec2(1,1)),f.x), f.y); }
float ow_fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*ow_noise(p); p*=2.03; a*=0.5; } return v; }
`;

// ---------------------------------------------------------------- canvas textures
function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

function speckle(g: CanvasRenderingContext2D, size: number, n: number, cols: string[], maxSz = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.globalAlpha = 0.15 + Math.random() * 0.45;
    const s = 0.6 + Math.random() * maxSz;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  g.globalAlpha = 1;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, aniso: number) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Height canvas → tangent-space normal map. */
function heightToNormal(h: HTMLCanvasElement, strength: number) {
  const size = h.width;
  const src = h.getContext('2d')!.getImageData(0, 0, size, size).data;
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const H = (x: number, y: number) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

export interface SurfaceSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** metres covered by one texture tile */
  tile: number;
}

/** Granite slabs — Oslo's typical pavement (and the Karl Johan surface). */
function makePavers(size: number, aniso: number, light: boolean): SurfaceSet {
  const tile = 4.8;
  const px = size / tile;
  const col = canvas(size), hgt = canvas(size), rgh = canvas(size);
  col.g.fillStyle = light ? '#b1aca2' : '#9d9890';
  col.g.fillRect(0, 0, size, size);
  hgt.g.fillStyle = '#c8c8c8';
  hgt.g.fillRect(0, 0, size, size);
  rgh.g.fillStyle = '#d8d8d8';
  rgh.g.fillRect(0, 0, size, size);
  const rowH = 0.4 * px;
  const slabW = 0.8 * px;
  for (let r = 0; r * rowH < size; r++) {
    const off = (r % 2) * slabW * 0.5;
    for (let x = -slabW; x < size + slabW; x += slabW) {
      const base = light ? 172 + Math.random() * 24 : 150 + Math.random() * 24;
      const warm = Math.random() * 8;
      col.g.fillStyle = `rgb(${base + warm + 4},${base + warm * 0.6 + 1},${base - 6})`;
      col.g.fillRect(x + off + 1.5, r * rowH + 1.5, slabW - 3, rowH - 3);
      hgt.g.fillStyle = `rgb(${200 + Math.random() * 30},0,0)`;
      hgt.g.fillRect(x + off + 2, r * rowH + 2, slabW - 4, rowH - 4);
      const rv = 170 + Math.random() * 60;
      rgh.g.fillStyle = `rgb(${rv},${rv},${rv})`;
      rgh.g.fillRect(x + off + 2, r * rowH + 2, slabW - 4, rowH - 4);
    }
  }
  speckle(col.g, size, size * 60, ['#6d6b68', '#b9b5ac', '#55524f', '#c9c4ba', '#7e7a74'], 1.6);
  speckle(hgt.g, size, size * 30, ['#ffffff', '#909090'], 1.4);
  // stains, chewing gum, wear
  for (let i = 0; i < 26; i++) {
    col.g.fillStyle = `rgba(40,36,32,${0.04 + Math.random() * 0.08})`;
    col.g.beginPath();
    col.g.arc(Math.random() * size, Math.random() * size, 4 + Math.random() * size * 0.05, 0, 7);
    col.g.fill();
  }
  return {
    map: toTexture(col.c, true, aniso),
    normalMap: toTexture(heightToNormal(hgt.c, 3), false, aniso),
    roughnessMap: toTexture(rgh.c, false, aniso),
    tile,
  };
}

function makeAsphalt(size: number, aniso: number): SurfaceSet {
  const tile = 6;
  const col = canvas(size), hgt = canvas(size), rgh = canvas(size);
  col.g.fillStyle = '#4c4d50';
  col.g.fillRect(0, 0, size, size);
  speckle(col.g, size, size * 140, ['#2b2c2e', '#55565a', '#47474a', '#606064', '#343436'], 1.8);
  for (let i = 0; i < 10; i++) {
    col.g.fillStyle = `rgba(${Math.random() < 0.5 ? 25 : 80},${Math.random() < 0.5 ? 25 : 80},${Math.random() < 0.5 ? 28 : 84},0.08)`;
    col.g.fillRect(Math.random() * size, Math.random() * size, 40 + Math.random() * size * 0.4, 30 + Math.random() * size * 0.3);
  }
  col.g.strokeStyle = 'rgba(18,18,20,0.5)';
  col.g.lineWidth = 1.4;
  for (let i = 0; i < 8; i++) {
    col.g.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    col.g.moveTo(x, y);
    for (let k = 0; k < 10; k++) {
      x += (Math.random() - 0.5) * 50;
      y += Math.random() * 40;
      col.g.lineTo(x, y);
    }
    col.g.stroke();
  }
  hgt.g.fillStyle = '#808080';
  hgt.g.fillRect(0, 0, size, size);
  speckle(hgt.g, size, size * 120, ['#ffffff', '#000000', '#a0a0a0'], 1.6);
  rgh.g.fillStyle = '#e0e0e0';
  rgh.g.fillRect(0, 0, size, size);
  speckle(rgh.g, size, size * 40, ['#b0b0b0', '#ffffff'], 2);
  return {
    map: toTexture(col.c, true, aniso),
    normalMap: toTexture(heightToNormal(hgt.c, 2), false, aniso),
    roughnessMap: toTexture(rgh.c, false, aniso),
    tile,
  };
}

/** Small granite setts (cobbles) for squares. */
function makeSetts(size: number, aniso: number): SurfaceSet {
  const tile = 2.4;
  const px = size / tile;
  const col = canvas(size), hgt = canvas(size), rgh = canvas(size);
  col.g.fillStyle = '#4f4c49';
  col.g.fillRect(0, 0, size, size);
  hgt.g.fillStyle = '#202020';
  hgt.g.fillRect(0, 0, size, size);
  rgh.g.fillStyle = '#c0c0c0';
  rgh.g.fillRect(0, 0, size, size);
  const s = 0.12 * px;
  for (let r = 0; r * s < size; r++)
    for (let c = -1; c * s < size + s; c++) {
      const x = c * s + (r % 2) * s * 0.5 + (Math.random() - 0.5) * s * 0.12;
      const y = r * s + (Math.random() - 0.5) * s * 0.1;
      const v = 105 + Math.random() * 60;
      col.g.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`;
      col.g.beginPath();
      col.g.roundRect(x + 1.5, y + 1.5, s - 3, s - 3, s * 0.22);
      col.g.fill();
      const grd = hgt.g.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.6);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, '#606060');
      hgt.g.fillStyle = grd;
      hgt.g.beginPath();
      hgt.g.roundRect(x + 1.5, y + 1.5, s - 3, s - 3, s * 0.22);
      hgt.g.fill();
    }
  speckle(col.g, size, size * 40, ['#3d3a37', '#8a867f'], 1.2);
  return {
    map: toTexture(col.c, true, aniso),
    normalMap: toTexture(heightToNormal(hgt.c, 4), false, aniso),
    roughnessMap: toTexture(rgh.c, false, aniso),
    tile,
  };
}

function makeGrass(size: number, aniso: number): SurfaceSet {
  const tile = 3;
  const col = canvas(size), hgt = canvas(size), rgh = canvas(size);
  col.g.fillStyle = '#4b6b33';
  col.g.fillRect(0, 0, size, size);
  speckle(col.g, size, size * 200, ['#3f5d2a', '#5c7d3c', '#6c8a45', '#36521f', '#7a8f4e'], 2.2);
  hgt.g.fillStyle = '#808080';
  hgt.g.fillRect(0, 0, size, size);
  speckle(hgt.g, size, size * 150, ['#ffffff', '#202020'], 2);
  rgh.g.fillStyle = '#f0f0f0';
  rgh.g.fillRect(0, 0, size, size);
  return {
    map: toTexture(col.c, true, aniso),
    normalMap: toTexture(heightToNormal(hgt.c, 1.5), false, aniso),
    roughnessMap: toTexture(rgh.c, false, aniso),
    tile,
  };
}

function makePlanks(size: number, aniso: number): SurfaceSet {
  const tile = 3.2;
  const px = size / tile;
  const col = canvas(size), hgt = canvas(size), rgh = canvas(size);
  const w = 0.16 * px;
  for (let x = 0; x < size; x += w) {
    const v = 92 + Math.random() * 40;
    col.g.fillStyle = `rgb(${v + 22},${v + 6},${v - 18})`;
    col.g.fillRect(x, 0, w - 2, size);
    for (let k = 0; k < 40; k++) {
      col.g.fillStyle = `rgba(40,25,15,${Math.random() * 0.12})`;
      col.g.fillRect(x + Math.random() * w, Math.random() * size, 1, 20 + Math.random() * 120);
    }
    hgt.g.fillStyle = '#d0d0d0';
    hgt.g.fillRect(x + 1, 0, w - 3, size);
    const rv = 180 + Math.random() * 50;
    rgh.g.fillStyle = `rgb(${rv},${rv},${rv})`;
    rgh.g.fillRect(x, 0, w, size);
  }
  return {
    map: toTexture(col.c, true, aniso),
    normalMap: toTexture(heightToNormal(hgt.c, 2.5), false, aniso),
    roughnessMap: toTexture(rgh.c, false, aniso),
    tile,
  };
}

/** Tileable water normal map (sum of directional waves + noise). */
export function makeWaterNormals(size: number) {
  const hgt = canvas(size);
  const img = hgt.g.createImageData(size, size);
  const waves = Array.from({ length: 9 }, () => ({
    kx: Math.round((Math.random() - 0.5) * 16),
    ky: Math.round((Math.random() - 0.5) * 16),
    a: Math.random(),
    p: Math.random() * 6.28,
  }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let h = 0;
      for (const w of waves) h += w.a * Math.sin(((w.kx * x + w.ky * y) / size) * 6.2832 + w.p);
      const v = 128 + h * 22;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  hgt.g.putImageData(img, 0, 0);
  const t = toTexture(heightToNormal(hgt.c, 4), false, 4);
  return t;
}

// ---------------------------------------------------------------- shader patching
/** Adds macro variation, puddles (wet), snow and fallen leaves to ground-type materials. */
function patchGround(m: THREE.MeshStandardMaterial, opts: { tile: number; puddles: number; snowable: boolean; leaves: boolean }) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { uTile: { value: opts.tile } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOwWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOwWorld = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vOwWorld;\nuniform float uTime,uNight,uWet,uSnow,uAutumn,uTile;\n${GLSL_NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 wp = vOwWorld.xz;
        float macro = ow_fbm(wp*0.035);
        diffuseColor.rgb *= 0.84 + 0.32*macro;
        float grime = ow_fbm(wp*0.21+7.0);
        diffuseColor.rgb *= 0.92 + 0.12*grime;
        float puddle = smoothstep(0.56, 0.68, ow_fbm(wp*0.09 + 3.1)) * ${opts.puddles.toFixed(2)};
        float wetAmt = uWet * (0.55 + 0.45*puddle);
        diffuseColor.rgb *= 1.0 - 0.38*wetAmt;
        ${opts.leaves ? `float lf = step(0.80, ow_noise(wp*5.1)) * step(0.45, ow_fbm(wp*0.3)) * uAutumn;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.55,0.24,0.05), vec3(0.75,0.52,0.12), ow_noise(wp*11.0)), lf);` : ''}
        ${opts.snowable ? `float snowMask = uSnow * smoothstep(0.25, 0.6, ow_fbm(wp*0.25) + uSnow*0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9,0.9,0.9) * (0.93 + 0.07*ow_noise(wp*3.0)), snowMask);` : 'float snowMask = 0.0;'}
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06 + 0.25*(1.0-puddle), wetAmt);
        roughnessFactor = mix(roughnessFactor, 0.55, snowMask);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), clamp(wetAmt*puddle*1.2 + snowMask, 0.0, 1.0)));`,
      );
  };
  m.customProgramCacheKey = () => `ground-${opts.puddles}-${opts.snowable}-${opts.leaves}`;
}

export interface MaterialKit {
  sidewalk: THREE.MeshStandardMaterial;
  pedestrian: THREE.MeshStandardMaterial;
  plaza: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  pier: THREE.MeshStandardMaterial;
  quay: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  dispose(): void;
}

function surface(set: SurfaceSet, opts: { puddles: number; snowable: boolean; leaves: boolean; normalScale?: number }) {
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 0.6, opts.normalScale ?? 0.6),
    envMapIntensity: 0.55,
  });
  patchGround(m, { tile: set.tile, ...opts });
  return m;
}

export function createMaterials(texSize: number, aniso: number): MaterialKit {
  const pavers = makePavers(texSize, aniso, false);
  const paversLight = makePavers(texSize, aniso, true);
  const asphalt = makeAsphalt(texSize, aniso);
  const setts = makeSetts(texSize, aniso);
  const grass = makeGrass(Math.min(texSize, 1024), aniso);
  const planks = makePlanks(Math.min(texSize, 1024), aniso);

  const kit: MaterialKit = {
    sidewalk: surface(pavers, { puddles: 0.8, snowable: true, leaves: true }),
    pedestrian: surface(paversLight, { puddles: 0.7, snowable: true, leaves: true }),
    plaza: surface(setts, { puddles: 1, snowable: true, leaves: true, normalScale: 0.9 }),
    road: surface(asphalt, { puddles: 1, snowable: true, leaves: true, normalScale: 0.5 }),
    grass: surface(grass, { puddles: 0, snowable: true, leaves: true, normalScale: 0.8 }),
    pier: surface(planks, { puddles: 0.4, snowable: true, leaves: false, normalScale: 0.7 }),
    quay: new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.9, side: THREE.DoubleSide }),
    curb: new THREE.MeshStandardMaterial({ color: 0x9c9993, roughness: 0.75 }),
    marking: new THREE.MeshStandardMaterial({
      color: 0xe9e6dd,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
    facade: createFacadeMaterial(),
    roof: createRoofMaterial(),
    dispose() {
      for (const s of [pavers, paversLight, asphalt, setts, grass, planks]) {
        s.map.dispose();
        s.normalMap.dispose();
        s.roughnessMap.dispose();
      }
      for (const k of Object.keys(kit) as (keyof MaterialKit)[]) {
        const v = kit[k];
        if (v instanceof THREE.Material) v.dispose();
      }
    },
  };
  kit.road.polygonOffset = true;
  kit.road.polygonOffsetFactor = -1;
  kit.road.polygonOffsetUnits = -1;
  for (const m of [kit.pedestrian, kit.plaza, kit.grass]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  return kit;
}

/**
 * Facade shader. Geometry provides:
 *  uv      = (metres along wall, metres above ground)
 *  aWall   = (wall length, building height)
 *  aStyle  = (seed, style, shopfront, floor height)    style: 0 plaster, 1 brick, 2 glass/modern, 3 stone
 *  color   = base colour of the building
 */
function createFacadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aWall; attribute vec4 aStyle;
        varying vec2 vWall; varying vec4 vStyle; varying vec2 vFac; varying vec3 vOwWorld;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vFac = uv; vWall = aWall; vStyle = aStyle;`,
      )
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOwWorld = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWall; varying vec4 vStyle; varying vec2 vFac; varying vec3 vOwWorld;
        uniform float uTime,uNight,uWet,uSnow;
        ${GLSL_NOISE}
        float box1(float x, float a, float b, float s){ return smoothstep(a-s,a+s,x) - smoothstep(b-s,b+s,x); }
        `,
      )
      .replace(
        '#include <map_fragment>',
        `
        float seed = floor(vStyle.x*997.0+0.5)/997.0; float style = floor(vStyle.y+0.5); float shop = step(0.5, vStyle.z); float fh = vStyle.w;
        float L0 = floor(vWall.x*20.0+0.5)/20.0;
        float along = vFac.x; float hgt = vFac.y; float L = L0; float H = floor(vWall.y*20.0+0.5)/20.0;
        float aa = fwidth(along) + fwidth(hgt);
        // window grid -------------------------------------------------------
        float spacing = style > 1.5 && style < 2.5 ? 1.6 : (2.7 + fract(seed*7.3)*0.9);
        float nW = max(1.0, floor((L - 1.2) / spacing));
        float margin = (L - nW*spacing) * 0.5;
        float ax = along - margin;
        float col = floor(ax / spacing);
        float cx = ax - col*spacing;                       // position inside bay
        float validCol = step(0.0, ax) * step(ax, nW*spacing);
        float groundH = shop > 0.5 ? 4.3 : fh;
        float floorIdx = floor((hgt - groundH) / fh);
        float fy = hgt - groundH - floorIdx*fh;            // position inside floor
        float upper = step(groundH, hgt) * step(hgt, H - 1.2);
        float winW = style > 1.5 && style < 2.5 ? 1.45 : 1.15 + fract(seed*3.1)*0.35;
        float winH = style > 1.5 && style < 2.5 ? fh - 0.7 : 1.65;
        float sill = style > 1.5 && style < 2.5 ? 0.35 : 0.85;
        float inX = box1(cx, (spacing-winW)*0.5, (spacing+winW)*0.5, aa);
        float inY = box1(fy, sill, sill+winH, aa);
        float plain = step(3.5, style);
        float win = inX * inY * upper * validCol * (1.0 - plain);
        // frame ring (slightly larger than glass)
        float frX = box1(cx, (spacing-winW)*0.5-0.09, (spacing+winW)*0.5+0.09, aa);
        float frY = box1(fy, sill-0.09, sill+winH+0.09, aa);
        float frame = clamp(frX*frY*upper*validCol - win, 0.0, 1.0) * (1.0 - plain);
        // mullion cross in classic windows
        float mull = (1.0 - step(1.5, style)*step(style, 2.5)) * win * max(box1(cx, spacing*0.5-0.03, spacing*0.5+0.03, aa), box1(fy, sill+winH*0.62-0.03, sill+winH*0.62+0.03, aa));
        // shop fronts --------------------------------------------------------
        float shopBay = 4.2;
        float sb = floor(along / shopBay);
        float sx = along - sb*shopBay;
        float shopGlass = shop * box1(hgt, 0.35, 3.3, aa) * box1(sx, 0.3, shopBay-0.3, aa) * step(0.8, along) * step(along, L-0.8);
        float shopFrame = shop * clamp(box1(hgt, 0.25, 3.45, aa)*step(0.6, along)*step(along, L-0.6) - shopGlass, 0.0, 1.0);
        float signBand = shop * box1(hgt, 3.55, 4.15, aa);
        // base material ------------------------------------------------------
        vec3 base = vColor.rgb;
        float n1 = ow_fbm(vec2(along*0.15, hgt*0.15) + seed*31.0);
        if (style > 0.5 && style < 1.5) { // brick courses
          float row = floor(hgt/0.075); float bx = fract((along + mod(row,2.0)*0.11)/0.22);
          float mortar = max(step(0.88, fract(hgt/0.075)), step(0.93, bx));
          base *= 0.88 + 0.2*ow_hash(vec2(floor((along + mod(row,2.0)*0.11)/0.22), row));
          base = mix(base, vec3(0.62,0.6,0.56), mortar*0.55);
        } else if (style > 2.5) { // stone blocks
          float r = floor(hgt/0.6); float bx = fract((along + mod(r,2.0)*0.45)/0.9);
          float j = max(step(0.95, fract(hgt/0.6)), step(0.97, bx));
          base *= 0.9 + 0.14*ow_hash(vec2(floor((along+mod(r,2.0)*0.45)/0.9), r));
          base *= 1.0 - j*0.25;
        }
        base *= 0.9 + 0.18*n1;
        // grime near the ground and rain streaks
        base *= mix(0.78, 1.0, smoothstep(0.0, 2.2, hgt));
        base *= 1.0 - 0.07*smoothstep(0.6, 1.0, ow_noise(vec2(along*1.7, hgt*0.08)));
        // cornice band at the top + string course between floors (classic)
        float corn = box1(hgt, H-0.9, H, aa);
        float course = (1.0 - step(1.5, style)*step(style,2.5)) * (1.0 - plain) * upper * box1(fy, -0.05, 0.18, aa);
        base = mix(base, base*1.18 + 0.04, max(corn, course*0.7));
        vec3 glassCol = mix(vec3(0.05,0.07,0.09), vec3(0.11,0.14,0.17), fract(seed*13.0));
        vec3 frameCol = style > 1.5 && style < 2.5 ? vec3(0.13,0.14,0.15) : mix(vec3(0.92,0.91,0.88), base*0.55, step(0.6, fract(seed*5.0)));
        float glass = max(win*(1.0-mull), shopGlass) ;
        vec3 c = base;
        c = mix(c, frameCol, max(frame, mull));
        c = mix(c, vec3(0.12,0.12,0.13), shopFrame);
        c = mix(c, mix(vec3(0.07,0.09,0.12), vec3(0.45,0.38,0.24), fract(seed*17.0)), signBand);
        if (style > 1.5 && style < 2.5) { // modern curtain wall: most of the facade is glass
          float panel = box1(fy, 0.0, fh, aa) * upper;
          float spandrel = box1(fy, fh-0.75, fh, aa) * upper;
          c = mix(c, glassCol, panel*(1.0-spandrel)*(1.0 - frame*0.6));
          glass = max(glass, panel*(1.0-spandrel)*0.95);
        }
        c = mix(c, glassCol, glass);
        // snow on window sills / ledges
        float ledge = uSnow * max(box1(fy, sill-0.12, sill-0.02, aa)*inX*upper*validCol, corn*0.6);
        c = mix(c, vec3(0.9,0.92,0.95), ledge);
        diffuseColor.rgb = c;
        float owGlass = glass;
        // interior lighting at night ----------------------------------------
        float cellId = mod(col + floorIdx*37.0 + floor(seed*997.0)*13.0, 4093.0);
        float lit = step(ow_hash(vec2(cellId*0.137, floor(seed*997.0)*0.071)), 0.38 + 0.2*fract(seed*3.7));
        float warmth = ow_hash(vec2(cellId*0.311, 3.17));
        vec3 roomCol = mix(vec3(1.0,0.62,0.3), vec3(1.0,0.86,0.66), warmth);
        roomCol = mix(roomCol, vec3(0.72,0.82,1.0), step(0.93, warmth)); // occasional cool/TV light
        float interior = 0.55 + 0.45*smoothstep(sill+winH, sill, fy);  // ceiling lamp falloff
        float curtain = step(0.6, ow_hash(vec2(cellId*0.173, 9.0))) * (0.7 + 0.3*smoothstep(0.2, 0.8, abs(cx - spacing*0.5)/(winW*0.5)));
        vec3 owEmissive = win * (1.0-mull) * lit * roomCol * interior * (1.0 - 0.45*curtain) * 1.25;
        vec3 shopLight = mix(vec3(1.0,0.83,0.6), vec3(0.95,0.95,1.0), step(0.7, fract(seed*23.0)));
        float shelves = 0.75 + 0.25*step(0.5, fract(hgt*1.6)) ; float display = smoothstep(0.35, 1.6, hgt) * (0.55 + 0.45*ow_noise(vec2(floor(along*1.3), 7.0)));
        owEmissive += shopGlass * shopLight * shelves * (0.16 + 0.24*display) * step(0.25, fract(seed*19.0 + sb*0.37));
        owEmissive += signBand * shop * step(0.4, fract(seed*29.0)) * mix(vec3(1.0,0.85,0.55), vec3(0.6,0.85,1.0), fract(seed*41.0)) * 0.55;
        if (style > 1.5 && style < 2.5) owEmissive += glass * (1.0-win) * lit * roomCol * 0.3;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * (0.85 + 0.2*n1), 0.06, owGlass);
        roughnessFactor = mix(roughnessFactor, roughnessFactor*0.55, uWet*(1.0-owGlass));`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.35, owGlass);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += owEmissive * uNight * 0.7;`,
      )
      .replace('#include <color_fragment>', '');
  };
  m.customProgramCacheKey = () => 'facade-v3';
  return m;
}

function createRoofMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOwWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOwWorld = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vOwWorld;\nuniform float uSnow,uWet;\n${GLSL_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb *= 0.85 + 0.3*ow_fbm(vOwWorld.xz*0.2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9,0.92,0.95), uSnow*0.92);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, uWet*(1.0-uSnow));',
      );
  };
  m.customProgramCacheKey = () => 'roof-v1';
  return m;
}
