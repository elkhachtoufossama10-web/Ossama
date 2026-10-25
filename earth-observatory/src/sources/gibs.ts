/**
 * NASA Global Imagery Browse Services (GIBS) — WMTS tiles, EPSG:3857 "best" endpoint.
 * Layer identifiers, tile matrix sets, formats, time ranges and legends were extracted from the official
 * GetCapabilities document by scripts/gibs_layers.py (see src/sources/gibs-layers.json).
 * Terms: NASA data are freely usable; credit “NASA Global Imagery Browse Services (GIBS), part of NASA's ESDIS”.
 */
import catalog from './gibs-layers.json';
import type { DataKind, Provenance } from './provenance';

export interface GibsLayer { id: string; title: string; kind: string; tms: string; maxLevel: number; ext: string; legend: string | null; default?: string; period?: string; start?: string; end?: string }
export const GIBS: Record<string, GibsLayer> = catalog as Record<string, GibsLayer>;

export function gibsTemplate(id: string, time: string | null) {
  const l = GIBS[id];
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l.id}/default/${time ?? 'default'}/${l.tms}/{z}/{y}/{x}.${l.ext}`;
}

/**
 * Time value to request for the timeline instant. Daily products are requested by UTC date; dates after the last
 * catalogued date use the "default" keyword, which GIBS resolves to the most recent available image.
 */
export function gibsTime(id: string, at: Date): { time: string | null; label: string; clamped: 'before' | 'after' | null } {
  const l = GIBS[id];
  if (!l.period) return { time: null, label: 'static', clamped: null };
  const start = l.start ? new Date(l.start.length === 10 ? l.start + 'T00:00Z' : l.start) : null;
  if (l.period === 'P1Y') return { time: l.default!, label: l.default!.slice(0, 4), clamped: null };
  if (start && at < start) return { time: l.start!, label: l.start!, clamped: 'before' };
  const now = Date.now();
  if (l.period === 'P1D') {
    const d = new Date(Math.min(at.getTime(), now));
    const s = d.toISOString().slice(0, 10);
    if (at.getTime() > now - 86400e3) return { time: null, label: 'latest', clamped: at.getTime() > now ? 'after' : null };
    return { time: s, label: s, clamped: null };
  }
  if (l.period === 'P1M') {
    const end = new Date(l.end + 'T00:00Z');
    const d = at > end ? end : at;
    const s = `${d.toISOString().slice(0, 7)}-01`;
    return { time: s, label: s.slice(0, 7), clamped: at > end ? 'after' : null };
  }
  if (l.period === 'PT30M') {
    // IMERG early run: latency several hours. Ask for the selected half-hour if it is >6 h old, else the latest.
    if (at.getTime() > now - 6 * 3600e3) return { time: null, label: 'latest', clamped: at.getTime() > now ? 'after' : null };
    const t = new Date(Math.floor(at.getTime() / 1800e3) * 1800e3);
    const s = t.toISOString().slice(0, 19) + 'Z';
    return { time: s, label: s.replace('T', ' ').slice(0, 16) + ' UTC', clamped: null };
  }
  return { time: null, label: 'latest', clamped: null };
}

/** Reads GIBS' `Layer-Time-Actual` header from the level-0 tile, i.e. which date was really served. */
export async function gibsActualTime(id: string, time: string | null): Promise<string | null> {
  try {
    const url = gibsTemplate(id, time).replace('{z}/{y}/{x}', '0/0/0');
    const r = await fetch(url, { method: 'GET' });
    return r.headers.get('layer-time-actual');
  } catch {
    return null;
  }
}

const KIND_INFO: Record<string, { kind: DataKind; producer: string; resolution: string; every: number; notes?: string[] }> = {
  VIIRS_SNPP_CorrectedReflectance_TrueColor: { kind: 'observation', producer: 'NASA LANCE — VIIRS on Suomi NPP', resolution: '250 m (served up to zoom 9 in this projection)', every: 24 * 60, notes: ['Daily mosaic of afternoon passes; swath gaps near the equator are normal.'] },
  AIRS_L2_Surface_Air_Temperature_Day: { kind: 'retrieval', producer: 'NASA JPL — AIRS on Aqua (daytime ascending pass)', resolution: '~45 km footprint', every: 24 * 60, notes: ['Retrieved from infrared soundings; missing under thick cloud.'] },
  AIRS_L2_Surface_Air_Temperature_Night: { kind: 'retrieval', producer: 'NASA JPL — AIRS on Aqua (night-time descending pass)', resolution: '~45 km footprint', every: 24 * 60 },
  AIRS_L2_Surface_Relative_Humidity_Day: { kind: 'retrieval', producer: 'NASA JPL — AIRS on Aqua', resolution: '~45 km footprint', every: 24 * 60 },
  MODIS_Terra_Cloud_Fraction_Day: { kind: 'retrieval', producer: 'NASA — MODIS on Terra (cloud mask product)', resolution: '~5 km', every: 24 * 60 },
  IMERG_Precipitation_Rate_30min: { kind: 'analysis', producer: 'NASA GPM — IMERG Early Run (multi-satellite precipitation)', resolution: '0.1° (~10 km), 30 min', every: 60, notes: ['Satellite-based estimate with ~4 h latency; not a radar measurement.'] },
  MERRA2_2m_Air_Temperature_Monthly: { kind: 'reanalysis', producer: 'NASA GMAO — MERRA-2', resolution: '0.5° × 0.625°, monthly mean', every: 60 * 24 * 40 },
  VIIRS_Black_Marble: { kind: 'observation', producer: 'NASA — VIIRS Black Marble (2016 annual composite)', resolution: '500 m', every: 0, notes: ['City lights composite from 2016, used only to decorate the night side.'] },
  BlueMarble_ShadedRelief_Bathymetry: { kind: 'static', producer: 'NASA Earth Observatory — Blue Marble (MODIS)', resolution: '500 m', every: 0 },
  ASTER_GDEM_Greyscale_Shaded_Relief: { kind: 'static', producer: 'NASA/METI — ASTER GDEM', resolution: '30 m', every: 0 },
};

export function gibsProvenance(id: string, requested: string, actual: string | null, requestedFor?: Date): Provenance {
  const l = GIBS[id];
  const k = KIND_INFO[id] ?? { kind: 'static' as DataKind, producer: 'NASA', resolution: '', every: 0 };
  const vt = actual ? new Date(actual.length === 10 ? actual + 'T12:00Z' : actual) : undefined;
  return {
    kind: k.kind, producer: k.producer, provider: 'NASA GIBS (WMTS)', model: l.title, validTime: vt && !isNaN(vt.getTime()) ? vt : undefined,
    fetchedAt: new Date(), coverage: 'global (Web Mercator, ±85°)', resolution: k.resolution,
    terms: 'NASA imagery is free to use with attribution: “NASA Global Imagery Browse Services (GIBS)”.', termsUrl: 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies',
    url: gibsTemplate(id, requested === 'latest' || requested === 'static' ? null : requested), updateEveryMin: k.every || undefined, requestedFor,
    notes: [...(k.notes ?? []), `Requested: ${requested}${actual ? ` · served: ${actual}` : ''}`],
  };
}
