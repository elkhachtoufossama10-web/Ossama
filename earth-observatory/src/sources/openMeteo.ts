/**
 * ECMWF IFS (0.25°, open data) forecasts, served by Open-Meteo (https://open-meteo.com/en/docs/ecmwf-api).
 * The producer is the European Centre for Medium-Range Weather Forecasts; Open-Meteo is a redistributor
 * (not a government body) that decodes the GRIB files and interpolates the 3-hourly steps to hourly values.
 */
import { fetchJson, num, obj, series, arr, roundCoord, type Validator } from './http';
import type { Provenance } from './provenance';

const BASE = 'https://api.open-meteo.com/v1/forecast';
const MODEL = 'ecmwf_ifs025';
export const OPEN_METEO_TERMS = 'Open-Meteo: CC BY 4.0, free for non-commercial use (limits ~10 000 calls/day). ECMWF open data: CC BY 4.0.';
export const OPEN_METEO_TERMS_URL = 'https://open-meteo.com/en/terms';

export const VARS = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m'] as const;
export type Var = (typeof VARS)[number];
const BOUNDS: Record<Var, [number, number]> = {
  temperature_2m: [-95, 65], apparent_temperature: [-110, 80], relative_humidity_2m: [0, 100], precipitation: [0, 500],
  cloud_cover: [0, 100], pressure_msl: [850, 1100], wind_speed_10m: [0, 450], wind_direction_10m: [0, 360],
};

export interface ModelMeta {
  runTime: Date;
  availableAt: Date;
  updateEverySec: number;
  stepSec: number;
}

const metaValidator: Validator<ModelMeta> = (x) => {
  const o = obj(x, 'meta');
  return {
    runTime: new Date(num(o.last_run_initialisation_time, 'last_run_initialisation_time') * 1000),
    availableAt: new Date(num(o.last_run_availability_time, 'last_run_availability_time') * 1000),
    updateEverySec: num(o.update_interval_seconds, 'update_interval_seconds'),
    stepSec: num(o.temporal_resolution_seconds, 'temporal_resolution_seconds'),
  };
};

export async function modelMeta() {
  // meta.json has no CORS headers, so it is fetched through this app's server relay (server/relay.mjs)
  const r = await fetchJson(`/api/model-meta?model=${MODEL}`, { ttlMs: 10 * 60e3, validate: metaValidator, source: 'open-meteo', retries: 0 });
  return r.data;
}

export interface PointForecast {
  lat: number;
  lon: number;
  elevation: number;
  timezone: string;
  current: Record<Var, number | null> & { time: Date; weather_code: number | null; wind_gusts_10m: number | null; is_day: number | null };
  hourly: { time: number[] } & Record<Var, (number | null)[]>;
  daily: { time: number[]; tmax: (number | null)[]; tmin: (number | null)[]; precip: (number | null)[]; sunrise: number[]; sunset: number[] };
  /** last hour that has model values (the tail of the 16-day range is empty for some steps) */
  lastValid: Date;
  firstValid: Date;
}

