import { describe, expect, it } from 'vitest';
import { validatePoint } from './openMeteo';
import { computeNormals } from './era5';
import { parseCoords } from './geocoding';
import { gibsTime } from './gibs';
import { staleness, type Provenance } from './provenance';
import { rhFromDew } from './metar';
import { haversineKm } from './nws';
import { series } from './http';

const hours = (n: number) => Array.from({ length: n }, (_, i) => 1792886400 + i * 3600);
const point = (tail: number) => {
  const t = hours(6);
  const v = (x: number) => t.map((_, i) => (i >= 6 - tail ? null : x));
  return {
    latitude: 35.75, longitude: -5.75, elevation: 38, timezone: 'Africa/Casablanca',
    current: { time: 1792888200, temperature_2m: 14.7, apparent_temperature: 14.9, relative_humidity_2m: 96, precipitation: 0, cloud_cover: 42, pressure_msl: 1025.2, wind_speed_10m: 7.8, wind_direction_10m: 77, wind_gusts_10m: 16.2, weather_code: 1, is_day: 0 },
    hourly: { time: t, temperature_2m: v(15), apparent_temperature: v(14), relative_humidity_2m: v(80), precipitation: v(0), cloud_cover: v(10), pressure_msl: v(1020), wind_speed_10m: v(5), wind_direction_10m: v(90) },
    daily: { time: [1792882800], temperature_2m_max: [22], temperature_2m_min: [14], precipitation_sum: [0], sunrise: [1792910000], sunset: [1792950000] },
  };
};

describe('Open-Meteo validation', () => {
  it('accepts a well-formed response and trims hours without model data', () => {
    const p = validatePoint(point(2));
    expect(p.hourly.time.length).toBe(6);
    expect(p.lastValid.getTime()).toBe(hours(6)[3] * 1000);
    expect(p.current.temperature_2m).toBe(14.7);
  });
  it('rejects responses with missing blocks', () => {
    const bad = point(0) as Record<string, unknown>;
    delete bad.hourly;
    expect(() => validatePoint(bad)).toThrow();
  });
  it('rejects series whose length does not match the time axis', () => {
    const bad = point(0);
    bad.hourly.cloud_cover = [1, 2];
    expect(() => validatePoint(bad)).toThrow(/length/);
  });
  it('turns physically impossible values into gaps instead of displaying them', () => {
    expect(series([20, 999, -300, 'x', 10], 't', -95, 65)).toEqual([20, null, null, null, 10]);
    const p = point(0);
    p.current.relative_humidity_2m = 140;
    expect(validatePoint(p).current.relative_humidity_2m).toBeNull();
  });
});

describe('climate normals', () => {
  it('averages daily values per month and converts precipitation to monthly totals', () => {
    const dates: string[] = [], tmax: number[] = [], tmin: number[] = [], precip: number[] = [];
    for (const y of [2001, 2002]) for (let d = 1; d <= 31; d++) { dates.push(`${y}-01-${String(d).padStart(2, '0')}`); tmax.push(y === 2001 ? 16 : 18); tmin.push(8); precip.push(2); }
    const n = computeNormals({ dates, tmax, tmin, tmean: dates.map(() => null), precip });
    expect(n.months[0].tmax).toBe(17);
    expect(n.months[0].tmin).toBe(8);
    expect(n.months[0].precip).toBeCloseTo(62, 6);
    expect(n.months[5].tmax).toBeNull();
    expect(n.years).toBe('2001–2002');
  });
});

describe('coordinate input (no network needed)', () => {
  it('parses decimal pairs and hemisphere letters', () => {
    expect(parseCoords('35.76, -5.83')).toEqual({ lat: 35.76, lon: -5.83 });
    expect(parseCoords('33.92S 18.42E')).toEqual({ lat: -33.92, lon: 18.42 });
    expect(parseCoords('95, 10')).toBeNull();
    expect(parseCoords('Tangier')).toBeNull();
  });
});

describe('GIBS time selection', () => {
  it('uses the "default" (latest) keyword for today and the future, a date for the past', () => {
    expect(gibsTime('VIIRS_SNPP_CorrectedReflectance_TrueColor', new Date(Date.now() + 3 * 86400e3))).toMatchObject({ time: null, clamped: 'after' });
    expect(gibsTime('VIIRS_SNPP_CorrectedReflectance_TrueColor', new Date('2024-06-21T12:00Z')).time).toBe('2024-06-21');
    expect(gibsTime('VIIRS_SNPP_CorrectedReflectance_TrueColor', new Date('2000-01-01T00:00Z')).clamped).toBe('before');
    expect(gibsTime('MERRA2_2m_Air_Temperature_Monthly', new Date('2010-07-19T00:00Z')).time).toBe('2010-07-01');
    expect(gibsTime('BlueMarble_ShadedRelief_Bathymetry', new Date()).time).toBeNull();
  });
});

describe('staleness', () => {
  const base: Provenance = { kind: 'observation', producer: 'x', provider: 'x', fetchedAt: new Date(), coverage: '', resolution: '', terms: '', termsUrl: '', updateEveryMin: 60 };
  const now = new Date('2026-10-25T12:00Z');
  it('flags old observations relative to now', () => {
    expect(staleness({ ...base, validTime: new Date('2026-10-25T11:30Z') }, now)).toBe('fresh');
    expect(staleness({ ...base, validTime: new Date('2026-10-25T10:20Z') }, now)).toBe('aging');
    expect(staleness({ ...base, validTime: new Date('2026-10-25T06:00Z') }, now)).toBe('stale');
  });
  it('does not flag data the user deliberately requested for a past time', () => {
    expect(staleness({ ...base, validTime: new Date('2024-06-21T12:00Z'), requestedFor: new Date('2024-06-21T12:30Z') }, now)).toBe('fresh');
  });
  it('judges forecasts by their model run time', () => {
    expect(staleness({ ...base, kind: 'forecast', updateEveryMin: 360, runTime: new Date('2026-10-24T00:00Z'), validTime: new Date('2026-10-30T00:00Z') }, now)).toBe('stale');
  });
});

describe('derived quantities', () => {
  it('relative humidity from dew point (Magnus)', () => {
    expect(rhFromDew(19, 16)).toBeCloseTo(83, 0);
    expect(rhFromDew(20, 20)).toBeCloseTo(100, 6);
  });
  it('great-circle distance Tangier–Cape Town: 8 148 km on the sphere (WGS84 geodesic: 8 116 km)', () => {
    expect(haversineKm(35.7673, -5.7998, -33.9249, 18.4241)).toBeCloseTo(8147.8, 0);
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
  });
});
