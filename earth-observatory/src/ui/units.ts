import type { TempUnit, WindUnit } from '../store';

export const fmtTemp = (c: number | null | undefined, u: TempUnit, digits = 1) =>
  c === null || c === undefined || !Number.isFinite(c) ? '—' : u === 'C' ? `${c.toFixed(digits)}°C` : `${(c * 1.8 + 32).toFixed(digits)}°F`;
export const toTemp = (c: number | null, u: TempUnit) => (c === null ? null : u === 'C' ? c : c * 1.8 + 32);
export const fmtWind = (kmh: number | null | undefined, u: WindUnit) =>
  kmh === null || kmh === undefined ? '—' : u === 'kmh' ? `${kmh.toFixed(0)} km/h` : u === 'ms' ? `${(kmh / 3.6).toFixed(1)} m/s` : `${(kmh / 1.852).toFixed(0)} kn`;
export const fmtNum = (v: number | null | undefined, digits = 0, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit}`);
export const fmtCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;

const DIRS_AR = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
const DIRS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number | null, ar: boolean) => (deg === null ? '—' : (ar ? DIRS_AR : DIRS_EN)[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
