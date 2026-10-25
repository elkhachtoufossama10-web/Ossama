/**
 * US National Weather Service API (https://www.weather.gov/documentation/services-web-api) — NOAA, public domain.
 * Coverage: United States and territories only. Outside it the API answers 404 and we say so.
 */
import { arr, fetchJson, num, numOrNull, obj, roundCoord, str, type Validator } from './http';
import type { Provenance } from './provenance';

const API = 'https://api.weather.gov';
const TERMS = 'NOAA/NWS data are US Government works in the public domain.';
const TERMS_URL = 'https://www.weather.gov/disclaimer';

/** rough boxes for CONUS, Alaska, Hawaii, Puerto Rico/USVI, Guam — avoids pointless requests elsewhere */
export function maybeUS(lat: number, lon: number) {
  return (lat > 24 && lat < 50 && lon > -125.5 && lon < -66) || (lat > 51 && lat < 72 && (lon < -129 || lon > 172)) ||
    (lat > 18.5 && lat < 22.5 && lon > -161 && lon < -154) || (lat > 17.5 && lat < 18.6 && lon > -67.5 && lon < -64.5) ||
    (lat > 13 && lat < 21 && lon > 144 && lon < 146.5);
}

interface PointInfo { forecastHourly: string; stations: string; office: string; city: string; state: string }
const vPoint: Validator<PointInfo> = (x) => {
  const p = obj(obj(x, 'points').properties, 'properties');
  const rel = obj(obj(p.relativeLocation, 'relativeLocation').properties, 'relativeLocation.properties');
  return { forecastHourly: str(p.forecastHourly, 'forecastHourly'), stations: str(p.observationStations, 'observationStations'), office: str(p.gridId, 'gridId'), city: String(rel.city ?? ''), state: String(rel.state ?? '') };
};

export interface NwsAlert { id: string; event: string; severity: string; urgency: string; headline: string; description: string; instruction: string; onset: Date | null; ends: Date | null; sender: string; url: string }
const vAlerts: Validator<{ alerts: NwsAlert[]; updated: Date }> = (x) => {
  const o = obj(x, 'alerts');
  return {
    updated: new Date(String(o.updated ?? Date.now())),
    alerts: arr(o.features, 'features').map((f) => {
      const p = obj(obj(f, 'feature').properties, 'properties');
      return {
        id: String(p.id), event: String(p.event ?? ''), severity: String(p.severity ?? ''), urgency: String(p.urgency ?? ''),
        headline: String(p.headline ?? ''), description: String(p.description ?? ''), instruction: String(p.instruction ?? ''),
        onset: p.onset ? new Date(String(p.onset)) : null, ends: p.ends ? new Date(String(p.ends)) : p.expires ? new Date(String(p.expires)) : null,
        sender: String(p.senderName ?? 'NWS'), url: String(p['@id'] ?? ''),
      };
    }),
  };
};

export async function nwsAlerts(lat: number, lon: number) {
  const url = `${API}/alerts/active?point=${roundCoord(lat, 4)},${roundCoord(lon, 4)}`;
  const r = await fetchJson(url, { ttlMs: 5 * 60e3, validate: vAlerts, source: 'nws' });
  const prov: Provenance = {
    kind: 'analysis', producer: 'NOAA National Weather Service', provider: 'api.weather.gov', fetchedAt: r.fetchedAt, validTime: r.data.updated,
    coverage: 'United States and territories', resolution: 'official warning polygons / zones', terms: TERMS, termsUrl: TERMS_URL, url, updateEveryMin: 5,
  };
  return { data: r.data.alerts, prov };
}

export interface NwsObs { station: string; name: string; time: Date; temp: number | null; humidity: number | null; wind: number | null; windDir: number | null; pressure: number | null; text: string; distanceKm: number }

export async function nwsLatestObservation(lat: number, lon: number) {
  const p = await fetchJson(`${API}/points/${roundCoord(lat, 4)},${roundCoord(lon, 4)}`, { ttlMs: 24 * 3600e3, validate: vPoint, source: 'nws' });
  const st = await fetchJson(p.data.stations, {
    ttlMs: 24 * 3600e3, source: 'nws',
    validate: (x) => arr(obj(x, 'stations').features, 'features').slice(0, 3).map((f) => {
      const g = obj(obj(f, 'f').geometry, 'geometry');
      const c = arr(g.coordinates, 'coordinates');
      const pr = obj(obj(f, 'f').properties, 'properties');
      return { id: str(pr.stationIdentifier, 'stationIdentifier'), name: String(pr.name ?? ''), lon: num(c[0], 'lon'), lat: num(c[1], 'lat') };
    }),
  });
  const s = st.data[0];
  if (!s) throw new Error('no station');
  const url = `${API}/stations/${s.id}/observations/latest`;
  const r = await fetchJson(url, {
    ttlMs: 10 * 60e3, source: 'nws',
    validate: (x): NwsObs => {
      const pr = obj(obj(x, 'obs').properties, 'properties');
      const v = (k: string) => numOrNull(obj(pr[k] ?? {}, k).value);
      return {
        station: s.id, name: s.name, time: new Date(str(pr.timestamp, 'timestamp')), temp: v('temperature'), humidity: v('relativeHumidity'),
        wind: v('windSpeed'), windDir: v('windDirection'), pressure: v('seaLevelPressure') !== null ? v('seaLevelPressure')! / 100 : null,
        text: String(pr.textDescription ?? ''), distanceKm: haversineKm(lat, lon, s.lat, s.lon),
      };
    },
  });
  const prov: Provenance = {
    kind: 'observation', producer: 'NOAA National Weather Service (ASOS/AWOS station)', provider: 'api.weather.gov', fetchedAt: r.fetchedAt, validTime: r.data.time,
    coverage: 'United States', resolution: `single station ${s.id}, ${r.data.distanceKm.toFixed(0)} km away`, terms: TERMS, termsUrl: TERMS_URL, url, updateEveryMin: 60,
  };
  return { data: r.data, prov, office: p.data.office };
}

export function haversineKm(a: number, b: number, c: number, d: number) {
  const R = 6371.0088, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
