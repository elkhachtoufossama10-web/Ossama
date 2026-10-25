/**
 * ERA5 reanalysis (ECMWF for the Copernicus Climate Change Service, C3S), via the Open-Meteo archive API
 * (https://open-meteo.com/en/docs/historical-weather-api). ERA5 becomes available with ~5 days delay.
 * We do not call the Copernicus CDS directly: it needs a personal API key and an asynchronous job queue.
 */
import { arr, fetchJson, obj, roundCoord, series, str, type Validator } from './http';
import type { Provenance } from './provenance';
import { OPEN_METEO_TERMS_URL } from './openMeteo';

const BASE = 'https://archive-api.open-meteo.com/v1/archive';
const TERMS = 'ERA5: Copernicus licence (free, attribution “Contains modified Copernicus Climate Change Service information”). Delivered by Open-Meteo (CC BY 4.0).';

export interface DailyHistory {
  dates: string[];
  tmax: (number | null)[];
  tmin: (number | null)[];
  tmean: (number | null)[];
  precip: (number | null)[];
}

const vDaily: Validator<DailyHistory> = (x) => {
  const d = obj(obj(x, 'archive').daily, 'daily');
  const dates = arr(d.time, 'time').map((t) => str(t, 'time'));
  const out = {
    dates,
    tmax: series(d.temperature_2m_max, 'tmax', -95, 65),
    tmin: series(d.temperature_2m_min, 'tmin', -95, 65),
    tmean: series(d.temperature_2m_mean ?? dates.map(() => null), 'tmean', -95, 65),
    precip: series(d.precipitation_sum, 'precip', 0, 2000),
  };
  // drop the trailing days that ERA5 does not cover yet
  let n = dates.length;
  while (n > 0 && out.tmax[n - 1] === null) n--;
  return { dates: dates.slice(0, n), tmax: out.tmax.slice(0, n), tmin: out.tmin.slice(0, n), tmean: out.tmean.slice(0, n), precip: out.precip.slice(0, n) };
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function prov(url: string, fetchedAt: Date, extra: Partial<Provenance>): Provenance {
  return {
    kind: 'reanalysis', producer: 'ECMWF / Copernicus C3S — ERA5', provider: 'Open-Meteo archive API', model: 'ERA5 (0.25°, hourly, 1940–present)',
    fetchedAt, coverage: 'global', resolution: '0.25° (~31 km native) grid cell', terms: TERMS, termsUrl: OPEN_METEO_TERMS_URL, url, ...extra,
  };
}

/** Daily ERA5 values for the last `days` days (ERA5 lags ~5 days behind real time). */
export async function recentHistory(lat: number, lon: number, days = 60) {
  const end = new Date(Date.now() - 86400e3);
  const start = new Date(end.getTime() - days * 86400e3);
  const url = `${BASE}?latitude=${roundCoord(lat)}&longitude=${roundCoord(lon)}&start_date=${ymd(start)}&end_date=${ymd(end)}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum&models=era5&timezone=auto`;
  const r = await fetchJson(url, { ttlMs: 6 * 3600e3, validate: vDaily, source: 'open-meteo-archive' });
  const last = r.data.dates.at(-1);
  return {
    data: r.data,
    prov: prov(url, r.fetchedAt, {
      validRange: [new Date(r.data.dates[0] + 'T00:00Z'), new Date((last ?? ymd(end)) + 'T23:59Z')],
      notes: [`Latest ERA5 day available: ${last ?? '—'} (ERA5 is published with about 5 days delay).`],
    }),
  };
}

export interface HourlyDay { times: number[]; temp: (number | null)[]; cloud: (number | null)[]; precip: (number | null)[]; wind: (number | null)[] }
const vHourly: Validator<HourlyDay> = (x) => {
  const h = obj(obj(x, 'archive').hourly, 'hourly');
  return {
    times: arr(h.time, 'time').map(Number),
    temp: series(h.temperature_2m, 'temperature_2m', -95, 65),
    cloud: series(h.cloud_cover, 'cloud_cover', 0, 100),
    precip: series(h.precipitation, 'precipitation', 0, 500),
    wind: series(h.wind_speed_10m, 'wind_speed_10m', 0, 450),
  };
};

/** Hourly ERA5 for one UTC day (used when the timeline is set to a past date). */
export async function historicalDay(lat: number, lon: number, day: Date) {
  const d = ymd(day);
  const url = `${BASE}?latitude=${roundCoord(lat)}&longitude=${roundCoord(lon)}&start_date=${d}&end_date=${d}&hourly=temperature_2m,cloud_cover,precipitation,wind_speed_10m&models=era5&timezone=GMT&timeformat=unixtime`;
  const r = await fetchJson(url, { ttlMs: 24 * 3600e3, validate: vHourly, source: 'open-meteo-archive' });
  return { data: r.data, prov: prov(url, r.fetchedAt, { validRange: [new Date(d + 'T00:00Z'), new Date(d + 'T23:00Z')] }) };
}

export interface Normals {
  months: { tmax: number | null; tmin: number | null; precip: number | null }[];
  years: string;
}

/** 1991–2020 monthly means computed in the app from daily ERA5 values. Not the official WMO station normals. */
export async function climateNormals(lat: number, lon: number) {
  const la = Math.round(lat * 4) / 4, lo = Math.round(lon * 4) / 4; // snap to the ERA5 cell so the cache is shared
  const key = `eo.normals:${la},${lo}`;
  const url = `${BASE}?latitude=${la}&longitude=${lo}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=era5&timezone=GMT`;
  let data: Normals | null = null;
  let fetchedAt = new Date();
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c?.months?.length === 12) { data = c; fetchedAt = new Date(c.fetchedAt); }
  } catch { /* no cache */ }
  if (!data) {
    const r = await fetchJson(url, { ttlMs: 7 * 86400e3, validate: vDaily, source: 'open-meteo-archive', timeoutMs: 60000, persist: false });
    data = computeNormals(r.data);
    fetchedAt = r.fetchedAt;
    try { localStorage.setItem(key, JSON.stringify({ ...data, fetchedAt })); } catch { /* quota */ }
  }
  return {
    data,
    prov: { ...prov(url, fetchedAt, { notes: ['Monthly means of daily ERA5 maxima/minima and monthly precipitation totals, computed in this app. ERA5 cells average over ~30 km and can differ from a nearby station, especially near coasts and mountains.'] }), kind: 'climatology' as const, validRange: [new Date('1991-01-01T00:00Z'), new Date('2020-12-31T23:59Z')] as [Date, Date] },
  };
}

export function computeNormals(h: DailyHistory): Normals {
  const acc = Array.from({ length: 12 }, () => ({ tx: 0, nx: 0, tn: 0, nn: 0, p: 0, np: 0 }));
  const years = new Set<string>();
  h.dates.forEach((d, i) => {
    const m = Number(d.slice(5, 7)) - 1;
    years.add(d.slice(0, 4));
    const a = acc[m];
    if (h.tmax[i] !== null) { a.tx += h.tmax[i]!; a.nx++; }
    if (h.tmin[i] !== null) { a.tn += h.tmin[i]!; a.nn++; }
    if (h.precip[i] !== null) { a.p += h.precip[i]!; a.np++; }
  });
  const daysIn = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return {
    years: `${[...years].sort()[0]}–${[...years].sort().at(-1)}`,
    months: acc.map((a, m) => ({
      tmax: a.nx ? a.tx / a.nx : null,
      tmin: a.nn ? a.tn / a.nn : null,
      precip: a.np ? (a.p / a.np) * daysIn[m] : null, // mean daily total × days → monthly total
    })),
  };
}
