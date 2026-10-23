export type XZ = [number, number];

export interface BuildingData {
  p: XZ[];
  h: number;
  mh?: number;
  k: string;
  e?: 1; // height estimated (no height/levels tag in OSM)
  colo?: string;
  mate?: string;
  shap?: string;
  name?: string;
  holes?: XZ[][];
}

export interface LineData {
  p: XZ[];
  t: string;
  w: number;
  n?: string;
  br?: 1;
}

export interface AreaData {
  title: string;
  bounds: [number, number, number, number];
  spawn: [number, number, number];
  buildings: BuildingData[];
  roads: LineData[];
  paths: LineData[];
  areas: { t: 'plaza' | 'grass' | 'pier'; p: XZ[] }[];
  water: XZ[][];
  land: { p: XZ[]; holes: XZ[][] }[];
  trees: XZ[];
  benches: XZ[];
  lamps: XZ[];
  signals: XZ[];
  labels: { x: number; z: number; n: string }[];
  attribution: string;
}

export type LocationId = 'karljohan' | 'bjorvika' | 'akerbrygge' | 'central';
export type TimePreset = 'sunny' | 'overcast' | 'golden' | 'blue' | 'night';
export type Weather = 'clear' | 'overcast' | 'rain' | 'wet';
export type Season = 'summer' | 'autumn' | 'winter';
export type Quality = 'low' | 'high' | 'ultra';

export interface Settings {
  location: LocationId;
  time: TimePreset;
  weather: Weather;
  season: Season;
  quality: Quality;
  walkSpeed: number; // multiplier, 1 = 1.35 m/s
  sensitivity: number; // multiplier
  reducedMotion: boolean;
  volume: number; // 0..1
  muted: boolean;
}

export const LOCATIONS: { id: LocationId; title: string; blurb: string }[] = [
  { id: 'karljohan', title: 'Karl Johans gate', blurb: 'The main pedestrian street, from Egertorget towards the Royal Palace' },
  { id: 'bjorvika', title: 'Bjørvika', blurb: 'The Opera House waterfront and the Barcode district' },
  { id: 'akerbrygge', title: 'Aker Brygge', blurb: 'Harbour promenade, piers and restaurants' },
  { id: 'central', title: 'Central Oslo', blurb: 'Jernbanetorget, Oslo S and the streets around it' },
];

export const isNight = (t: TimePreset) => t === 'night' || t === 'blue';
