import { useEffect, useMemo, useState, type ReactElement } from 'react';
import uPlot from 'uplot';
import { L, useLang } from '../i18n';
import { setState, useStore, type Place } from '../store';
import { analyticDay, astronomicalSeason, dayInfo, subsolarPoint, sunAt, AU_KM, type LightState } from '../astro/solar';
import { formatDate, formatOffset, formatTime, hoursToHM, localMidnight, timeZoneAt, zoneOffsetMinutes } from '../astro/time';
import { pointForecast, weatherCodeText, type PointForecast } from '../sources/openMeteo';
import { climateNormals, historicalDay, recentHistory } from '../sources/era5';
import { maybeUS, nwsAlerts, nwsLatestObservation } from '../sources/nws';
import { nearestMetar } from '../sources/metar';
import { reverseGeocode } from '../sources/geocoding';
import { STATIC_MODE } from '../sources/config';
import type { Provenance } from '../sources/provenance';
import { ErrorNote, KindBadge, Loading, ProvenanceCard, Stat, Tabs, Term, useAsync } from './common';
import { compass, fmtCoord, fmtNum, fmtTemp, fmtWind, toTemp } from './units';
import Chart from './Chart';

const SIM_PROV = (): Provenance => ({
  kind: 'simulation', producer: L('حساب فلكي داخل التطبيق', 'Computed in this app'), provider: 'astronomy-engine 2.1.19 (VSOP87, IAU 2006)',
  fetchedAt: new Date(), coverage: L('أي مكان، 1900–2100', 'anywhere, 1900–2100'), resolution: L('دقة أقل من دقيقة قوسية لموقع الشمس؛ الشروق/الغروب ±1 دقيقة على أفق مستوٍ', 'sun position < 1′; rise/set ±1 min on a flat horizon'),
  terms: 'MIT licence', termsUrl: 'https://github.com/cosinekitty/astronomy',
  notes: [L('يعمل دون اتصال. لا يأخذ في الحسبان التضاريس أو الطقس.', 'Works offline. Terrain and weather are not taken into account.')],
});

export function usePlaceName(p: Place | null) {
  const lang = useLang();
  const rev = useStore((s) => s.reverseGeocode);
  useEffect(() => {
    if (!p || p.name || !rev || p.origin === 'preset' || p.origin === 'search') return;
    let alive = true;
    reverseGeocode(p.lat, p.lon, lang).then((r) => {
      if (!alive || !r) return;
      setState((s) => (s.selected?.id === p.id ? { selected: { ...s.selected, name: r.name, country: r.country, admin: r.admin } } : {}));
    }, () => {});
    return () => { alive = false; };
  }, [p?.id, rev, lang]);
}

const STATE_TEXT: Record<LightState, [string, string]> = {
  day: ['نهار', 'Daylight'], civil: ['شفق مدني', 'Civil twilight'], nautical: ['شفق بحري', 'Nautical twilight'], astronomical: ['شفق فلكي', 'Astronomical twilight'], night: ['ليل', 'Night'],
};

export default function PlacePanel() {
  const lang = useLang();
  const p = useStore((s) => s.selected);
  const pins = useStore((s) => s.pins);
  const [tab, setTab] = useState<'sun' | 'weather' | 'history'>('sun');
  usePlaceName(p);
  if (!p) {
    return (
      <div className="empty">
        <h2>{L('اختر موقعاً', 'Choose a location')}</h2>
        <p>{L('انقر على الكرة الأرضية، أو ابحث عن مدينة، أو اكتب إحداثيات. لن نطلب موقعك إلا إذا ضغطت زر ⌖ بنفسك.', 'Click the globe, search for a city or type coordinates. Your location is only requested if you press ⌖ yourself.')}</p>
      </div>
    );
  }
  const pinned = pins.some((x) => Math.abs(x.lat - p.lat) < 1e-3 && Math.abs(x.lon - p.lon) < 1e-3);
  const zone = timeZoneAt(p.lat, p.lon);
  return (
    <div className="place">
      <PlaceHeader p={p} zone={zone} pinned={pinned} />
      <Tabs label={L('معلومات الموقع', 'Location info')} value={tab} onChange={setTab} tabs={[['sun', L('الشمس والفصول', 'Sun & season')], ['weather', L('الطقس', 'Weather')], ['history', L('السجل والمناخ', 'History & climate')]]} />
      <div role="tabpanel" key={lang}>
        {tab === 'sun' && <SunTab p={p} zone={zone} />}
        {tab === 'weather' && <WeatherTab p={p} zone={zone} />}
        {tab === 'history' && <HistoryTab p={p} zone={zone} />}
      </div>
    </div>
  );
}