export const validatePoint: Validator<PointForecast> = (x) => {
  const o = obj(x, 'forecast');
  const c = obj(o.current, 'current');
  const h = obj(o.hourly, 'hourly');
  const d = obj(o.daily, 'daily');
  const time = arr(h.time, 'hourly.time').map((t, i) => num(t, `hourly.time[${i}]`));
  const hourly = { time } as PointForecast['hourly'];
  for (const v of VARS) {
    hourly[v] = series(h[v], `hourly.${v}`, ...BOUNDS[v]);
    if (hourly[v].length !== time.length) throw new Error(`hourly.${v} length mismatch`);
  }
  // trim trailing hours where the model has no data
  let last = time.length - 1;
  while (last > 0 && hourly.temperature_2m[last] === null) last--;
  const cur = {} as PointForecast['current'];
  for (const v of VARS) {
    const val = c[v];
    const [lo, hi] = BOUNDS[v];
    cur[v] = typeof val === 'number' && val >= lo && val <= hi ? val : null;
  }
  cur.time = new Date(num(c.time, 'current.time') * 1000);
  cur.weather_code = typeof c.weather_code === 'number' ? c.weather_code : null;
  cur.wind_gusts_10m = typeof c.wind_gusts_10m === 'number' ? c.wind_gusts_10m : null;
  cur.is_day = typeof c.is_day === 'number' ? c.is_day : null;
  return {
    lat: num(o.latitude, 'latitude'),
    lon: num(o.longitude, 'longitude'),
    elevation: typeof o.elevation === 'number' ? o.elevation : NaN,
    timezone: typeof o.timezone === 'string' ? o.timezone : 'GMT',
    current: cur,
    hourly,
    daily: {
      time: arr(d.time, 'daily.time').map((t) => num(t, 'daily.time')),
      tmax: series(d.temperature_2m_max, 'tmax', -95, 65),
      tmin: series(d.temperature_2m_min, 'tmin', -95, 65),
      precip: series(d.precipitation_sum, 'precip', 0, 2000),
      sunrise: arr(d.sunrise, 'sunrise').map((t) => Number(t)),
      sunset: arr(d.sunset, 'sunset').map((t) => Number(t)),
    },
    firstValid: new Date(time[0] * 1000),
    lastValid: new Date(time[last] * 1000),
  };
};

export async function pointForecast(lat: number, lon: number): Promise<{ data: PointForecast; prov: Provenance }> {
  const qs = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    models: MODEL,
    current: [...VARS, 'wind_gusts_10m', 'weather_code', 'is_day'].join(','),
    hourly: VARS.join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset',
    timezone: 'auto',
    timeformat: 'unixtime',
    past_days: '7',
    forecast_days: '16',
  });
  const url = `${BASE}?${qs}`;
  const [r, meta] = await Promise.all([
    fetchJson(url, { ttlMs: 30 * 60e3, validate: validatePoint, source: 'open-meteo' }),
    modelMeta().catch(() => null),
  ]);
  return {
    data: r.data,
    prov: {
      kind: 'forecast',
      producer: 'ECMWF — IFS HRES (open data)',
      provider: 'Open-Meteo',
      model: 'ECMWF IFS 0.25° (ecmwf_ifs025)',
      runTime: meta?.runTime,
      validRange: [r.data.firstValid, r.data.lastValid],
      fetchedAt: r.fetchedAt,
      coverage: 'global',
      resolution: `0.25° (~25 km) grid cell nearest to ${r.data.lat.toFixed(2)}, ${r.data.lon.toFixed(2)}; native steps ${meta ? meta.stepSec / 3600 : 3} h, interpolated to hourly by Open-Meteo`,
      terms: OPEN_METEO_TERMS,
      termsUrl: OPEN_METEO_TERMS_URL,
      url,
      updateEveryMin: meta ? meta.updateEverySec / 60 : 360,
      notes: ['"Current" values are the model state for the current 15 minutes, not a measurement.'],
    },
  };
}

// ---------------------------------------------------------------- global grid of model values for one hour
export interface GridSample {
  lats: number[]; // descending
  lons: number[]; // ascending
  values: Record<Var, (number | null)[][]>; // [latIndex][lonIndex]
  hour: Date;
  prov: Provenance;
}

export const GRID_STEP = 10;

export function gridAxes(step = GRID_STEP) {
  const lats: number[] = [];
  for (let la = 80; la >= -80; la -= step) lats.push(la);
  const lons: number[] = [];
  for (let lo = -180; lo < 180; lo += step) lons.push(lo);
  return { lats, lons };
}

const validateGrid = (n: number): Validator<Record<string, unknown>[]> => (x) => {
  const a = arr(x, 'grid');
  if (a.length !== n) throw new Error(`grid: expected ${n} locations, got ${a.length}`);
  return a.map((e, i) => obj(e, `grid[${i}]`));
};

