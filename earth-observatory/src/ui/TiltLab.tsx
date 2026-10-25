import { useMemo, useState } from 'react';
import uPlot from 'uplot';
import { L, useLang } from '../i18n';
import { useStore } from '../store';
import { analyticDay, hypotheticalDeclination, obliquity, seasonMarks, subsolarPoint, sunAt } from '../astro/solar';
import { hoursToHM } from '../astro/time';
import { Hypothetical, Term } from './common';
import Chart from './Chart';

export default function TiltLab() {
  const lang = useLang();
  const time = useStore((s) => s.time);
  const sel = useStore((s) => s.selected);
  const [tilt, setTilt] = useState(0);
  const [lat, setLat] = useState(() => Math.round(sel?.lat ?? 35.8));
  const real = obliquity(time);
  const year = time.getUTCFullYear();
  const marks = useMemo(() => seasonMarks(year), [year]);
  const data = useMemo(() => {
    const xs: number[] = [], dh: number[] = [], dr: number[] = [], qh: number[] = [], qr: number[] = [];
    for (let i = 0; i < 365; i += 2) {
      const t = new Date(Date.UTC(year, 0, 1 + i, 12));
      const r = sunAt(t, 0, 0).distanceAU;
      const h = analyticDay(lat, hypotheticalDeclination(t, tilt), r);
      const rl = analyticDay(lat, subsolarPoint(t).lat, r);
      xs.push(t.getTime() / 1000); dh.push(h.dayLength); dr.push(rl.dayLength); qh.push(h.dailyMean); qr.push(rl.dailyMean);
    }
    return { d: [xs, dr, dh] as uPlot.AlignedData, q: [xs, qr, qh] as uPlot.AlignedData };
  }, [lat, tilt, year]);
  const at = (d: Date) => analyticDay(lat, hypotheticalDeclination(d, tilt), sunAt(d, 0, 0).distanceAU);
  const jun = at(marks.juneSolstice), dec = at(marks.decemberSolstice);
  const monthAxis = { values: (_u: uPlot, v: number[]) => v.map((x) => new Date(x * 1000).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB', { month: 'short', timeZone: 'UTC' })) };

  return (
    <div className="panel-body">
      <h2>{L('مختبر ميل المحور', 'Axial tilt lab')}</h2>
      <Hypothetical>
        {L('تجربة تعليمية افتراضية: ماذا لو كان ميل محور الأرض مختلفاً؟ المدار والمسافة كما هما في الواقع. الميل الحقيقي الآن ', 'A hypothetical teaching experiment: what if Earth’s tilt were different? Orbit and distance stay real. The real tilt now is ')}
        <b className="ltr">{real.toFixed(3)}°</b>.
      </Hypothetical>
      <div className="row">
        <div className="presets" role="group" aria-label={L('ميل جاهز', 'Tilt presets')}>
          {[0, 23.44, 45].map((t) => <button key={t} className={`btn ${tilt === t ? 'active' : ''}`} aria-pressed={tilt === t} onClick={() => setTilt(t)}>{t}°</button>)}
        </div>
        <label className="slider"><span><Term id="obliquity">{L('الميل', 'Tilt')}</Term>: <b className="ltr">{tilt.toFixed(1)}°</b></span><input type="range" min={0} max={60} step={0.5} value={tilt} onChange={(e) => setTilt(Number(e.target.value))} /></label>
        <label className="slider"><span>{L('العرض الجغرافي', 'Latitude')}: <b className="ltr">{lat}°</b></span><input type="range" min={-90} max={90} step={1} value={lat} onChange={(e) => setLat(Number(e.target.value))} /></label>
      </div>
      <TiltDiagram tilt={tilt} />
      <table className="compare">
        <thead><tr><th></th><th>{L('انقلاب يونيو', 'June solstice')}</th><th>{L('انقلاب ديسمبر', 'December solstice')}</th></tr></thead>
        <tbody>
          <tr><th>{L('طول النهار', 'Day length')}</th><td>{hoursToHM(jun.dayLength)}</td><td>{hoursToHM(dec.dayLength)}</td></tr>
          <tr><th>{L('ارتفاع الشمس عند الزوال', 'Noon altitude')}</th><td className="ltr">{Math.max(jun.noonAltitude, -90).toFixed(1)}°</td><td className="ltr">{dec.noonAltitude.toFixed(1)}°</td></tr>
          <tr><th>{L('الإشعاع اليومي', 'Daily insolation')}</th><td className="ltr">{jun.dailyMean.toFixed(0)} W/m²</td><td className="ltr">{dec.dailyMean.toFixed(0)} W/m²</td></tr>
        </tbody>
      </table>
      <p className="muted">
        {tilt === 0 ? L('بميل 0°: نهار 12 ساعة في كل مكان طوال السنة، ولا فصول فلكية؛ يبقى فرق صغير جداً بسبب تغير المسافة.', 'With 0° tilt: 12-hour days everywhere all year and no astronomical seasons; only a tiny effect of the changing distance remains.')
          : <>{L('المداران عند', 'The tropics would be at')} ±<span className="ltr">{tilt.toFixed(1)}°</span> {L('والدائرتان القطبيتان عند', 'and the polar circles at')} ±<span className="ltr">{(90 - tilt).toFixed(1)}°</span>.</>}
      </p>
      <h3>{L('طول النهار: الحقيقي مقابل الافتراضي', 'Day length: real vs hypothetical')}</h3>
      <Chart title={L('طول النهار', 'Day length')} data={data.d} marker={time.getTime() / 1000}
        series={[{ label: L('حقيقي', 'real') + ` ${real.toFixed(2)}°`, stroke: '#7fd4ff', width: 2 }, { label: L('افتراضي', 'hypothetical') + ` ${tilt}°`, stroke: '#ff5f87', width: 2, dash: [6, 4] }]}
        scales={{ y: { range: [0, 24] } }} axes={[monthAxis, {}]} />
      <h3>{L('الإشعاع اليومي فوق الغلاف', 'Daily TOA insolation')}</h3>
      <Chart title={L('الإشعاع اليومي', 'Daily insolation')} data={data.q} marker={time.getTime() / 1000}
        series={[{ label: L('حقيقي W/m²', 'real W/m²'), stroke: '#ff9f5a', width: 2 }, { label: L('افتراضي W/m²', 'hypothetical W/m²'), stroke: '#ff5f87', width: 2, dash: [6, 4] }]}
        scales={{ y: { range: [0, 700] } }} axes={[monthAxis, {}]} />
      <p className="muted">{L('النموذج: δ = asin(sin ε · sin λ) حيث λ خط الطول الكسوفي الحقيقي للشمس، ثم معادلات طول النهار والإشعاع اليومي القياسية.', 'Model: δ = asin(sin ε · sin λ) with λ the sun’s real ecliptic longitude, then the standard day-length and daily-insolation equations.')}</p>
    </div>
  );
}

function TiltDiagram({ tilt }: { tilt: number }) {
  const r = 46, cx = 150, cy = 75;
  const a = (tilt * Math.PI) / 180;
  const ax = Math.sin(a) * 70, ay = Math.cos(a) * 70;
  const lat = (deg: number, color: string, label: string) => {
    // parallel drawn as a line perpendicular to the axis
    const s = Math.sin((deg * Math.PI) / 180) * r, c = Math.cos((deg * Math.PI) / 180) * r;
    // axis "up" points towards the sun (left) by the tilt angle, as at the June solstice
    const px = cx - Math.sin(a) * s, py = cy - Math.cos(a) * s;
    return <g key={label}><line x1={px - Math.cos(a) * c} y1={py + Math.sin(a) * c} x2={px + Math.cos(a) * c} y2={py - Math.sin(a) * c} stroke={color} strokeWidth="1.2" /></g>;
  };
  return (
    <svg viewBox="0 0 300 150" className="tilt-diagram" role="img" aria-label={`${L('الأرض بميل', 'Earth with a tilt of')} ${tilt}°`}>
      {[20, 45, 70, 95, 120].map((y) => <line key={y} x1="0" y1={y} x2="80" y2={y} stroke="#ffd54a" strokeOpacity="0.5" markerEnd="url(#arr)" />)}
      <defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ffd54a" /></marker></defs>
      <text x="4" y="12" fontSize="10" fill="#ffd54a">{L('أشعة الشمس', 'sunlight')}</text>
      <circle cx={cx} cy={cy} r={r} fill="#18324f" stroke="#7fd4ff" />
      <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} fill="#3b6ea5" opacity="0.8" />
      {lat(0, '#ff7a7a', 'eq')}
      {tilt > 0 && lat(tilt, '#ffb347', 'tc')}
      {tilt > 0 && lat(-tilt, '#ffb347', 'tcap')}
      {tilt > 0 && lat(90 - tilt, '#7fd4ff', 'ac')}
      <line x1={cx + ax} y1={cy + ay} x2={cx - ax} y2={cy - ay} stroke="#fff" strokeWidth="2" />
      <line x1={cx} y1={cy - 70} x2={cx} y2={cy + 70} stroke="#fff" strokeOpacity="0.25" strokeDasharray="3 3" />
      <text x={cx - ax + 4} y={cy - ay - 4} fontSize="11" fill="#fff">N {tilt}°</text>
      <text x="296" y="146" textAnchor="end" fontSize="10" fill="#9fb3c8">{L('عند انقلاب يونيو', 'at the June solstice')}</text>
    </svg>
  );
}