function PlaceHeader({ p, zone, pinned }: { p: Place; zone: string; pinned: boolean }) {
  const time = useStore((s) => s.time);
  const off = zoneOffsetMinutes(time, zone);
  const season = astronomicalSeason(time);
  const north = p.lat >= 0;
  const s = north ? season.north : season.south;
  const sname = { spring: L('ربيع', 'Spring'), summer: L('صيف', 'Summer'), autumn: L('خريف', 'Autumn'), winter: L('شتاء', 'Winter') }[s];
  const nextName = { marchEquinox: L('اعتدال مارس', 'March equinox'), juneSolstice: L('انقلاب يونيو', 'June solstice'), septemberEquinox: L('اعتدال سبتمبر', 'September equinox'), decemberSolstice: L('انقلاب ديسمبر', 'December solstice') }[season.next.name as 'marchEquinox'];
  const daysTo = Math.ceil((season.next.date.getTime() - time.getTime()) / 86400e3);
  return (
    <header className="place-head">
      <div className="place-title">
        <h2>{p.name || L('نقطة مختارة', 'Selected point')}</h2>
        <button className={`btn small ${pinned ? 'active' : ''}`} aria-pressed={pinned}
          onClick={() => setState((st) => ({ pins: pinned ? st.pins.filter((x) => !(Math.abs(x.lat - p.lat) < 1e-3 && Math.abs(x.lon - p.lon) < 1e-3)) : [...st.pins, { ...p, id: 'p' + Date.now() }].slice(-6) }))}>
          {pinned ? L('★ مثبّت', '★ Pinned') : L('☆ تثبيت للمقارنة', '☆ Pin to compare')}
        </button>
      </div>
      <p className="muted">
        {[p.admin, p.country].filter(Boolean).join('، ')} {p.country ? '· ' : ''}<span className="ltr">{fmtCoord(p.lat, p.lon)}</span>
        {p.origin === 'device' && <> · {L('موقع الجهاز (مقرّب ~1 كم)', 'device location (rounded ~1 km)')}</>}
      </p>
      <div className="clock-row">
        <div><span className="muted">{L('التوقيت المحلي', 'Local time')}</span><b className="big ltr">{formatTime(time, zone, true)}</b><small>{formatDate(time, zone)}</small></div>
        <div><span className="muted"><Term id="utc">UTC</Term></span><b className="big ltr">{formatTime(time, 'UTC', true)}</b><small className="ltr">{zone} · {formatOffset(off)}</small></div>
        <div><span className="muted"><Term id="seasons">{L('الفصل الفلكي', 'Astronomical season')}</Term></span><b className="big">{sname}</b><small>{L('النصف', 'Hemisphere')}: {north ? L('الشمالي', 'northern') : L('الجنوبي', 'southern')} · {nextName} {L('بعد', 'in')} {daysTo} {L('يوم', 'days')}</small></div>
      </div>
    </header>
  );
}

function useDay(p: Place, zone: string) {
  const time = useStore((s) => s.time);
  const mid = localMidnight(time, zone).getTime();
  return useMemo(() => ({ mid, info: dayInfo(new Date(mid), p.lat, p.lon) }), [mid, p.lat, p.lon]);
}