/** Samples the model every GRID_STEP degrees for one UTC hour inside the forecast range (on demand, cached 1 h). */
export async function modelGrid(hour: Date): Promise<GridSample> {
  const { lats, lons } = gridAxes();
  const la: number[] = [], lo: number[] = [];
  for (const a of lats) for (const b of lons) { la.push(a); lo.push(b); }
  const h = new Date(Math.floor(hour.getTime() / 3600e3) * 3600e3);
  const iso = h.toISOString().slice(0, 13) + ':00';
  const qs = new URLSearchParams({
    latitude: la.join(','), longitude: lo.join(','), models: MODEL, hourly: VARS.join(','),
    timezone: 'GMT', timeformat: 'unixtime', start_hour: iso, end_hour: iso,
  });
  const url = `${BASE}?${qs}`;
  const [r, meta] = await Promise.all([
    fetchJson(url, { ttlMs: 60 * 60e3, validate: validateGrid(la.length), source: 'open-meteo', timeoutMs: 20000, persist: false }),
    modelMeta().catch(() => null),
  ]);
  const values = {} as GridSample['values'];
  for (const v of VARS) values[v] = lats.map(() => lons.map(() => null as number | null));
  r.data.forEach((loc, k) => {
    const hh = obj(loc.hourly, 'hourly');
    const i = Math.floor(k / lons.length), j = k % lons.length;
    for (const v of VARS) values[v][i][j] = series(hh[v], v, ...BOUNDS[v])[0] ?? null;
  });
  return {
    lats, lons, values, hour: h,
    prov: {
      kind: 'forecast', producer: 'ECMWF — IFS HRES (open data)', provider: 'Open-Meteo', model: 'ECMWF IFS 0.25°',
      runTime: meta?.runTime, validTime: h, fetchedAt: r.fetchedAt, coverage: 'global, 80°S–80°N',
      resolution: `sampled every ${GRID_STEP}° from the 0.25° model (${la.length} grid points), smoothed between samples for display`,
      terms: OPEN_METEO_TERMS, termsUrl: OPEN_METEO_TERMS_URL, updateEveryMin: meta ? meta.updateEverySec / 60 : 360,
      notes: ['Coarse overview only — small-scale features (fronts, showers, mountains) are not resolved at this sampling.'],
    },
  };
}

// ---------------------------------------------------------------- WMO weather interpretation codes
export function weatherCodeText(code: number | null, ar: boolean): string {
  if (code === null) return '—';
  const t: Record<number, [string, string]> = {
    0: ['سماء صافية', 'Clear sky'], 1: ['صافٍ غالباً', 'Mainly clear'], 2: ['غائم جزئياً', 'Partly cloudy'], 3: ['غائم', 'Overcast'],
    45: ['ضباب', 'Fog'], 48: ['ضباب متجمد', 'Rime fog'], 51: ['رذاذ خفيف', 'Light drizzle'], 53: ['رذاذ', 'Drizzle'], 55: ['رذاذ كثيف', 'Dense drizzle'],
    56: ['رذاذ متجمد', 'Freezing drizzle'], 57: ['رذاذ متجمد كثيف', 'Dense freezing drizzle'], 61: ['مطر خفيف', 'Light rain'], 63: ['مطر', 'Rain'],
    65: ['مطر غزير', 'Heavy rain'], 66: ['مطر متجمد', 'Freezing rain'], 67: ['مطر متجمد غزير', 'Heavy freezing rain'], 71: ['ثلج خفيف', 'Light snow'],
    73: ['ثلج', 'Snow'], 75: ['ثلج كثيف', 'Heavy snow'], 77: ['حبيبات ثلج', 'Snow grains'], 80: ['زخات خفيفة', 'Light showers'], 81: ['زخات', 'Showers'],
    82: ['زخات عنيفة', 'Violent showers'], 85: ['زخات ثلج', 'Snow showers'], 86: ['زخات ثلج كثيفة', 'Heavy snow showers'], 95: ['عاصفة رعدية', 'Thunderstorm'],
    96: ['عاصفة رعدية مع برد', 'Thunderstorm with hail'], 99: ['عاصفة رعدية مع برد كثيف', 'Thunderstorm with heavy hail'],
  };
  const e = t[code];
  return e ? (ar ? e[0] : e[1]) : `WMO ${code}`;
}
