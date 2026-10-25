import { describe, expect, it } from 'vitest';
import {
  airMass, analyticDay, astronomicalSeason, dayInfo, hypotheticalDeclination, lightState, obliquity,
  orbitState, seasonMarks, subsolarPoint, sunAt,
} from './solar';
import { localMidnight, timeZoneAt, zoneOffsetMinutes } from './time';

const min = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60000;

describe('equinoxes and solstices (reference: US Naval Observatory, 2024)', () => {
  const m = seasonMarks(2024);
  it('March equinox 2024-03-20 03:06 UTC', () => expect(min(m.marchEquinox, new Date('2024-03-20T03:06Z'))).toBeLessThan(2));
  it('June solstice 2024-06-20 20:51 UTC', () => expect(min(m.juneSolstice, new Date('2024-06-20T20:51Z'))).toBeLessThan(2));
  it('September equinox 2024-09-22 12:44 UTC', () => expect(min(m.septemberEquinox, new Date('2024-09-22T12:44Z'))).toBeLessThan(2));
  it('December solstice 2024-12-21 09:20 UTC', () => expect(min(m.decemberSolstice, new Date('2024-12-21T09:20Z'))).toBeLessThan(2));
  it('perihelion 2024-01-03 ~00:39 UTC and aphelion 2024-07-05 ~05:06 UTC', () => {
    expect(min(m.perihelion, new Date('2024-01-03T00:39Z'))).toBeLessThan(90);
    expect(min(m.aphelion, new Date('2024-07-05T05:06Z'))).toBeLessThan(90);
  });
});

describe('subsolar point', () => {
  it('is at ~+23.44° at the June solstice', () => {
    const p = subsolarPoint(seasonMarks(2024).juneSolstice);
    expect(p.lat).toBeGreaterThan(23.4);
    expect(p.lat).toBeLessThan(23.47);
  });
  it('is at ~−23.44° at the December solstice', () => {
    expect(subsolarPoint(seasonMarks(2024).decemberSolstice).lat).toBeCloseTo(-23.44, 1);
  });
  it('is on the equator at the equinoxes', () => {
    expect(Math.abs(subsolarPoint(seasonMarks(2024).marchEquinox).lat)).toBeLessThan(0.01);
    expect(Math.abs(subsolarPoint(seasonMarks(2024).septemberEquinox).lat)).toBeLessThan(0.01);
  });
  it('longitude is near 0° at 12:00 UTC (within the equation of time, ±4.5°)', () => {
    const p = subsolarPoint(new Date('2024-04-15T12:00Z'));
    expect(Math.abs(p.lon)).toBeLessThan(4.5);
  });
  it('the sun is overhead at the subsolar point', () => {
    const d = new Date('2024-08-01T09:30Z');
    const p = subsolarPoint(d);
    expect(sunAt(d, p.lat, p.lon).geometricAltitude).toBeGreaterThan(89.9);
  });
});

describe('obliquity', () => {
  it('is 23.4393° at J2000 and ~23.436° in 2026', () => {
    expect(obliquity(new Date('2000-01-01T12:00Z'))).toBeCloseTo(23.4393, 3);
    expect(obliquity(new Date('2026-06-01T00:00Z'))).toBeCloseTo(23.4359, 3);
  });
});

describe('sunrise / sunset (reference: NOAA Solar Calculator)', () => {
  it('Greenwich 2024-06-21: rise ≈ 03:43 UTC, set ≈ 20:21 UTC', () => {
    const d = dayInfo(new Date('2024-06-21T00:00Z'), 51.4769, 0);
    expect(min(d.sunrise!, new Date('2024-06-21T03:43Z'))).toBeLessThan(3);
    expect(min(d.sunset!, new Date('2024-06-21T20:21Z'))).toBeLessThan(3);
    expect(d.dayLengthHours).toBeGreaterThan(16.5);
    expect(d.dayLengthHours).toBeLessThan(16.7);
  });
  it('Tangier 2024-12-21: rise ≈ 07:28 UTC (local UTC+1 08:28), day length ≈ 9 h 47 m', () => {
    const tz = timeZoneAt(35.7595, -5.834);
    const day = localMidnight(new Date('2024-12-21T12:00Z'), tz);
    const d = dayInfo(day, 35.7595, -5.834);
    expect(min(d.sunrise!, new Date('2024-12-21T07:28Z'))).toBeLessThan(4);
    expect(d.dayLengthHours).toBeGreaterThan(9.65);
    expect(d.dayLengthHours).toBeLessThan(9.9);
  });
  it('equator at the March equinox: day slightly longer than 12 h because of refraction and the solar disc (~12 h 07 m)', () => {
    const d = dayInfo(new Date('2024-03-20T00:00Z'), 0, 0);
    expect(d.dayLengthHours).toBeGreaterThan(12.08);
    expect(d.dayLengthHours).toBeLessThan(12.15);
  });
  it('Tromsø has midnight sun at the June solstice and polar night in December', () => {
    expect(dayInfo(new Date('2024-06-20T22:00Z'), 69.65, 18.96).polar).toBe('midnight-sun');
    expect(dayInfo(new Date('2024-12-20T23:00Z'), 69.65, 18.96).polar).toBe('polar-night');
  });
  it('South Pole: polar night in June, midnight sun in December', () => {
    expect(dayInfo(new Date('2024-06-21T00:00Z'), -90, 0).polar).toBe('polar-night');
    expect(dayInfo(new Date('2024-12-21T00:00Z'), -90, 0).polar).toBe('midnight-sun');
  });
});

