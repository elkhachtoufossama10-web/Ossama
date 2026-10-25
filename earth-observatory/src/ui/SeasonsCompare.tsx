import { useId, useMemo, useState } from 'react';
import uPlot from 'uplot';
import { L, useLang } from '../i18n';
import { PRESETS, useStore, type Place } from '../store';
import { airMass, analyticDay, dayInfo, subsolarPoint, sunAt } from '../astro/solar';
import { hoursToHM, localMidnight, timeZoneAt } from '../astro/time';
import { Term, Stat } from './common';
import Chart from './Chart';

function PlaceSelect({ value, onChange, options, label }: { value: Place; onChange: (p: Place) => void; options: Place[]; label: string }) {
  return (
    <label className="place-select">
      <span>{label}</span>
      <select value={value.id} onChange={(e) => onChange(options.find((o) => o.id === e.target.value)!)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name || `${o.lat.toFixed(2)}, ${o.lon.toFixed(2)}`}</option>)}
      </select>
    </label>
  );
}

/** Same beam of sunlight (fixed width) hitting flat ground at the noon altitude: the lower the sun, the larger the lit area. */
export function BeamDiagram({ altitude, label }: { altitude: number; label: string }) {
  const W = 260, H = 150, ground = 125, beam = 40;
  const h = Math.max(0.5, altitude);
  const r = (h * Math.PI) / 180;
  const foot = Math.min(W - 20, beam / Math.sin(r));
  const cx = W / 2;
  const gid = 'beam' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const x1 = cx - foot / 2, x2 = cx + foot / 2;
  const len = 160;
  const dx = Math.cos(r) * len, dy = Math.sin(r) * len;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="beam" role="img" aria-label={`${label}: ${L('ارتفاع الشمس عند الزوال', 'noon sun altitude')} ${altitude.toFixed(1)}°, ${L('مساحة الانتشار ×', 'spread ×')}${(1 / Math.sin(r)).toFixed(2)}`}>
      <defs><linearGradient id={gid} x1="0" x2="1"><stop offset="0" stopColor="#ffd54a" stopOpacity="0.15" /><stop offset="1" stopColor="#ffd54a" stopOpacity="0.55" /></linearGradient></defs>
      {altitude > 0 ? (
        <polygon points={`${x1},${ground} ${x2},${ground} ${x2 + dx},${ground - dy} ${x1 + dx},${ground - dy}`} fill={`url(#${gid})`} stroke="#ffd54a" strokeWidth="1" />
      ) : null}
      <line x1="5" y1={ground} x2={W - 5} y2={ground} stroke="#8fb3d9" strokeWidth="3" />
      {altitude > 0 && <rect x={x1} y={ground - 3} width={foot} height="6" fill="#ff9f5a" />}
      <text x="8" y="16" fill="#cfe3ff" fontSize="12">{label}</text>
      <text x="8" y={H - 6} fill="#9fb3c8" fontSize="11">{altitude > 0 ? `${altitude.toFixed(1)}° · ×${(1 / Math.sin(r)).toFixed(2)}` : L('الشمس لا تشرق', 'sun does not rise')}</text>
    </svg>
  );
}

