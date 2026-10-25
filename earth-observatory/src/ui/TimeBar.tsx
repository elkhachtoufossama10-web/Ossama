import { useEffect, useRef } from 'react';
import { getState, setState, useStore } from '../store';
import { L, useLang } from '../i18n';
import { formatOffset, timeZoneAt, zoneOffsetMinutes } from '../astro/time';
import { astronomicalSeason } from '../astro/solar';
import { locale } from '../i18n';

const SPEEDS: [number, string, string][] = [
  [1, 'زمن حقيقي', 'real time'],
  [60, 'دقيقة/ث', '1 min/s'],
  [3600, 'ساعة/ث', '1 h/s'],
  [86400, 'يوم/ث', '1 day/s'],
  [7 * 86400, 'أسبوع/ث', '1 week/s'],
  [30 * 86400, 'شهر/ث', '1 month/s'],
];

/** Drives the shared simulation clock: live mode follows the wall clock, play mode advances at `speed`. */
export function useClock() {
  const live = useStore((s) => s.live);
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (live) {
      const id = setInterval(() => setState({ time: new Date() }), 1000);
      return () => clearInterval(id);
    }
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      acc += dt;
      if (acc > 1 / 30) {
        const s = getState();
        let t = s.time.getTime() + acc * s.speed * 1000;
        const max = Date.UTC(2100, 0, 1), min = Date.UTC(1900, 0, 1);
        if (t > max || t < min) { t = Math.min(max, Math.max(min, t)); setState({ playing: false }); }
        setState({ time: new Date(t) });
        acc = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, playing]);
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function TimeBar({ forecastEnd }: { forecastEnd: Date | null }) {
  const lang = useLang();
  const time = useStore((s) => s.time);
  const live = useStore((s) => s.live);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const sel = useStore((s) => s.selected);
  const timeMode = useStore((s) => s.timeMode);
  const zone = sel ? timeZoneAt(sel.lat, sel.lon) : 'UTC';
  const showZone = timeMode === 'utc' ? 'UTC' : zone;
  const off = zoneOffsetMinutes(time, showZone);
  const local = new Date(time.getTime() + off * 60000);
  const year = local.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const doy = Math.floor((local.getTime() - startOfYear) / 86400e3);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - startOfYear) / 86400e3;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const season = astronomicalSeason(time);
  const hold = useRef(false);

  const setLocal = (y: number, d: number, m: number) => {
    const t = Date.UTC(y, 0, 1) + d * 86400e3 + m * 60e3 - off * 60000;
    setState({ time: new Date(t), live: false });
  };
  const now = Date.now();
  const phase = time.getTime() > now + 5 * 60e3
    ? forecastEnd && time > forecastEnd ? 'beyond' : 'future'
    : time.getTime() < now - 2 * 86400e3 ? 'past' : 'now';
  const phaseText = {
    now: L('الحاضر: أرصاد وتحليل وتوقعات قصيرة المدى', 'Present: observations, analyses and short-range forecasts'),
    future: L('المستقبل: قيم الطقس هنا توقعات نموذج', 'Future: weather values are model forecasts'),
    beyond: L('بعد نهاية مدى التوقع: لا قيم طقس (الحساب الفلكي فقط)', 'Beyond the forecast range: no weather values (astronomy only)'),
    past: L('الماضي: قيم الطقس من إعادة التحليل ERA5 أو صور الأقمار', 'Past: weather from ERA5 reanalysis or satellite imagery'),
  }[phase];
  const seasonName = (x: string) => ({ spring: L('ربيع', 'spring'), summer: L('صيف', 'summer'), autumn: L('خريف', 'autumn'), winter: L('شتاء', 'winter') } as Record<string, string>)[x];
  const dateStr = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const timeStr = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;

  return (
    <section className="timebar" aria-label={L('شريط الزمن', 'Timeline')}>
      <div className="tb-row">
        <button className={`btn ${live ? 'active' : ''}`} onClick={() => setState({ time: new Date(), live: true, playing: false })} aria-pressed={live}>
          ● {L('الآن', 'Now')}
        </button>
        <button className="btn icon" onClick={() => setState((s) => ({ time: new Date(s.time.getTime() - 86400e3), live: false }))} aria-label={L('يوم للخلف', 'One day back')}><span className="ltr">−1{L('ي', 'd')}</span></button>
        <button className="btn icon" onClick={() => setState((s) => ({ time: new Date(s.time.getTime() - 3600e3), live: false }))} aria-label={L('ساعة للخلف', 'One hour back')}><span className="ltr">−1{L('س', 'h')}</span></button>
        <button className="btn play" onClick={() => setState((s) => ({ playing: !s.playing, live: false }))} aria-pressed={playing} aria-label={playing ? L('إيقاف', 'Pause') : L('تشغيل', 'Play')}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="btn icon" onClick={() => setState((s) => ({ time: new Date(s.time.getTime() + 3600e3), live: false }))} aria-label={L('ساعة للأمام', 'One hour forward')}><span className="ltr">+1{L('س', 'h')}</span></button>
        <button className="btn icon" onClick={() => setState((s) => ({ time: new Date(s.time.getTime() + 86400e3), live: false }))} aria-label={L('يوم للأمام', 'One day forward')}><span className="ltr">+1{L('ي', 'd')}</span></button>
        <label className="tb-speed">
          <span className="sr-only">{L('السرعة', 'Speed')}</span>
          <select value={speed} onChange={(e) => setState({ speed: Number(e.target.value) })} aria-label={L('سرعة التشغيل', 'Playback speed')}>
            {SPEEDS.map(([v, ar, en]) => <option key={v} value={v}>{lang === 'ar' ? ar : en}</option>)}
          </select>
        </label>
        <label className="tb-date">
          <span className="sr-only">{L('التاريخ', 'Date')}</span>
          <input type="date" value={dateStr} min="1900-01-01" max="2099-12-31" onChange={(e) => {
            const [y, m, d] = e.target.value.split('-').map(Number);
            if (!y) return;
            const dd = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400e3;
            setLocal(y, dd, minutes);
          }} />
        </label>
        <label className="tb-date">
          <span className="sr-only">{L('الوقت', 'Time')}</span>
          <input type="time" value={timeStr} onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isFinite(h)) setLocal(year, doy, h * 60 + m);
          }} />
        </label>
        <span className="tb-zone" title={showZone}>{showZone === 'UTC' ? 'UTC' : `${showZone} (${formatOffset(off)})`}</span>
      </div>
      <div className="tb-row sliders">
        <label className="slider">
          <span>{L('يوم السنة', 'Day of year')}</span>
          <input type="range" min={0} max={daysInYear - 1} value={doy}
            onPointerDown={() => (hold.current = true)} onPointerUp={() => (hold.current = false)}
            onChange={(e) => setLocal(year, Number(e.target.value), minutes)} aria-valuetext={dateStr} />
        </label>
        <label className="slider">
          <span>{L('ساعة اليوم', 'Time of day')}</span>
          <input type="range" min={0} max={1439} step={5} value={minutes} onChange={(e) => setLocal(year, doy, Number(e.target.value))} aria-valuetext={timeStr} />
        </label>
      </div>
      <div className="tb-row info">
        <span className={`phase phase-${phase}`}>{phaseText}</span>
        <span>{L('شمال', 'North')}: <b>{seasonName(season.north)}</b> · {L('جنوب', 'South')}: <b>{seasonName(season.south)}</b> <small>({L('فلكياً', 'astronomical')})</small></span>
        <span className="utc">UTC {time.toISOString().slice(0, 16).replace('T', ' ')}</span>
        <span className="sr-only">{new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeStyle: 'short', timeZone: showZone }).format(time)}</span>
      </div>
    </section>
  );
}