function SunTab({ p, zone }: { p: Place; zone: string }) {
  const lang = useLang();
  const time = useStore((s) => s.time);
  const sun = sunAt(time, p.lat, p.lon);
  const { mid, info } = useDay(p, zone);
  const ss = subsolarPoint(time);
  const offMin = zoneOffsetMinutes(new Date(mid + 12 * 3600e3), zone);
  const altCurve = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    for (let m = 0; m <= 1440; m += 10) {
      const t = new Date(mid + m * 60e3);
      xs.push(t.getTime() / 1000);
      ys.push(sunAt(t, p.lat, p.lon).altitude);
    }
    return [xs, ys] as uPlot.AlignedData;
  }, [mid, p.lat, p.lon]);
  const year = new Date(mid + 12 * 3600e3).getUTCFullYear();
  const yearCurve = useMemo(() => {
    const xs: number[] = [], dl: number[] = [], q: number[] = [];
    for (let d = 0; d < 366; d += 2) {
      const t = new Date(Date.UTC(year, 0, 1 + d, 12));
      if (t.getUTCFullYear() !== year) break;
      const s = subsolarPoint(t);
      const a = analyticDay(p.lat, s.lat, sunAt(t, 0, 0).distanceAU, true);
      xs.push(t.getTime() / 1000); dl.push(a.dayLength); q.push(a.dailyMean);
    }
    return [xs, dl, q] as uPlot.AlignedData;
  }, [year, p.lat]);
  const fc = useAsync(() => pointForecast(p.lat, p.lon), [p.lat.toFixed(2), p.lon.toFixed(2)]);
  const check = fc.data ? crossCheck(fc.data.data, info.sunrise, info.sunset) : null;
  const sp = useMemo(SIM_PROV, [lang]);

  return (
    <div className="tab-body">
      <div className="stats">
        <Stat term="altitude" label={L('ارتفاع الشمس', 'Sun altitude')} value={<span className="ltr">{sun.altitude.toFixed(2)}°</span>} sub={L(...STATE_TEXT[sun.state])} />
        <Stat term="azimuth" label={L('السمت', 'Azimuth')} value={<span className="ltr">{sun.azimuth.toFixed(1)}°</span>} sub={compass(sun.azimuth, lang === 'ar')} />
        <Stat label={L('الشروق', 'Sunrise')} value={<span className="ltr">{info.polar === 'none' ? formatTime(info.sunrise, zone) : '—'}</span>} sub={info.polar === 'midnight-sun' ? L('شمس منتصف الليل', 'Midnight sun') : info.polar === 'polar-night' ? L('ليل قطبي', 'Polar night') : undefined} />
        <Stat label={L('الغروب', 'Sunset')} value={<span className="ltr">{info.polar === 'none' ? formatTime(info.sunset, zone) : '—'}</span>} />
        <Stat term="solarnoon" label={L('الزوال', 'Solar noon')} value={<span className="ltr">{formatTime(info.solarNoon, zone)}</span>} sub={<>{L('ارتفاع', 'altitude')} <span className="ltr">{info.noonAltitude.toFixed(1)}°</span></>} />
        <Stat label={L('طول النهار', 'Day length')} value={hoursToHM(info.dayLengthHours)} sub={<Term id="polar">{L('من الشروق إلى الغروب', 'sunrise to sunset')}</Term>} />
        <Stat term="twilight" label={L('الشفق المدني', 'Civil twilight')} value={<span className="ltr">{formatTime(info.civilDawn, zone)} / {formatTime(info.civilDusk, zone)}</span>} />
        <Stat term="perihelion" label={L('المسافة إلى الشمس', 'Distance to the sun')} value={<span className="ltr">{sun.distanceAU.toFixed(5)} AU</span>} sub={<span className="ltr">{(sun.distanceAU * AU_KM / 1e6).toFixed(2)} M km</span>} />
        <Stat term="insolation" label={L('الإشعاع الآن (قمة الغلاف)', 'Insolation now (TOA)')} value={<span className="ltr">{sun.toaHorizontal.toFixed(0)} W/m²</span>} sub={<>{L('معدل اليوم', 'daily mean')} <span className="ltr">{info.toaDailyMean.toFixed(0)} W/m² · {info.toaDailyMJ.toFixed(1)} MJ/m²</span></>} />
        <Stat term="airmass" label={L('الكتلة الهوائية', 'Air mass')} value={<span className="ltr">{sun.airMass ? sun.airMass.toFixed(2) : '—'}</span>} sub={sun.spreadFactor ? <>{L('انتشار الحزمة ×', 'beam spread ×')}<span className="ltr">{sun.spreadFactor.toFixed(2)}</span></> : L('الشمس تحت الأفق', 'sun below horizon')} />
        <Stat term="subsolar" label={L('النقطة تحت الشمسية', 'Subsolar point')} value={<span className="ltr">{fmtCoord(ss.lat, ss.lon)}</span>} sub={<><Term id="declination">{L('الميل', 'declination')}</Term> <span className="ltr">{ss.lat.toFixed(2)}°</span></>} />
      </div>
      <h3>{L('ارتفاع الشمس خلال اليوم المحلي', 'Sun altitude through the local day')}</h3>
      <Chart title={L('منحنى ارتفاع الشمس', 'Sun altitude curve')} data={altCurve} marker={time.getTime() / 1000} tzOffsetMin={offMin}
        series={[{ label: L('الارتفاع °', 'altitude °'), stroke: '#ffd54a', width: 2, fill: 'rgba(255,213,74,0.08)' }]}
        axes={[{}, { values: (_u, v) => v.map((x) => x + '°') }]} />
      <h3>{L('خلال السنة عند هذا العرض', 'Through the year at this latitude')}</h3>
      <Chart title={L('طول النهار والإشعاع خلال السنة', 'Day length and insolation over the year')} data={yearCurve} marker={time.getTime() / 1000}
        series={[{ label: L('طول النهار (س)', 'day length (h)'), stroke: '#7fd4ff', width: 2, scale: 'h' }, { label: L('إشعاع يومي W/m²', 'daily insolation W/m²'), stroke: '#ff9f5a', width: 2, scale: 'w' }]}
        scales={{ h: { range: [0, 24] }, w: { range: [0, 560] } }}
        axes={[{ values: (_u, v) => v.map((x) => new Date(x * 1000).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB', { month: 'short', timeZone: 'UTC' })) }, { scale: 'h' }, { scale: 'w', side: 1, grid: { show: false } }]} />
      {check && (
        <p className="check-note">
          ✓ {L('تحقق مستقل: Open-Meteo يعطي الشروق', 'Independent check: Open-Meteo gives sunrise')} <span className="ltr">{formatTime(check.rise, zone)}</span>
          {' '}({L('الفرق', 'difference')} <span className="ltr">{check.dRise}</span> {L('ث', 's')}) · {L('الغروب', 'sunset')} <span className="ltr">{formatTime(check.set, zone)}</span> ({L('الفرق', 'difference')} <span className="ltr">{check.dSet}</span> {L('ث', 's')}).
          {' '}{L('Open-Meteo يقرّب إلى الدقيقة.', 'Open-Meteo rounds to the minute.')}
        </p>
      )}
      <ProvenanceCard id="sun" p={sp} compact />
    </div>
  );
}

function crossCheck(f: PointForecast, rise: Date | null, set: Date | null) {
  if (!rise || !set) return null;
  const r = f.daily.sunrise.find((t) => Math.abs(t * 1000 - rise.getTime()) < 6 * 3600e3);
  const s = f.daily.sunset.find((t) => Math.abs(t * 1000 - set.getTime()) < 6 * 3600e3);
  if (!r || !s) return null;
  return { rise: new Date(r * 1000), set: new Date(s * 1000), dRise: Math.round((rise.getTime() - r * 1000) / 1000), dSet: Math.round((set.getTime() - s * 1000) / 1000) };
}

function WeatherTab({ p, zone }: { p: Place; zone: string }) {
  const lang = useLang();
  const time = useStore((s) => s.time);
  const tu = useStore((s) => s.tempUnit);
  const wu = useStore((s) => s.windUnit);
  const key = [p.lat.toFixed(2), p.lon.toFixed(2)];
  const fc = useAsync(() => pointForecast(p.lat, p.lon), key);
  const metar = useAsync(() => nearestMetar(p.lat, p.lon), key);
  const us = maybeUS(p.lat, p.lon);
  const nwsObs = useAsync(us ? () => nwsLatestObservation(p.lat, p.lon) : null, key);
  const alerts = useAsync(us ? () => nwsAlerts(p.lat, p.lon) : null, key);
  const hourKey = Math.floor(time.getTime() / 3600e3);
  const f = fc.data?.data;
  const inForecast = f && time >= f.firstValid && time.getTime() <= f.lastValid.getTime() + 1800e3;
  const tooOld = time.getTime() < Date.UTC(1940, 0, 1);
  const era5Day = !inForecast && f && time < f.firstValid && !tooOld && time.getTime() < Date.now() - 5 * 86400e3;
  const hist = useAsync(era5Day ? () => historicalDay(p.lat, p.lon, time) : null, [...key, era5Day ? time.toISOString().slice(0, 10) : '']);
  const offMin = zoneOffsetMinutes(time, zone);

  const chartData = useMemo(() => {
    if (!f) return null;
    const xs = f.hourly.time;
    return {
      t: [xs, f.hourly.temperature_2m.map((v) => toTemp(v, tu)), f.hourly.apparent_temperature.map((v) => toTemp(v, tu))] as uPlot.AlignedData,
      p: [xs, f.hourly.precipitation, f.hourly.cloud_cover] as uPlot.AlignedData,
    };
  }, [f, tu]);

  let atTime: ReactElement | null = null;
  if (f && inForecast) {
    const i = f.hourly.time.findIndex((t) => Math.floor(t / 3600) === hourKey);
    if (i >= 0) {
      const lead = fc.data!.prov.runTime ? (f.hourly.time[i] * 1000 - fc.data!.prov.runTime.getTime()) / 3600e3 : null;
      atTime = (
        <div className="card">
          <h3><KindBadge kind="forecast" /> {L('عند الوقت المختار', 'At the selected time')} <small className="ltr">{formatTime(new Date(f.hourly.time[i] * 1000), zone)}</small></h3>
          <div className="stats">
            <Stat label={L('الحرارة', 'Temperature')} value={fmtTemp(f.hourly.temperature_2m[i], tu)} />
            <Stat term="apparent" label={L('المحسوسة', 'Feels like')} value={fmtTemp(f.hourly.apparent_temperature[i], tu)} />
            <Stat label={L('الهطول (ساعة)', 'Precip. (1 h)')} value={fmtNum(f.hourly.precipitation[i], 1, ' mm')} />
            <Stat label={L('السحب', 'Cloud')} value={fmtNum(f.hourly.cloud_cover[i], 0, '%')} />
            <Stat label={L('الرياح', 'Wind')} value={fmtWind(f.hourly.wind_speed_10m[i], wu)} sub={compass(f.hourly.wind_direction_10m[i], lang === 'ar')} />
            <Stat term="pressure" label={L('الضغط', 'Pressure')} value={fmtNum(f.hourly.pressure_msl[i], 0, ' hPa')} />
            <Stat label={L('الرطوبة', 'Humidity')} value={fmtNum(f.hourly.relative_humidity_2m[i], 0, '%')} />
          </div>
          {lead !== null && lead > 0 && <p className="muted">{L('مدة التوقع', 'Lead time')}: {Math.round(lead)} {L('ساعة بعد تشغيل النموذج', 'h after the model run')}{lead > 120 ? L(' — عدم اليقين كبير بعد 5 أيام.', ' — uncertainty is large beyond 5 days.') : ''}</p>}
        </div>
      );
    }
  } else if (f && time.getTime() > f.lastValid.getTime()) {
    atTime = <div className="card warn-card">{L('الوقت المختار بعد نهاية مدى توقع ECMWF', 'The selected time is after the end of the ECMWF forecast range')} (<span className="ltr">{formatTime(f.lastValid, zone)} {f.lastValid.toISOString().slice(0, 10)}</span>). {L('لا نعرض توقعاً لما بعده. راجع المعدلات المناخية في تبويب «السجل والمناخ».', 'No forecast is shown beyond it. See the climate normals in the “History & climate” tab.')}</div>;
  } else if (era5Day && hist.data) {
    const i = hist.data.data.times.findIndex((t) => Math.floor(t / 3600) === hourKey);
    atTime = (
      <div className="card">
        <h3><KindBadge kind="reanalysis" /> {L('عند الوقت المختار (ERA5)', 'At the selected time (ERA5)')}</h3>
        <div className="stats">
          <Stat label={L('الحرارة', 'Temperature')} value={fmtTemp(hist.data.data.temp[i] ?? null, tu)} />
          <Stat label={L('السحب', 'Cloud')} value={fmtNum(hist.data.data.cloud[i], 0, '%')} />
          <Stat label={L('الهطول (ساعة)', 'Precip. (1 h)')} value={fmtNum(hist.data.data.precip[i], 1, ' mm')} />
          <Stat label={L('الرياح', 'Wind')} value={fmtWind(hist.data.data.wind[i], wu)} />
        </div>
        <ProvenanceCard id="era5-hour" p={hist.data.prov} />
      </div>
    );
  } else if (era5Day && hist.loading) atTime = <Loading what="ERA5" />;
  else if (era5Day && hist.error) atTime = <ErrorNote error={hist.error} what="ERA5" onRetry={hist.reload} />;
  else if (tooOld) atTime = <div className="card warn-card">{L('لا توجد بيانات ERA5 قبل 1940.', 'ERA5 has no data before 1940.')}</div>;
  else if (f && !inForecast) atTime = <div className="card warn-card">{L('ERA5 لا يغطي الأيام الخمسة الأخيرة بعد، وهذا الوقت أقدم من بيانات التوقع المؤرشفة (7 أيام).', 'ERA5 does not cover the last 5 days yet, and this time is older than the archived forecast data (7 days).')}</div>;

  return (
    <div className="tab-body">
      {fc.loading && <Loading what="ECMWF" />}
      {fc.error && <ErrorNote error={fc.error} what={L('توقعات ECMWF', 'ECMWF forecast')} onRetry={fc.reload} />}
      {atTime}
      {f && (
        <div className="card">
          <h3><KindBadge kind="forecast" /> {L('حالة النموذج الآن', 'Model state now')} — {weatherCodeText(f.current.weather_code, lang === 'ar')}</h3>
          <div className="stats">
            <Stat label={L('الحرارة', 'Temperature')} value={fmtTemp(f.current.temperature_2m, tu)} />
            <Stat term="apparent" label={L('المحسوسة', 'Feels like')} value={fmtTemp(f.current.apparent_temperature, tu)} />
            <Stat label={L('الرياح', 'Wind')} value={fmtWind(f.current.wind_speed_10m, wu)} sub={<>{compass(f.current.wind_direction_10m, lang === 'ar')} · {L('هبّات', 'gusts')} {fmtWind(f.current.wind_gusts_10m, wu)}</>} />
            <Stat label={L('الرطوبة', 'Humidity')} value={fmtNum(f.current.relative_humidity_2m, 0, '%')} />
            <Stat term="pressure" label={L('الضغط', 'Pressure')} value={fmtNum(f.current.pressure_msl, 0, ' hPa')} />
            <Stat label={L('السحب', 'Cloud')} value={fmtNum(f.current.cloud_cover, 0, '%')} />
          </div>
          <p className="muted">{L('ارتفاع خلية النموذج', 'Model cell elevation')}: {fmtNum(f.elevation, 0, ' m')} · {L('هذه قيم نموذج وليست قياساً.', 'These are model values, not measurements.')}</p>
          <ProvenanceCard id="ecmwf-point" p={fc.data!.prov} />
        </div>
      )}
      <div className="card">
        <h3><KindBadge kind="observation" /> {L('أقرب رصد فعلي', 'Nearest actual observation')} (<Term id="metar">METAR</Term>)</h3>
        {metar.loading && <Loading />}
        {metar.error && <p className="muted">{L('مصدر الأرصاد غير متاح هنا', 'Observation source unavailable here')} ({metar.error.message}). {STATIC_MODE ? L('النسخة العامة تقرأ نسخة من ملف NOAA تُحدَّث كل ~20 دقيقة؛ تعذّر تحميلها الآن.', 'The public version reads a copy of the NOAA file refreshed every ~20 min; it could not be loaded right now.') : L('يحتاج خادم التطبيق (npm run dev أو npm start) لأن واجهة NOAA لا تسمح بالطلب المباشر من المتصفح.', 'It needs the app server (npm run dev or npm start) because the NOAA API does not allow direct browser requests.')}</p>}
        {metar.data === null && !metar.loading && !metar.error && <p className="muted">{L('لا توجد محطة مطار تنشر METAR في نطاق 80 كم.', 'No airport station publishing METAR within 80 km.')}</p>}
        {metar.data && (
          <>
            <div className="stats">
              <Stat label={L('المحطة', 'Station')} value={<span className="ltr">{metar.data.data.icao}</span>} sub={`${metar.data.data.name} · ${metar.data.data.distanceKm.toFixed(0)} km`} />
              <Stat label={L('الحرارة', 'Temperature')} value={fmtTemp(metar.data.data.temp, tu, 0)} />
              <Stat label={L('الرطوبة', 'Humidity')} value={fmtNum(metar.data.data.humidity, 0, '%')} sub={L('من نقطة الندى', 'from dew point')} />
              <Stat label={L('الرياح', 'Wind')} value={fmtWind(metar.data.data.windKt === null ? null : metar.data.data.windKt * 1.852, wu)} sub={compass(metar.data.data.windDir, lang === 'ar')} />
              <Stat label={L('الضغط', 'Pressure')} value={fmtNum(metar.data.data.pressure, 0, ' hPa')} />
              <Stat label={L('وقت الرصد', 'Observed')} value={<span className="ltr">{formatTime(metar.data.data.time, zone)}</span>} />
            </div>
            <code className="raw ltr">{metar.data.data.raw}</code>
            <ProvenanceCard id="metar" p={metar.data.prov} />
          </>
        )}
        {us && nwsObs.data && (
          <>
            <h4>{L('محطة NWS', 'NWS station')} {nwsObs.data.data.station} — {fmtTemp(nwsObs.data.data.temp, tu)} · {nwsObs.data.data.text}</h4>
            <ProvenanceCard id="nws-obs" p={nwsObs.data.prov} />
          </>
        )}
      </div>
      <AlertsCard p={p} us={us} alerts={alerts.data} loading={alerts.loading} error={alerts.error} zone={zone} />
      {chartData && (
        <div className="card">
          <h3>{L('التوقع الساعي (حتى 16 يوماً)', 'Hourly forecast (up to 16 days)')}</h3>
          <Chart title={L('الحرارة المتوقعة', 'Forecast temperature')} data={chartData.t} marker={time.getTime() / 1000} tzOffsetMin={offMin}
            series={[{ label: L('الحرارة', 'temperature') + ` °${tu}`, stroke: '#ff9f5a', width: 2 }, { label: L('المحسوسة', 'feels like'), stroke: '#c792ea', width: 1, dash: [4, 3] }]} />
          <Chart title={L('الهطول والسحب', 'Precipitation and cloud')} data={chartData.p} marker={time.getTime() / 1000} tzOffsetMin={offMin} height={140}
            series={[{ label: L('هطول mm/h', 'precip mm/h'), stroke: '#4fc3f7', fill: 'rgba(79,195,247,0.35)', width: 1, scale: 'mm', paths: barsPath }, { label: L('سحب %', 'cloud %'), stroke: 'rgba(220,230,240,0.7)', width: 1, scale: '%' }]}
            scales={{ mm: { range: (_u, _a, b) => [0, Math.max(2, b)] }, '%': { range: [0, 100] } }}
            axes={[{}, { scale: 'mm' }, { scale: '%', side: 1, grid: { show: false } }]} />
          <table className="daily">
            <thead><tr><th>{L('اليوم', 'Day')}</th><th>{L('صغرى', 'Min')}</th><th>{L('كبرى', 'Max')}</th><th>{L('هطول', 'Precip.')}</th></tr></thead>
            <tbody>
              {f!.daily.time.map((t, i) => f!.daily.tmax[i] === null ? null : (
                <tr key={t}><td>{new Date(t * 1000).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone })}</td>
                  <td>{fmtTemp(f!.daily.tmin[i], tu, 0)}</td><td>{fmtTemp(f!.daily.tmax[i], tu, 0)}</td><td>{fmtNum(f!.daily.precip[i], 1, ' mm')}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted">{L('آخر ساعة ضمن مدى التوقع', 'Last hour in the forecast range')}: <span className="ltr">{f!.lastValid.toISOString().slice(0, 16).replace('T', ' ')} UTC</span></p>
        </div>
      )}
    </div>
  );
}

// simple bar renderer for uPlot
const barsPath = uPlot.paths.bars ? uPlot.paths.bars({ size: [0.9, 6] }) : undefined;

function AlertsCard({ p, us, alerts, loading, error, zone }: { p: Place; us: boolean; alerts: Awaited<ReturnType<typeof nwsAlerts>> | null; loading: boolean; error: Error | null; zone: string }) {
  const morocco = zone === 'Africa/Casablanca' || zone === 'Africa/El_Aaiun';
  const europe = zone.startsWith('Europe/');
  return (
    <div className="card">
      <h3>{L('التحذيرات الرسمية', 'Official warnings')}</h3>
      {us ? (
        <>
          {loading && <Loading />}
          {error && <ErrorNote error={error} what="NWS" />}
          {alerts && alerts.data.length === 0 && <p>{L('لا توجد تحذيرات نشطة من NWS لهذه النقطة.', 'No active NWS alerts for this point.')}</p>}
          {alerts?.data.map((a) => (
            <div key={a.id} className={`alert sev-${a.severity.toLowerCase()}`} role="alert">
              <b>{a.event}</b> <span className="ltr">({a.severity}, {a.urgency})</span>
              <p className="ltr">{a.headline}</p>
              <details><summary>{L('التفاصيل', 'Details')}</summary><p className="ltr pre">{a.description}</p>{a.instruction && <p className="ltr pre">{a.instruction}</p>}</details>
            </div>
          ))}
          {alerts && <ProvenanceCard id="nws-alerts" p={alerts.prov} compact />}
        </>
      ) : (
        <>
          <p>{L('التطبيق يعرض التحذيرات آلياً فقط داخل الولايات المتحدة (NWS) لأنها الخدمة الرسمية الوحيدة التي وجدنا لها واجهة عامة موثقة تسمح بالطلب من المتصفح. لا نخترع تحذيرات.', 'Warnings are shown automatically only inside the United States (NWS), the only official service we found with a documented public API usable from the browser. No warnings are invented.')}</p>
          <ul className="links">
            {morocco && <li><a href="https://www.marocmeteo.ma/" target="_blank" rel="noreferrer noopener">{L('المديرية العامة للأرصاد الجوية — Maroc Météo (النشرات الإنذارية)', 'Moroccan General Directorate of Meteorology — Maroc Météo (warnings)')}</a></li>}
            {europe && <li><a href="https://meteoalarm.org/" target="_blank" rel="noreferrer noopener">MeteoAlarm (EUMETNET)</a></li>}
            <li><a href={`https://severeweather.wmo.int/`} target="_blank" rel="noreferrer noopener">{L('مركز معلومات الطقس القاسي — المنظمة العالمية للأرصاد (WMO)', 'WMO Severe Weather Information Centre')}</a></li>
          </ul>
          <p className="muted ltr">{p.lat.toFixed(2)}, {p.lon.toFixed(2)}</p>
        </>
      )}
    </div>
  );
}

function HistoryTab({ p, zone }: { p: Place; zone: string }) {
  const lang = useLang();
  const tu = useStore((s) => s.tempUnit);
  const time = useStore((s) => s.time);
  const key = [p.lat.toFixed(2), p.lon.toFixed(2)];
  const hist = useAsync(() => recentHistory(p.lat, p.lon, 60), key);
  const [wantNormals, setWantNormals] = useState(false);
  const normals = useAsync(wantNormals ? () => climateNormals(p.lat, p.lon) : null, [...key, wantNormals]);
  const fc = useAsync(() => pointForecast(p.lat, p.lon), key);
  useEffect(() => setWantNormals(false), [p.id]);
  const h = hist.data?.data;
  const data = useMemo(() => h ? [h.dates.map((d) => Date.parse(d + 'T12:00Z') / 1000), h.tmax.map((v) => toTemp(v, tu)), h.tmin.map((v) => toTemp(v, tu)), h.precip] as uPlot.AlignedData : null, [h, tu]);
  const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: zone }).format(time)) - 1;
  const n = normals.data?.data;
  const monthNames = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2001, i, 15)).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB', { month: 'short', timeZone: 'UTC' }));
  const todayMax = fc.data ? fc.data.data.daily.tmax[fc.data.data.daily.time.findIndex((t) => t * 1000 > time.getTime() - 86400e3)] : null;
  return (
    <div className="tab-body">
      <div className="card">
        <h3><KindBadge kind="reanalysis" /> {L('آخر 60 يوماً (ERA5)', 'Last 60 days (ERA5)')}</h3>
        {hist.loading && <Loading what="ERA5" />}
        {hist.error && <ErrorNote error={hist.error} what="ERA5" onRetry={hist.reload} />}
        {data && (
          <Chart title={L('سجل الحرارة والهطول', 'Temperature and precipitation history')} data={data} marker={time.getTime() / 1000}
            series={[{ label: L('كبرى', 'max') + ` °${tu}`, stroke: '#ff7a7a', width: 2, scale: 't' }, { label: L('صغرى', 'min'), stroke: '#7fd4ff', width: 2, scale: 't' }, { label: L('هطول mm', 'precip mm'), stroke: '#4fc3f7', fill: 'rgba(79,195,247,0.35)', scale: 'mm', paths: barsPath }]}
            scales={{ mm: { range: (_u, _a, b) => [0, Math.max(5, b * 2)] } }}
            axes={[{}, { scale: 't' }, { scale: 'mm', side: 1, grid: { show: false } }]} />
        )}
        {hist.data && <ProvenanceCard id="era5-recent" p={hist.data.prov} />}
      </div>
      <div className="card">
        <h3><KindBadge kind="climatology" /> <Term id="climatology">{L('المعدلات المناخية 1991–2020', 'Climate normals 1991–2020')}</Term></h3>
        {!wantNormals && (
          <>
            <p className="muted">{L('تُحسب داخل التطبيق من 30 سنة من بيانات ERA5 اليومية (طلب واحد أكبر من المعتاد، يُحفظ بعدها على جهازك).', 'Computed in the app from 30 years of daily ERA5 values (one larger request, then stored on your device).')}</p>
            <button className="btn" onClick={() => setWantNormals(true)}>{L('تحميل المعدلات', 'Load normals')}</button>
          </>
        )}
        {normals.loading && <Loading what={L('30 سنة من ERA5', '30 years of ERA5')} />}
        {normals.error && <ErrorNote error={normals.error} what={L('المعدلات', 'normals')} onRetry={normals.reload} />}
        {n && (
          <>
            <div className="table-scroll"><table className="normals">
              <thead><tr><th></th>{monthNames.map((m, i) => <th key={i} className={i === month ? 'cur' : ''}>{m}</th>)}</tr></thead>
              <tbody>
                <tr><th>{L('كبرى', 'Max')}</th>{n.months.map((m, i) => <td key={i} className={i === month ? 'cur' : ''}>{fmtNum(toTemp(m.tmax, tu), 0)}</td>)}</tr>
                <tr><th>{L('صغرى', 'Min')}</th>{n.months.map((m, i) => <td key={i} className={i === month ? 'cur' : ''}>{fmtNum(toTemp(m.tmin, tu), 0)}</td>)}</tr>
                <tr><th>{L('هطول mm', 'Precip mm')}</th>{n.months.map((m, i) => <td key={i} className={i === month ? 'cur' : ''}>{fmtNum(m.precip, 0)}</td>)}</tr>
              </tbody>
            </table></div>
            {todayMax !== null && todayMax !== undefined && n.months[month].tmax !== null && (
              <p>{L('الكبرى المتوقعة لهذا اليوم', 'Forecast max for this day')} {fmtTemp(todayMax, tu, 0)} {L('مقابل معدل الشهر', 'vs the monthly normal')} {fmtTemp(n.months[month].tmax, tu, 0)} → <b className="ltr">{(todayMax - n.months[month].tmax!) >= 0 ? '+' : ''}{(todayMax - n.months[month].tmax!).toFixed(1)}°C</b>
                <small className="muted"> ({L('مقارنة توقع بمعدل، وليست رصداً', 'a forecast compared with a normal, not an observation')})</small></p>
            )}
            <ProvenanceCard id="normals" p={normals.data!.prov} />
          </>
        )}
      </div>
    </div>
  );
}