export default function SeasonsCompare() {
  const lang = useLang();
  const time = useStore((s) => s.time);
  const selected = useStore((s) => s.selected);
  const pins = useStore((s) => s.pins);
  const options = useMemo(() => {
    const m = new Map<string, Place>();
    [selected, ...pins, ...PRESETS].forEach((p) => p && m.set(p.id, p));
    return [...m.values()];
  }, [selected, pins]);
  const [a, setA] = useState<Place>(() => selected ?? PRESETS[0]);
  const [b, setB] = useState<Place>(() => pins.find((p) => p.lat * (selected?.lat ?? 35) < 0) ?? PRESETS[1]);
  const metrics = (p: Place) => {
    const zone = timeZoneAt(p.lat, p.lon);
    const d = dayInfo(localMidnight(time, zone), p.lat, p.lon);
    return { d, am: d.noonAltitude > 0 ? airMass(d.noonAltitude) : null };
  };
  const ma = useMemo(() => metrics(a), [a, time.toISOString().slice(0, 10)]);
  const mb = useMemo(() => metrics(b), [b, time.toISOString().slice(0, 10)]);
  const dist = sunAt(time, 0, 0).distanceAU;
  const year = time.getUTCFullYear();
  const curve = useMemo(() => {
    const xs: number[] = [], qa: number[] = [], qb: number[] = [], dd: number[] = [];
    for (let i = 0; i < 365; i += 2) {
      const t = new Date(Date.UTC(year, 0, 1 + i, 12));
      const dec = subsolarPoint(t).lat;
      const r = sunAt(t, 0, 0).distanceAU;
      xs.push(t.getTime() / 1000);
      qa.push(analyticDay(a.lat, dec, r).dailyMean);
      qb.push(analyticDay(b.lat, dec, r).dailyMean);
      dd.push(r);
    }
    return [xs, qa, qb, dd] as uPlot.AlignedData;
  }, [a.lat, b.lat, year]);
  const nameOf = (p: Place) => p.name || `${p.lat.toFixed(1)}°`;
  const row = (label: React.ReactNode, va: React.ReactNode, vb: React.ReactNode) => <tr><th scope="row">{label}</th><td>{va}</td><td>{vb}</td></tr>;

  return (
    <div className="panel-body">
      <h2>{L('لماذا الصيف حار والشتاء بارد؟', 'Why is summer hot and winter cold?')}</h2>
      <p>{L('قارن موقعين في اللحظة نفسها من الشريط الزمني. السبب الرئيسي ليس المسافة إلى الشمس، بل ', 'Compare two places at the same moment on the timeline. The main reason is not the distance to the sun but ')}<Term id="obliquity">{L('ميل محور الأرض', 'the axial tilt')}</Term>{L(': فهو يغيّر زاوية سقوط الأشعة وطول النهار.', ', which changes the angle of the sunlight and the length of the day.')}</p>
      <div className="row">
        <PlaceSelect label={L('الموقع أ', 'Place A')} value={a} onChange={setA} options={options} />
        <PlaceSelect label={L('الموقع ب', 'Place B')} value={b} onChange={setB} options={options} />
      </div>
      <table className="compare">
        <thead><tr><th></th><th>{nameOf(a)}</th><th>{nameOf(b)}</th></tr></thead>
        <tbody>
          {row(L('العرض الجغرافي', 'Latitude'), <span className="ltr">{a.lat.toFixed(2)}°</span>, <span className="ltr">{b.lat.toFixed(2)}°</span>)}
          {row(<Term id="altitude">{L('ارتفاع الشمس عند الزوال', 'Noon sun altitude')}</Term>, <span className="ltr">{ma.d.noonAltitude.toFixed(1)}°</span>, <span className="ltr">{mb.d.noonAltitude.toFixed(1)}°</span>)}
          {row(L('طول النهار', 'Day length'), hoursToHM(ma.d.dayLengthHours), hoursToHM(mb.d.dayLengthHours))}
          {row(<Term id="insolation">{L('الإشعاع اليومي فوق الغلاف', 'Daily TOA insolation')}</Term>, <span className="ltr">{ma.d.toaDailyMean.toFixed(0)} W/m² · {ma.d.toaDailyMJ.toFixed(1)} MJ/m²</span>, <span className="ltr">{mb.d.toaDailyMean.toFixed(0)} W/m² · {mb.d.toaDailyMJ.toFixed(1)} MJ/m²</span>)}
          {row(<Term id="airmass">{L('الكتلة الهوائية عند الزوال', 'Air mass at noon')}</Term>, <span className="ltr">{ma.am ? ma.am.toFixed(2) : '—'}</span>, <span className="ltr">{mb.am ? mb.am.toFixed(2) : '—'}</span>)}
          {row(<Term id="perihelion">{L('المسافة إلى الشمس', 'Distance to the sun')}</Term>, <span className="ltr">{dist.toFixed(4)} AU</span>, <span className="ltr">{dist.toFixed(4)} AU</span>)}
        </tbody>
      </table>
      <p className="note">{L('لاحظ أن المسافة إلى الشمس واحدة للموقعين في اللحظة نفسها، ومع ذلك قد يكون أحدهما في الصيف والآخر في الشتاء. والأرض تكون أقرب إلى الشمس في يناير، أي في شتاء النصف الشمالي.', 'Notice that the distance to the sun is the same for both places at the same instant, yet one can be in summer and the other in winter. Earth is actually closest to the sun in January — northern winter.')}</p>
      <div className="row beams">
        <BeamDiagram altitude={ma.d.noonAltitude} label={nameOf(a)} />
        <BeamDiagram altitude={mb.d.noonAltitude} label={nameOf(b)} />
      </div>
      <p className="muted">{L('الحزمة نفسها من ضوء الشمس تنتشر على مساحة أكبر عندما تكون الشمس منخفضة، فيقل ما يصل إلى كل متر مربع (× = 1/sin الارتفاع). وتعبر الأشعة المائلة كتلة هوائية أكبر.', 'The same beam spreads over a larger area when the sun is low, so each square metre receives less (× = 1/sin altitude). Slanted rays also cross more air.')}</p>
      <h3>{L('الإشعاع اليومي فوق الغلاف الجوي خلال السنة', 'Daily top-of-atmosphere insolation through the year')}</h3>
      <Chart title={L('مقارنة الإشعاع السنوي', 'Yearly insolation comparison')} data={curve} marker={time.getTime() / 1000}
        series={[{ label: nameOf(a) + ' W/m²', stroke: '#ff9f5a', width: 2, scale: 'w' }, { label: nameOf(b) + ' W/m²', stroke: '#58e1c1', width: 2, scale: 'w' }, { label: L('المسافة AU', 'distance AU'), stroke: 'rgba(200,200,255,0.6)', dash: [3, 3], width: 1, scale: 'au' }]}
        scales={{ w: { range: [0, 560] }, au: { range: [0.98, 1.02] } }}
        axes={[{ values: (_u, v) => v.map((x) => new Date(x * 1000).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB', { month: 'short', timeZone: 'UTC' })) }, { scale: 'w' }, { scale: 'au', side: 1, grid: { show: false }, values: (_u, v) => v.map((x) => x.toFixed(3)) }]} />
      <div className="disclaimer" role="note">
        <b>{L('تنبيه علمي', 'Scientific note')}:</b> {L('هذه حسابات فلكية للطاقة الواصلة إلى قمة الغلاف الجوي فقط. حرارة الهواء الفعلية تتأثر أيضاً بالسحب والغبار والرطوبة، والمحيطات والتيارات، والارتفاع والتضاريس، والرياح، وبطء تسخين الأرض والبحر (لذلك تتأخر أحر الأيام عادة شهراً أو أكثر بعد انقلاب يونيو).', 'These are astronomical calculations of the energy reaching the top of the atmosphere only. Actual air temperature also depends on clouds, dust and humidity, oceans and currents, altitude and terrain, winds, and the slow heating of land and sea (which is why the hottest days usually come a month or more after the June solstice).')}
      </div>
      <div className="stats">
        <Stat label={L('معادلة الإشعاع', 'Formula')} value={<span className="ltr small">Q = (S₀/π)(d̄/d)² [h₀ sinφ sinδ + cosφ cosδ sin h₀]</span>} sub={<span className="ltr">S₀ = 1361 W/m²</span>} />
      </div>
    </div>
  );
}