describe('seasons by hemisphere', () => {
  it('July: summer in the north, winter in the south', () => {
    const s = astronomicalSeason(new Date('2025-07-15T00:00Z'));
    expect(s.north).toBe('summer');
    expect(s.south).toBe('winter');
    expect(s.next.name).toBe('septemberEquinox');
  });
  it('late December rolls over to the next March equinox', () => {
    const s = astronomicalSeason(new Date('2025-12-30T00:00Z'));
    expect(s.north).toBe('winter');
    expect(s.next.date.getUTCFullYear()).toBe(2026);
  });
});

describe('energy and geometry', () => {
  it('Earth is closer to the sun in January than July (~0.983 vs ~1.017 AU)', () => {
    const jan = sunAt(new Date('2025-01-04T00:00Z'), 0, 0).distanceAU;
    const jul = sunAt(new Date('2025-07-04T00:00Z'), 0, 0).distanceAU;
    expect(jan).toBeCloseTo(0.983, 2);
    expect(jul).toBeCloseTo(1.017, 2);
  });
  it('daily TOA insolation: north pole at June solstice ≈ 520–530 W/m² (higher than the equator ≈ 380–390)', () => {
    const pole = dayInfo(new Date('2025-06-21T00:00Z'), 89.9, 0).toaDailyMean;
    const eq = dayInfo(new Date('2025-06-21T00:00Z'), 0, 0).toaDailyMean;
    expect(pole).toBeGreaterThan(510);
    expect(pole).toBeLessThan(535);
    expect(eq).toBeGreaterThan(375);
    expect(eq).toBeLessThan(395);
  });
  it('analytic daily insolation matches the numeric integration within 1 %', () => {
    const date = new Date('2025-06-21T00:00Z');
    const lat = 35.76;
    const num = dayInfo(date, lat, 0).toaDailyMean;
    const s = subsolarPoint(new Date('2025-06-21T12:00Z'));
    const an = analyticDay(lat, s.lat, sunAt(date, 0, 0).distanceAU).dailyMean;
    expect(Math.abs(an - num) / num).toBeLessThan(0.01);
  });
  it('air mass is 1 at the zenith, ≈2 at 30°, ≈38 at the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 3);
    expect(airMass(30)).toBeCloseTo(1.995, 2);
    expect(airMass(0)).toBeGreaterThan(37);
    expect(airMass(0)).toBeLessThan(39);
  });
  it('twilight classes', () => {
    expect(lightState(10)).toBe('day');
    expect(lightState(-3)).toBe('civil');
    expect(lightState(-9)).toBe('nautical');
    expect(lightState(-15)).toBe('astronomical');
    expect(lightState(-30)).toBe('night');
  });
});

describe('hypothetical tilt (educational model)', () => {
  const june = seasonMarks(2025).juneSolstice;
  it('0° tilt: no seasons, 12 h days everywhere', () => {
    expect(Math.abs(hypotheticalDeclination(june, 0))).toBeLessThan(1e-9);
    expect(analyticDay(60, 0).dayLength).toBeCloseTo(12, 6);
  });
  it('23.44° tilt reproduces the real declination', () => {
    expect(hypotheticalDeclination(june, 23.44)).toBeCloseTo(23.44, 1);
  });
  it('45° tilt: the sun reaches 45°N at the June solstice', () => {
    expect(hypotheticalDeclination(june, 45)).toBeCloseTo(45, 1);
  });
});

describe('orbit frame', () => {
  it('the rotation axis keeps a fixed direction (changes by < 0.01° over a year)', () => {
    const a = orbitState(new Date('2025-01-01T00:00Z')).pole;
    const b = orbitState(new Date('2025-07-01T00:00Z')).pole;
    const ang = Math.acos(a.x * b.x + a.y * b.y + a.z * b.z) * 180 / Math.PI;
    expect(ang).toBeLessThan(0.01);
    expect(Math.acos(a.z) * 180 / Math.PI).toBeCloseTo(23.44, 1); // tilt vs. ecliptic normal
  });
});

describe('time zones', () => {
  it('Tangier is Africa/Casablanca, Cape Town is Africa/Johannesburg', () => {
    expect(timeZoneAt(35.7595, -5.834)).toBe('Africa/Casablanca');
    expect(timeZoneAt(-33.9249, 18.4241)).toBe('Africa/Johannesburg');
  });
  it('New York has DST: −240 min in July, −300 min in January', () => {
    expect(zoneOffsetMinutes(new Date('2025-07-01T12:00Z'), 'America/New_York')).toBe(-240);
    expect(zoneOffsetMinutes(new Date('2025-01-01T12:00Z'), 'America/New_York')).toBe(-300);
  });
  it('local midnight of Sydney', () => {
    expect(localMidnight(new Date('2025-01-10T05:00Z'), 'Australia/Sydney').toISOString()).toBe('2025-01-09T13:00:00.000Z');
  });
});
