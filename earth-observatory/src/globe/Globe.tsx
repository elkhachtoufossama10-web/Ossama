import '../cesiumBase';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useEffect, useRef, useState } from 'react';
import { getState, setState, subscribe, type AppState, type Place } from '../store';
import { GIBS, gibsTemplate, gibsTime } from '../sources/gibs';
import { obliquity, subsolarPoint } from '../astro/solar';
import { L, useLang } from '../i18n';

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

const gibsCredit = new Cesium.Credit('Imagery: NASA GIBS / ESDIS', false);

function gibsProvider(id: string, time: string | null) {
  const l = GIBS[id];
  return new Cesium.UrlTemplateImageryProvider({
    url: gibsTemplate(id, time),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel: l.maxLevel,
    tileWidth: 256,
    tileHeight: 256,
    credit: gibsCredit,
  });
}

/**
 * Cesium's own labels draw glyph by glyph, which breaks Arabic shaping and right-to-left order.
 * Labels are therefore drawn with the browser's text engine on a canvas and shown as billboards.
 */
const labelCache = new Map<string, HTMLCanvasElement>();
function labelImage(text: string, color: string, size = 13): HTMLCanvasElement {
  const key = `${text}|${color}|${size}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const font = `600 ${size}px "Noto Kufi Arabic Variable", system-ui, sans-serif`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 10;
  const h = Math.ceil(size * 1.9);
  c.width = w * dpr;
  c.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.direction = /[\u0600-\u06FF]/.test(text) ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  (c as HTMLCanvasElement & { dprScale?: number }).dprScale = 1 / dpr;
  labelCache.set(key, c);
  return c;
}
function labelBillboard(text: string, color: string, offsetY: number, extra: Partial<Cesium.BillboardGraphics.ConstructorOptions> = {}): Cesium.BillboardGraphics.ConstructorOptions {
  const img = labelImage(text, color);
  return { image: img, scale: 1 / Math.min(2, window.devicePixelRatio || 1), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, offsetY), disableDepthTestDistance: 0, ...extra };
}

/** Points on the circle at angular distance `deg` from (lat0, lon0) — used for the terminator and twilight lines. */
function smallCircle(lat0: number, lon0: number, deg: number, n = 240): Cesium.Cartesian3[] {
  const r = Math.PI / 180, d = deg * r, p1 = lat0 * r, l1 = lon0 * r;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const b = (i / n) * 2 * Math.PI;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    out.push(l2 / r, p2 / r);
  }
  return Cesium.Cartesian3.fromDegreesArray(out);
}

class GlobeController {
  viewer: Cesium.Viewer;
  base!: Cesium.ImageryLayer;
  baseId = '';
  night: Cesium.ImageryLayer | null = null;
  refFeatures: Cesium.ImageryLayer | null = null;
  refLabels: Cesium.ImageryLayer | null = null;
  overlay: Cesium.ImageryLayer | null = null;
  overlayKey = '';
  model: Cesium.ImageryLayer | null = null;
  modelCanvas: HTMLCanvasElement | null = null;
  graticule: Cesium.Entity[] = [];
  graticuleEps = 0;
  terminator: Cesium.Entity[] = [];
  subsolar: Cesium.Entity;
  selected: Cesium.Entity | null = null;
  pins: Cesium.Entity[] = [];
  last: Partial<AppState> = {};
  lastTermUpdate = 0;
  subsolarText = '';
  lang = '';

  constructor(el: HTMLElement, creditEl: HTMLElement) {
    this.viewer = new Cesium.Viewer(el, {
      baseLayer: false,
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      creditContainer: creditEl,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      skyAtmosphere: new Cesium.SkyAtmosphere(),
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });
    const v = this.viewer;
    v.clock.shouldAnimate = false;
    const g = v.scene.globe;
    g.enableLighting = true;
    g.dynamicAtmosphereLighting = true;
    g.dynamicAtmosphereLightingFromSun = true;
    g.baseColor = Cesium.Color.fromCssColorString('#0b1a2e');
    g.showGroundAtmosphere = true;
    g.nightFadeOutDistance = 1.0e7;
    g.nightFadeInDistance = 5.0e7;
    v.scene.highDynamicRange = false;
    v.scene.screenSpaceCameraController.minimumZoomDistance = 50000;
    v.scene.screenSpaceCameraController.maximumZoomDistance = 6.0e7;
    // narrow (portrait) screens need the camera closer for the globe to fill the width
    const portrait = el.clientWidth < el.clientHeight;
    v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-5.8, 30, portrait ? 1.5e7 : 2.2e7) });
    this.subsolar = v.entities.add({
      point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#ffd54a'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    });
    const h = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    h.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      const c = v.camera.pickEllipsoid(e.position, g.ellipsoid);
      if (!c) return;
      const carto = Cesium.Cartographic.fromCartesian(c);
      const lat = Cesium.Math.toDegrees(carto.latitude), lon = Cesium.Math.toDegrees(carto.longitude);
      setState({ selected: { id: `c${lat.toFixed(3)},${lon.toFixed(3)}`, name: '', lat, lon, origin: 'click' }, panel: 'place' });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.sync(getState(), true);
  }

  sync(s: AppState, force = false) {
    const v = this.viewer;
    const L0 = this.last;
    v.clock.currentTime = Cesium.JulianDate.fromDate(s.time);
    if (force || s.layers.base !== L0.layers?.base || dayKey(s.time) !== dayKey(L0.time)) this.setBase(s);
    if (force || s.layers.nightLights !== L0.layers?.nightLights) {
      if (this.night) { v.imageryLayers.remove(this.night); this.night = null; }
      if (s.layers.nightLights) {
        this.night = v.imageryLayers.addImageryProvider(gibsProvider('VIIRS_Black_Marble', '2016-01-01'), 1);
        this.night.dayAlpha = 0.0;
        this.night.nightAlpha = 0.95;
        this.night.brightness = 1.6;
      }
    }
    if (force || s.layers.borders !== L0.layers?.borders) {
      if (this.refFeatures) { v.imageryLayers.remove(this.refFeatures); this.refFeatures = null; }
      if (s.layers.borders) { this.refFeatures = v.imageryLayers.addImageryProvider(gibsProvider('Reference_Features_15m', null)); this.refFeatures.alpha = 0.55; }
    }
    if (force || s.layers.labels !== L0.layers?.labels) {
      if (this.refLabels) { v.imageryLayers.remove(this.refLabels); this.refLabels = null; }
      if (s.layers.labels) this.refLabels = v.imageryLayers.addImageryProvider(gibsProvider('Reference_Labels_15m', null));
    }
    this.setOverlay(s);
    if (this.overlay) this.overlay.alpha = s.layers.gibsOpacity;
    if (this.model) this.model.alpha = s.layers.modelOpacity;
    const eps = obliquity(s.time);
    const langNow = L('ar', 'en');
    if (langNow !== this.lang) { this.lang = langNow; force = true; }
    if (force || s.layers.graticule !== L0.layers?.graticule || Math.abs(eps - this.graticuleEps) > 0.001) this.setGraticule(s.layers.graticule, eps);
    this.setSun(s, force);
    if (force || s.selected !== L0.selected || s.pins !== L0.pins || s.timeMode !== L0.timeMode) this.setMarkers(s);
    this.keepLayerOrder();
    this.last = s;
    v.scene.requestRender();
  }

  setBase(s: AppState) {
    const v = this.viewer;
    const id = s.layers.base;
    const t = GIBS[id].period ? gibsTime(id, s.time).time : null;
    const key = `${id}@${t}`;
    if (key === this.baseId) return;
    this.baseId = key;
    const layer = new Cesium.ImageryLayer(gibsProvider(id, t));
    if (this.base) v.imageryLayers.remove(this.base);
    v.imageryLayers.add(layer, 0);
    this.base = layer;
  }

  setOverlay(s: AppState) {
    const v = this.viewer;
    const id = s.layers.gibs;
    const t = id ? gibsTime(id, s.time).time : null;
    const key = id ? `${id}@${t}` : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { v.imageryLayers.remove(this.overlay); this.overlay = null; }
    if (id) {
      this.overlay = v.imageryLayers.addImageryProvider(gibsProvider(id, t));
      this.overlay.alpha = s.layers.gibsOpacity;
    }
  }

  async setModelCanvas(canvas: HTMLCanvasElement | null, alpha: number) {
    const v = this.viewer;
    if (this.model) { v.imageryLayers.remove(this.model); this.model = null; }
    this.modelCanvas = canvas;
    if (!canvas) { v.scene.requestRender(); return; }
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), { rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90) });
    if (this.modelCanvas !== canvas) return; // superseded
    this.model = v.imageryLayers.addImageryProvider(provider);
    this.model.alpha = alpha;
    this.keepLayerOrder();
    v.scene.requestRender();
  }

  keepLayerOrder() {
    const il = this.viewer.imageryLayers;
    // base < night < overlay < model < reference features < labels
    for (const l of [this.overlay, this.model, this.refFeatures, this.refLabels]) if (l && il.contains(l)) il.raiseToTop(l);
  }

  setGraticule(on: boolean, eps: number) {
    const v = this.viewer;
    this.graticule.forEach((e) => v.entities.remove(e));
    this.graticule = [];
    this.graticuleEps = eps;
    if (!on) return;
    const faint = Cesium.Color.WHITE.withAlpha(0.18);
    for (let lon = -180; lon < 180; lon += 30) {
      this.graticule.push(v.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray([lon, -89.5, lon, 0, lon, 89.5]), width: 1, material: faint, arcType: Cesium.ArcType.GEODESIC } }));
    }
    const parallels: [number, Cesium.Color, string, string, number][] = [
      [0, Cesium.Color.fromCssColorString('#ff7a7a'), 'خط الاستواء', 'Equator', 2],
      [eps, Cesium.Color.fromCssColorString('#ffb347'), 'مدار السرطان', 'Tropic of Cancer', 1.5],
      [-eps, Cesium.Color.fromCssColorString('#ffb347'), 'مدار الجدي', 'Tropic of Capricorn', 1.5],
      [90 - eps, Cesium.Color.fromCssColorString('#7fd4ff'), 'الدائرة القطبية الشمالية', 'Arctic Circle', 1.5],
      [-(90 - eps), Cesium.Color.fromCssColorString('#7fd4ff'), 'الدائرة القطبية الجنوبية', 'Antarctic Circle', 1.5],
    ];
    for (const lat of [-60, -30, 30, 60]) parallels.push([lat, faint, '', '', 1]);
    for (const [lat, color, ar, en, width] of parallels) {
      const pts: number[] = [];
      for (let lon = -180; lon <= 180; lon += 3) pts.push(lon, lat);
      this.graticule.push(v.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(pts), width, material: color, arcType: Cesium.ArcType.RHUMB } }));
      if (ar) {
        this.graticule.push(v.entities.add({
          position: Cesium.Cartesian3.fromDegrees(-28, lat),
          billboard: labelBillboard(`${L(ar, en)} \u2066${Math.abs(lat).toFixed(2)}°\u2069`, color.toCssColorString(), 0, { eyeOffset: new Cesium.Cartesian3(0, 0, -1000) }),
        }));
      }
    }
  }

  setSun(s: AppState, force: boolean) {
    const ss = subsolarPoint(s.time);
    this.subsolar.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(ss.lon, ss.lat));
    const lbl = L('الشمس عمودية هنا', 'Sun overhead');
    if (this.subsolarText !== lbl) {
      this.subsolarText = lbl;
      this.subsolar.billboard = new Cesium.BillboardGraphics(labelBillboard(lbl, '#ffe9a8', -8));
    }
    const t = s.time.getTime();
    if (!force && Math.abs(t - this.lastTermUpdate) < 60e3 && s.layers.terminator === this.last.layers?.terminator) return;
    this.lastTermUpdate = t;
    const v = this.viewer;
    this.terminator.forEach((e) => v.entities.remove(e));
    this.terminator = [];
    if (!s.layers.terminator) return;
    // 90.833°: sunrise/sunset line (refraction + solar radius); 96/102/108°: end of civil/nautical/astronomical twilight
    const lines: [number, Cesium.Color, number][] = [
      [90.833, Cesium.Color.fromCssColorString('#ffd54a').withAlpha(0.95), 2],
      [96, Cesium.Color.fromCssColorString('#ff9f5a').withAlpha(0.6), 1],
      [102, Cesium.Color.fromCssColorString('#b07cff').withAlpha(0.5), 1],
      [108, Cesium.Color.fromCssColorString('#6c7bff').withAlpha(0.4), 1],
    ];
    for (const [d, color, width] of lines) {
      this.terminator.push(v.entities.add({ polyline: { positions: smallCircle(ss.lat, ss.lon, d), width, material: color, arcType: Cesium.ArcType.GEODESIC } }));
    }
  }

  setMarkers(s: AppState) {
    const v = this.viewer;
    this.pins.forEach((e) => v.entities.remove(e));
    this.pins = [];
    if (this.selected) { v.entities.remove(this.selected); this.selected = null; }
    const mk = (p: Place, color: string, size: number) => v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
      point: { pixelSize: size, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      billboard: p.name ? labelBillboard(p.name, '#ffffff', -8) : undefined,
    });
    s.pins.forEach((p) => this.pins.push(mk(p, '#58e1c1', 9)));
    if (s.selected) this.selected = mk(s.selected, '#ff5f87', 13);
  }

  flyTo(lat: number, lon: number, height = 7.0e6) {
    this.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, height), duration: 1.6 });
  }

  destroy() {
    this.viewer.destroy();
  }
}

const dayKey = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '');

let controller: GlobeController | null = null;
export const globeApi = {
  flyTo: (lat: number, lon: number, h?: number) => controller?.flyTo(lat, lon, h),
  setModelCanvas: (c: HTMLCanvasElement | null, alpha: number) => controller?.setModelCanvas(c, alpha),
  zoom: (f: number) => {
    if (!controller) return;
    const cam = controller.viewer.camera;
    const h = cam.positionCartographic.height;
    f > 1 ? cam.zoomIn(h * (1 - 1 / f)) : cam.zoomOut(h * (1 / f - 1));
    controller.viewer.scene.requestRender();
  },
  resetView: () => controller?.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(-5.8, 25, 2.2e7), duration: 1.2 }),
  screenshot: () => controller?.viewer.canvas.toDataURL('image/png'),
};

export default function Globe() {
  const ref = useRef<HTMLDivElement>(null);
  const credits = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = useLang();
  useEffect(() => { controller?.sync(getState()); }, [lang]);
  useEffect(() => {
    if (!ref.current || !credits.current) return;
    try {
      controller = new GlobeController(ref.current, credits.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const c = controller;
    const unsub = subscribe(() => c.sync(getState()));
    // redraw canvas labels once the Arabic web font is available
    document.fonts?.load('600 13px "Noto Kufi Arabic Variable"', 'طنجة').then(() => { labelCache.clear(); c.sync(getState(), true); }, () => {});
    const onLost = () => setError(L('فُقد سياق WebGL. أعد تحميل الصفحة.', 'The WebGL context was lost. Please reload.'));
    c.viewer.canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      unsub();
      c.viewer.canvas.removeEventListener('webglcontextlost', onLost);
      c.destroy();
      controller = null;
    };
  }, []);
  return (
    <div className="globe-wrap">
      <div ref={ref} className="globe" role="application" aria-label={L('كرة أرضية تفاعلية. انقر لاختيار موقع.', 'Interactive globe. Click to choose a location.')} />
      <div ref={credits} className="globe-credits" />
      {error && (
        <div className="globe-error" role="alert">
          <strong>{L('تعذّر تشغيل الكرة ثلاثية الأبعاد', 'The 3D globe could not start')}</strong>
          <p>{L('يحتاج المتصفح إلى WebGL. بقية الأدوات (الشمس، الطقس، الفصول) تعمل بالبحث عن موقع.', 'Your browser needs WebGL. The other tools (sun, weather, seasons) still work through search.')}</p>
          <code>{error}</code>
        </div>
      )}
    </div>
  );
}
