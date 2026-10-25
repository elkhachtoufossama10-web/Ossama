/**
 * Solar geometry for any place and time — runs fully offline.
 *
 * Positions come from astronomy-engine (Don Cross, MIT), which implements VSOP87 for the Earth and
 * IAU precession/nutation; its sun positions agree with JPL Horizons to well under an arcminute.
 * Sunrise/sunset use the standard definition: the sun's upper limb on a sea-level horizon with
 * 34′ standard refraction (geometric centre altitude −0.833°). Local terrain and weather are ignored,
 * so real observed times can differ by a minute or two (more in mountains or near the poles).
 */
import * as A from 'astronomy-engine';

export const SOLAR_CONSTANT = 1361; // W/m² (Kopp & Lean 2011, TSI at 1 AU)
const DEG = Math.PI / 180;

export type LightState = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

export interface SunNow {
  altitude: number; // apparent altitude (with refraction), degrees
  geometricAltitude: number; // without refraction, degrees
  azimuth: number; // degrees from north, clockwise
  zenith: number; // geometric zenith angle, degrees
  incidence: number; // angle between rays and the horizontal ground = geometricAltitude (0 if below)
  distanceAU: number;
  state: LightState;
  /** extraterrestrial irradiance on a horizontal surface (top of atmosphere), W/m² */
  toaHorizontal: number;
  /** relative optical air mass (Kasten & Young 1989); null if the sun is below the horizon */
  airMass: number | null;
  /** how much the same beam is spread on flat ground compared with a vertical sun (1/sin h) */
  spreadFactor: number | null;
}

export interface DayInfo {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date | null;
  noonAltitude: number;
  dayLengthHours: number; // time with the sun's upper limb above the horizon
  polar: 'none' | 'midnight-sun' | 'polar-night';
  civilDawn: Date | null;
  civilDusk: Date | null;
  /** daily mean extraterrestrial irradiance on a horizontal surface, W/m² (24-h average) */
  toaDailyMean: number;
  /** same as an energy total, MJ/m² per day */
  toaDailyMJ: number;
}

export function sunAt(date: Date, lat: number, lon: number, elevation = 0): SunNow {
  const obs = new A.Observer(lat, lon, elevation);
  const eq = A.Equator(A.Body.Sun, date, obs, true, true);
  const hor = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
  const geo = A.Horizon(date, obs, eq.ra, eq.dec);
  const alt = hor.altitude;
  const gAlt = geo.altitude;
  const r = A.HelioDistance(A.Body.Earth, date);
  const sinh = Math.max(0, Math.sin(gAlt * DEG));
  return {
    altitude: alt,
    geometricAltitude: gAlt,
    azimuth: hor.azimuth,
    zenith: 90 - gAlt,
    incidence: Math.max(0, gAlt),
    distanceAU: r,
    state: lightState(gAlt),
    toaHorizontal: (SOLAR_CONSTANT / (r * r)) * sinh,
    airMass: alt > 0 ? airMass(alt) : null,
    spreadFactor: gAlt > 0.5 ? 1 / sinh : null,
  };
}

/** Twilight classification uses the geometric altitude of the sun's centre. */
export function lightState(geometricAltitude: number): LightState {
  if (geometricAltitude > -0.833) return 'day';
  if (geometricAltitude > -6) return 'civil';
  if (geometricAltitude > -12) return 'nautical';
  if (geometricAltitude > -18) return 'astronomical';
  return 'night';
}

