import { useSyncExternalStore } from 'react';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** where the coordinates came from — matters for privacy (device location is rounded) */
  origin: 'search' | 'click' | 'device' | 'preset' | 'coords';
  country?: string;
  admin?: string;
}

export type TempUnit = 'C' | 'F';
export type WindUnit = 'kmh' | 'ms' | 'kn';
export type TimeMode = 'local' | 'utc';

export interface LayerState {
  base: 'BlueMarble_ShadedRelief_Bathymetry' | 'VIIRS_SNPP_CorrectedReflectance_TrueColor' | 'ASTER_GDEM_Greyscale_Shaded_Relief';
  nightLights: boolean;
  borders: boolean;
  labels: boolean;
  graticule: boolean;
  terminator: boolean;
  /** satellite / analysis overlays from NASA GIBS */
  gibs: string | null;
  gibsOpacity: number;
  /** gridded model field from ECMWF IFS (via Open-Meteo) */
  model: null | 'temperature_2m' | 'apparent_temperature' | 'cloud_cover' | 'precipitation' | 'wind_speed_10m' | 'pressure_msl' | 'relative_humidity_2m';
  modelOpacity: number;
}

export interface AppState {
  time: Date;
  /** true while the clock follows real time */
  live: boolean;
  playing: boolean;
  /** simulated seconds per real second */
  speed: number;
  selected: Place | null;
  pins: Place[];
  layers: LayerState;
  tempUnit: TempUnit;
  windUnit: WindUnit;
  timeMode: TimeMode;
  reverseGeocode: boolean;
  view: 'globe' | 'orbit';
  panel: 'place' | 'seasons' | 'tilt' | 'compare' | 'sources' | 'settings' | 'glossary' | null;
}

const saved = (() => {
  try { return JSON.parse(localStorage.getItem('eo.prefs') || '{}'); } catch { return {}; }
})();

let state: AppState = {
  time: new Date(),
  live: true,
  playing: false,
  speed: 3600,
  selected: null,
  pins: Array.isArray(saved.pins) ? saved.pins : [],
  layers: {
    base: 'BlueMarble_ShadedRelief_Bathymetry',
    nightLights: true,
    borders: true,
    labels: false,
    graticule: true,
    terminator: true,
    gibs: null,
    gibsOpacity: 0.8,
    model: null,
    modelOpacity: 0.7,
    ...(saved.layers || {}),
  },
  tempUnit: saved.tempUnit || 'C',
  windUnit: saved.windUnit || 'kmh',
  timeMode: saved.timeMode || 'local',
  reverseGeocode: saved.reverseGeocode ?? true,
  view: 'globe',
  panel: 'place',
};

const subs = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if ('pins' in p || 'layers' in p || 'tempUnit' in p || 'windUnit' in p || 'timeMode' in p || 'reverseGeocode' in p) {
    try {
      localStorage.setItem('eo.prefs', JSON.stringify({
        pins: state.pins, layers: state.layers, tempUnit: state.tempUnit, windUnit: state.windUnit,
        timeMode: state.timeMode, reverseGeocode: state.reverseGeocode,
      }));
    } catch { /* storage unavailable: preferences are just not remembered */ }
  }
  subs.forEach((f) => f());
}
export function setLayers(patch: Partial<LayerState>) {
  setState((s) => ({ layers: { ...s.layers, ...patch } }));
}
export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => sel(state));
}
export function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

export const PRESETS: Place[] = [
  { id: 'tangier', name: 'طنجة', lat: 35.7673, lon: -5.7998, origin: 'preset', country: 'المغرب' },
  { id: 'capetown', name: 'كيب تاون', lat: -33.9249, lon: 18.4241, origin: 'preset', country: 'جنوب أفريقيا' },
  { id: 'tromso', name: 'ترومسو', lat: 69.6496, lon: 18.956, origin: 'preset', country: 'النرويج' },
  { id: 'quito', name: 'كيتو', lat: -0.1807, lon: -78.4678, origin: 'preset', country: 'الإكوادور' },
  { id: 'buenosaires', name: 'بوينس آيرس', lat: -34.6037, lon: -58.3816, origin: 'preset', country: 'الأرجنتين' },
  { id: 'marrakech', name: 'مراكش', lat: 31.6295, lon: -7.9811, origin: 'preset', country: 'المغرب' },
];
