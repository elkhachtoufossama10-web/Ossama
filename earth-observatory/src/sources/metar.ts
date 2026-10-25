/**
 * Airport observations (METAR) from the NOAA Aviation Weather Center Data API
 * (https://aviationweather.gov/data/api/). Worldwide, public domain. The API does not send CORS headers,
 * so the browser cannot call it directly: requests go through this project's tiny server (server/server.mjs,
 * also wired into the Vite dev server). On a static host without that server, this source is unavailable.
 */
import { arr, fetchJson, numOrNull, obj, type Validator } from './http';
import type { Provenance } from './provenance';
import { haversineKm } from './nws';
import { SNAPSHOT_URL, STATIC_MODE } from './config';

export interface Metar { icao: string; name: string; lat: number; lon: number; time: Date; temp: number | null; dewp: number | null; windDir: number | null; windKt: number | null; pressure: number | null; raw: string; cover: string; distanceKm: number; humidity: number | null }

const vList: Validator<Omit<Metar, 'distanceKm' | 'humidity'>[]> = (x) =>
  arr(x, 'metar').map((e) => {
    const o = obj(e, 'metar');
    return {
      icao: String(o.icaoId ?? ''), name: String(o.name ?? ''), lat: Number(o.lat), lon: Number(o.lon), time: new Date(Number(o.obsTime) * 1000),
      temp: numOrNull(o.temp), dewp: numOrNull(o.dewp), windDir: numOrNull(o.wdir), windKt: numOrNull(o.wspd), pressure: numOrNull(o.altim),
      raw: String(o.rawOb ?? ''), cover: String(o.cover ?? ''),
    };
  }).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon) && !Number.isNaN(m.time.getTime()));

/** Magnus formula, used to show relative humidity from METAR temperature and dew point */
export function rhFromDew(t: number, td: number) {
  const g = (x: number) => (17.625 * x) / (243.04 + x);
  return Math.max(0, Math.min(100, 100 * Math.exp(g(td) - g(t))));
}

export async function nearestMetar(lat: number, lon: number, maxKm = 80) {
  const d = Math.min(3, maxKm / 80 + 0.2);
  const bbox = [lat - d, lon - d * 1.5, lat + d, lon + d * 1.5].map((v) => v.toFixed(2)).join(',');
  let list: Omit<Metar, 'distanceKm' | 'humidity'>[];
  let fetchedAt: Date;
  if (STATIC_MODE) {
    // 10°×10° tiles of the bulk snapshot; a missing tile (404) just means no station there
    const keys = new Set<string>();
    for (const la of [lat - d, lat + d]) for (const lo of [lon - d * 1.5, lon + d * 1.5]) {
      const a = Math.floor((Math.max(-89.99, Math.min(89.99, la)) + 90) / 10) * 10 - 90;
      const b = Math.floor(((((lo + 180) % 360) + 360) % 360) / 10) * 10 - 180;
      keys.add(`${a}_${b}`);
    }
    const parts = await Promise.all([...keys].map((k) =>
      fetchJson(`${SNAPSHOT_URL}/metar/${k}.json`, { ttlMs: 10 * 60e3, validate: vList, source: 'awc-snapshot', retries: 1 })
        .catch((e) => { if (e?.status === 404) return { data: [], fetchedAt: new Date() }; throw e; })));
    list = parts.flatMap((p) => p.data);
    fetchedAt = parts[0]?.fetchedAt ?? new Date();
  } else {
    const r = await fetchJson(`/api/metar?bbox=${bbox}`, { ttlMs: 10 * 60e3, validate: vList, source: 'awc', retries: 1 });
    list = r.data;
    fetchedAt = r.fetchedAt;
  }
  const best = list
    .map((m) => ({ ...m, distanceKm: haversineKm(lat, lon, m.lat, m.lon), humidity: m.temp !== null && m.dewp !== null ? rhFromDew(m.temp, m.dewp) : null }))
    .filter((m) => m.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (!best) return null;
  const prov: Provenance = {
    kind: 'observation', producer: `${best.icao} airport weather station (national met service)`,
    provider: STATIC_MODE ? 'NOAA Aviation Weather Center bulk METAR file (copied every ~20 min by GitHub Actions)' : 'NOAA Aviation Weather Center Data API',
    fetchedAt, validTime: best.time, coverage: 'worldwide airports that publish METAR',
    resolution: `single station, ${best.distanceKm.toFixed(0)} km from the selected point`, terms: 'Public domain (US Government work).',
    termsUrl: 'https://aviationweather.gov/data/api/', url: `https://aviationweather.gov/api/data/metar?ids=${best.icao}&format=json`, updateEveryMin: 60,
  };
  return { data: best, prov };
}
