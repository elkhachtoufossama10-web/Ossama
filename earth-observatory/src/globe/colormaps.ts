/** Colour scales for the gridded model layer. Each stop: [value, r, g, b]. Same scales drive the legends. */
export type Stop = [number, number, number, number];
export interface Scale { stops: Stop[]; unit: string; ticks: number[] }

export const SCALES: Record<string, Scale> = {
  temperature_2m: {
    unit: '°C', ticks: [-40, -20, 0, 10, 20, 30, 40],
    stops: [[-45, 40, 0, 90], [-30, 70, 40, 180], [-15, 40, 120, 230], [0, 150, 220, 250], [10, 120, 210, 120], [20, 250, 230, 90], [30, 250, 140, 40], [40, 210, 30, 30], [50, 120, 0, 40]],
  },
  apparent_temperature: {
    unit: '°C', ticks: [-40, -20, 0, 10, 20, 30, 40],
    stops: [[-50, 40, 0, 90], [-30, 70, 40, 180], [-15, 40, 120, 230], [0, 150, 220, 250], [10, 120, 210, 120], [20, 250, 230, 90], [30, 250, 140, 40], [40, 210, 30, 30], [55, 120, 0, 40]],
  },
  relative_humidity_2m: { unit: '%', ticks: [0, 25, 50, 75, 100], stops: [[0, 140, 90, 40], [30, 220, 190, 120], [60, 120, 200, 170], [80, 40, 140, 200], [100, 20, 50, 160]] },
  cloud_cover: { unit: '%', ticks: [0, 25, 50, 75, 100], stops: [[0, 20, 30, 50], [30, 90, 100, 120], [70, 180, 185, 195], [100, 245, 245, 250]] },
  precipitation: { unit: 'mm/h', ticks: [0, 0.5, 2, 5, 10], stops: [[0, 0, 0, 0], [0.1, 120, 200, 250], [1, 40, 120, 230], [3, 60, 200, 80], [6, 250, 220, 40], [10, 240, 60, 40], [20, 180, 0, 160]] },
  wind_speed_10m: { unit: 'km/h', ticks: [0, 20, 40, 60, 90], stops: [[0, 40, 60, 110], [15, 60, 150, 200], [30, 90, 200, 120], [45, 240, 220, 80], [65, 240, 120, 40], [90, 200, 30, 90], [130, 120, 0, 120]] },
  pressure_msl: { unit: 'hPa', ticks: [970, 990, 1010, 1030], stops: [[960, 120, 40, 160], [985, 60, 110, 220], [1005, 130, 210, 220], [1015, 240, 240, 200], [1025, 240, 170, 80], [1040, 190, 60, 50]] },
};

export function colorAt(scale: Scale, v: number): [number, number, number] {
  const s = scale.stops;
  if (v <= s[0][0]) return [s[0][1], s[0][2], s[0][3]];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const a = s[i - 1], b = s[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2]), a[3] + t * (b[3] - a[3])];
    }
  }
  const l = s[s.length - 1];
  return [l[1], l[2], l[3]];
}

export function gradientCss(scale: Scale) {
  const lo = scale.stops[0][0], hi = scale.stops[scale.stops.length - 1][0];
  return `linear-gradient(to right, ${scale.stops.map((s) => `rgb(${s[1]},${s[2]},${s[3]}) ${(((s[0] - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ')})`;
}