/** Kasten & Young (1989) relative air mass for apparent altitude h (degrees). */
export function airMass(h: number) {
  const z = 90 - h;
  return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

/**
 * Sun events for the local civil day that contains `dayStart` (pass local midnight as a UTC instant).
 */
export function dayInfo(dayStart: Date, lat: number, lon: number): DayInfo {
  const obs = new A.Observer(lat, lon, 0);
  const t0 = A.MakeTime(dayStart);
  const rise = A.SearchRiseSet(A.Body.Sun, obs, +1, t0, 1);
  const set = A.SearchRiseSet(A.Body.Sun, obs, -1, t0, 1);
  const noon = A.SearchHourAngle(A.Body.Sun, obs, 0, t0, +1);
  const dawn = A.SearchAltitude(A.Body.Sun, obs, +1, t0, 1, -6);
  const dusk = A.SearchAltitude(A.Body.Sun, obs, -1, t0, 1, -6);
  // Sample the 24 h at 2-minute steps: robust day length (also for polar day/night) + energy integral
  const step = 2 * 60 * 1000;
  let up = 0;
  let energy = 0; // J/m²
  const start = dayStart.getTime();
  for (let t = start; t < start + 86400000; t += step) {
    const d = new Date(t + step / 2);
    const eq = A.Equator(A.Body.Sun, d, obs, true, true);
    const h = A.Horizon(d, obs, eq.ra, eq.dec);
    if (h.altitude > -0.833) up += step;
    const r = A.HelioDistance(A.Body.Earth, d);
    energy += (SOLAR_CONSTANT / (r * r)) * Math.max(0, Math.sin(h.altitude * DEG)) * (step / 1000);
  }
  const dayLengthHours = up / 3600000;
  const noonAlt = noon ? sunAt(noon.time.date, lat, lon).altitude : NaN;
  const r = (x: A.AstroTime | null) => (x ? x.date : null);
  return {
    sunrise: r(rise),
    sunset: r(set),
    solarNoon: noon ? noon.time.date : null,
    noonAltitude: noonAlt,
    dayLengthHours,
    polar: dayLengthHours > 23.95 ? 'midnight-sun' : dayLengthHours < 0.05 ? 'polar-night' : 'none',
    civilDawn: r(dawn),
    civilDusk: r(dusk),
    toaDailyMean: energy / 86400,
    toaDailyMJ: energy / 1e6,
  };
}

/** Point on Earth where the sun is at the zenith. */
export function subsolarPoint(date: Date) {
  const t = A.MakeTime(date);
  const eq = A.Equator(A.Body.Sun, t, new A.Observer(0, 0, 0), true, true);
  const gast = A.SiderealTime(t); // hours
  let lon = (eq.ra - gast) * 15;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: eq.dec, lon };
}

/** Mean obliquity of the ecliptic (IAU 2006 / Capitaine et al. 2003), degrees. */
export function obliquity(date: Date) {
  const T = (A.MakeTime(date).tt) / 36525;
  const arcsec = 84381.406 - 46.836769 * T - 0.0001831 * T * T + 0.0020034 * T ** 3 - 0.000000576 * T ** 4 - 0.0000000434 * T ** 5;
  return arcsec / 3600;
}

export interface SeasonMarks {
  marchEquinox: Date;
  juneSolstice: Date;
  septemberEquinox: Date;
  decemberSolstice: Date;
  perihelion: Date;
  aphelion: Date;
}

export function seasonMarks(year: number): SeasonMarks {
  const s = A.Seasons(year);
  const peri = A.SearchPlanetApsis(A.Body.Earth, A.MakeTime(new Date(Date.UTC(year, 0, 1)) ));
  let p = peri;
  let perihelion = new Date(NaN), aphelion = new Date(NaN);
  for (let i = 0; i < 3; i++) {
    if (p.kind === A.ApsisKind.Pericenter && p.time.date.getUTCFullYear() === year && isNaN(perihelion.getTime())) perihelion = p.time.date;
    if (p.kind === A.ApsisKind.Apocenter && p.time.date.getUTCFullYear() === year && isNaN(aphelion.getTime())) aphelion = p.time.date;
    p = A.NextPlanetApsis(A.Body.Earth, p);
  }
  return {
    marchEquinox: s.mar_equinox.date,
    juneSolstice: s.jun_solstice.date,
    septemberEquinox: s.sep_equinox.date,
    decemberSolstice: s.dec_solstice.date,
    perihelion,
    aphelion,
  };
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Astronomical season in each hemisphere (bounded by equinoxes and solstices). */
export function astronomicalSeason(date: Date): { north: Season; south: Season; next: { name: keyof SeasonMarks; date: Date } } {
  const y = date.getUTCFullYear();
  const m = seasonMarks(y);
  const t = date.getTime();
  let north: Season;
  if (t < m.marchEquinox.getTime()) north = 'winter';
  else if (t < m.juneSolstice.getTime()) north = 'spring';
  else if (t < m.septemberEquinox.getTime()) north = 'summer';
  else if (t < m.decemberSolstice.getTime()) north = 'autumn';
  else north = 'winter';
  const opposite: Record<Season, Season> = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };
  const marks: [keyof SeasonMarks, Date][] = [
    ['marchEquinox', m.marchEquinox],
    ['juneSolstice', m.juneSolstice],
    ['septemberEquinox', m.septemberEquinox],
    ['decemberSolstice', m.decemberSolstice],
  ];
  let next = marks.find(([, d]) => d.getTime() > t);
  if (!next) next = ['marchEquinox', seasonMarks(y + 1).marchEquinox];
  return { north, south: opposite[north], next: { name: next[0], date: next[1] } };
}

