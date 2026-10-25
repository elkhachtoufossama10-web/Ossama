import { arr, fetchJson, num, obj, roundCoord, str, type Validator } from './http';
import type { Place } from '../store';

export interface SearchHit extends Place { population?: number; timezone?: string }

const vSearch: Validator<SearchHit[]> = (x) => {
  const o = obj(x, 'geocoding');
  if (!o.results) return [];
  return arr(o.results, 'results').map((e) => {
    const r = obj(e, 'result');
    return {
      id: 'g' + String(r.id), name: str(r.name, 'name'), lat: num(r.latitude, 'latitude'), lon: num(r.longitude, 'longitude'), origin: 'search' as const,
      country: typeof r.country === 'string' ? r.country : undefined, admin: typeof r.admin1 === 'string' ? r.admin1 : undefined,
      population: typeof r.population === 'number' ? r.population : undefined, timezone: typeof r.timezone === 'string' ? r.timezone : undefined,
    };
  });
};

/** Place search — Open-Meteo geocoding API (GeoNames data, CC BY 4.0). Only the typed text is sent. */
export async function searchPlaces(q: string, lang: 'ar' | 'en') {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=${lang}&format=json`;
  return (await fetchJson(url, { ttlMs: 24 * 3600e3, validate: vSearch, source: 'geocoding' })).data;
}

/** Parses "35.76, -5.83" or "35.76N 5.83W" so users can type coordinates without any network request. */
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSشج])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWقغ])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2] && /[Sج]/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /[Wغ]/i.test(m[4])) lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

let lastReverse = 0;
/**
 * Reverse geocoding with OpenStreetMap Nominatim (ODbL). Usage policy: max 1 request/s, no bulk use, attribution.
 * Coordinates are rounded to 2 decimals (~1 km) before being sent. Can be turned off in Settings.
 */
export async function reverseGeocode(lat: number, lon: number, lang: 'ar' | 'en'): Promise<{ name: string; country?: string; admin?: string } | null> {
  const wait = 1100 - (Date.now() - lastReverse);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReverse = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${roundCoord(lat)}&lon=${roundCoord(lon)}&zoom=10&format=jsonv2&accept-language=${lang}`;
  const r = await fetchJson(url, {
    ttlMs: 7 * 86400e3, source: 'nominatim', retries: 0,
    validate: (x) => {
      const o = obj(x, 'reverse');
      if (o.error) return null;
      const a = obj(o.address ?? {}, 'address');
      const name = String(a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? o.name ?? '');
      return name ? { name, country: typeof a.country === 'string' ? a.country : undefined, admin: typeof a.state === 'string' ? a.state : undefined } : null;
    },
  });
  return r.data;
}