/** Earth's heliocentric position in the ecliptic J2000 frame (AU) and the direction of its north pole. */
export function orbitState(date: Date) {
  const t = A.MakeTime(date);
  const v = A.HelioVector(A.Body.Earth, t);
  const rot = A.Rotation_EQJ_ECL();
  const ecl = A.RotateVector(rot, v);
  // Earth's rotation axis (true pole of date) expressed in the J2000 ecliptic frame.
  const poleOfDate = new A.Vector(0, 0, 1, t);
  const toJ2000 = A.Rotation_EQD_EQJ(t);
  const poleJ2000 = A.RotateVector(toJ2000, poleOfDate);
  const pole = A.RotateVector(rot, poleJ2000);
  const sun = A.SunPosition(t); // apparent ecliptic longitude of the sun (of date)
  return { x: ecl.x, y: ecl.y, z: ecl.z, r: Math.hypot(ecl.x, ecl.y, ecl.z), pole: { x: pole.x, y: pole.y, z: pole.z }, sunLongitude: sun.elon };
}

// ---------------------------------------------------------------- hypothetical tilt experiments
/**
 * Educational model: declination for a planet like Earth but with axial tilt `tiltDeg`.
 * δ = asin(sin ε · sin λ), with λ the sun's ecliptic longitude on that date. Orbit and distance are Earth's.
 */
export function hypotheticalDeclination(date: Date, tiltDeg: number) {
  const lambda = A.SunPosition(A.MakeTime(date)).elon * DEG;
  return Math.asin(Math.sin(tiltDeg * DEG) * Math.sin(lambda)) / DEG;
}

/** Analytic day length (hours) and daily-mean TOA insolation (W/m²) for latitude φ and declination δ. */
export function analyticDay(latDeg: number, declDeg: number, distanceAU = 1, refractionCorrection = false) {
  const phi = latDeg * DEG, d = declDeg * DEG;
  const h0Alt = refractionCorrection ? -0.833 * DEG : 0;
  const cosH = (Math.sin(h0Alt) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  const H = cosH <= -1 ? Math.PI : cosH >= 1 ? 0 : Math.acos(cosH);
  const dayLength = (2 * H) / (15 * DEG);
  // Berger (1978) daily insolation; uses geometric (h=0) sunrise
  const cosH0 = -Math.tan(phi) * Math.tan(d);
  const H0 = cosH0 <= -1 ? Math.PI : cosH0 >= 1 ? 0 : Math.acos(cosH0);
  const Q = (SOLAR_CONSTANT / Math.PI / (distanceAU * distanceAU)) * (H0 * Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.sin(H0));
  return { dayLength, dailyMean: Math.max(0, Q), noonAltitude: 90 - Math.abs(latDeg - declDeg) };
}

export function distanceAU(date: Date) {
  return A.HelioDistance(A.Body.Earth, date);
}

export const AU_KM = 149597870.7;
