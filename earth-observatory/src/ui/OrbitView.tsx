import { useMemo } from 'react';
import { L, useLang } from '../i18n';
import { setState, useStore } from '../store';
import { astronomicalSeason, orbitState, seasonMarks, subsolarPoint, AU_KM } from '../astro/solar';
import { Term } from './common';

/**
 * Top-down view of Earth's orbit in the J2000 ecliptic frame, computed with astronomy-engine.
 * Positions and the orbit shape are true; Earth and Sun sizes are NOT to scale.
 * The spin axis is drawn from the real pole direction — it keeps pointing the same way all year.
 */
export default function OrbitView() {
  const lang = useLang();
  const time = useStore((s) => s.time);
  const speed = useStore((s) => s.speed);
  const playing = useStore((s) => s.playing);
  const year = time.getUTCFullYear();
  const W = 820, H = 640, cx = W / 2, cy = H / 2, R = 240;
  const orbit = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 366; i += 3) {
      const o = orbitState(new Date(Date.UTC(year, 0, 1 + i)));
      pts.push(`${(cx + o.x * R).toFixed(1)},${(cy - o.y * R).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [year]);
  const marks = useMemo(() => seasonMarks(year), [year]);
  const markPts = useMemo(() => ([
    ['marchEquinox', L('اعتدال مارس', 'March equinox')],
    ['juneSolstice', L('انقلاب يونيو', 'June solstice')],
    ['septemberEquinox', L('اعتدال سبتمبر', 'September equinox')],
    ['decemberSolstice', L('انقلاب ديسمبر', 'December solstice')],
    ['perihelion', L('الحضيض (أقرب)', 'Perihelion (closest)')],
    ['aphelion', L('الأوج (أبعد)', 'Aphelion (farthest)')],
  ] as [keyof typeof marks, string][]).map(([k, label]) => {
    const d = marks[k];
    const o = orbitState(d);
    return { k, label, d, x: cx + o.x * R, y: cy - o.y * R };
  }), [marks, lang]);
  const o = orbitState(time);
  const ex = cx + o.x * R, ey = cy - o.y * R;
  // direction from Earth to Sun in screen space
  const sx = cx - ex, sy = cy - ey;
  const sl = Math.hypot(sx, sy);
  const sunAng = Math.atan2(sy, sx);
  const er = 16;
  const pole = o.pole;
  const plen = Math.hypot(pole.x, pole.y);
  const pxs = (pole.x / plen) * 34, pys = (-pole.y / plen) * 34;
  const decl = subsolarPoint(time).lat;
  const season = astronomicalSeason(time);
  const sname = (x: string) => ({ spring: L('ربيع', 'spring'), summer: L('صيف', 'summer'), autumn: L('خريف', 'autumn'), winter: L('شتاء', 'winter') } as Record<string, string>)[x];
  const fmt = (d: Date) => d.toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="orbit-view">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={L('منظر علوي لمدار الأرض حول الشمس', 'Top view of Earth’s orbit around the Sun')}>
        <defs>
          <radialGradient id="sunG"><stop offset="0" stopColor="#fff6c8" /><stop offset="0.5" stopColor="#ffd54a" /><stop offset="1" stopColor="#ff9f1a" stopOpacity="0" /></radialGradient>
          <marker id="ax" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#fff" /></marker>
        </defs>
        <polyline points={orbit} fill="none" stroke="#3d5f86" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={42} fill="url(#sunG)" />
        <circle cx={cx} cy={cy} r={16} fill="#ffe066" />
        {markPts.map((m) => (
          <g key={m.k} className="orbit-mark" role="button" tabIndex={0} aria-label={`${m.label} ${fmt(m.d)}`}
            onClick={() => setState({ time: m.d, live: false })} onKeyDown={(e) => e.key === 'Enter' && setState({ time: m.d, live: false })}>
            <circle cx={m.x} cy={m.y} r={4} fill={m.k === 'perihelion' || m.k === 'aphelion' ? '#c792ea' : '#ffb347'} />
            {(() => {
              // seasons outside the orbit, perihelion/aphelion inside, so neighbouring labels do not collide
              const inside = m.k === 'perihelion' || m.k === 'aphelion';
              const dx = m.x - cx, dy = m.y - cy, d = Math.hypot(dx, dy) || 1;
              const off = inside ? -22 : 18;
              const tx = m.x + (dx / d) * off, ty = m.y + (dy / d) * off + 4;
              const anchor = Math.abs(dx / d) < 0.3 ? 'middle' : (dx > 0) !== inside ? 'start' : 'end';
              return <text x={tx} y={ty} textAnchor={anchor} fontSize="12" fill={inside ? '#e2c6ff' : '#cfe3ff'}>{m.label} · {fmt(m.d)}</text>;
            })()}
          </g>
        ))}
        <g transform={`translate(${ex},${ey})`}>
          {/* night side */}
          <circle r={er} fill="#0d1b2a" stroke="#7fd4ff" strokeWidth="1" />
          {/* day half facing the sun */}
          <path d={`M ${Math.cos(sunAng + Math.PI / 2) * er} ${Math.sin(sunAng + Math.PI / 2) * er} A ${er} ${er} 0 0 0 ${Math.cos(sunAng - Math.PI / 2) * er} ${Math.sin(sunAng - Math.PI / 2) * er} Z`} fill="#3b8bd6" />
          <line x1={-pxs} y1={-pys} x2={pxs} y2={pys} stroke="#fff" strokeWidth="2" markerEnd="url(#ax)" />
          <text x={pxs + 4} y={pys - 4} fontSize="11" fill="#fff">N</text>
        </g>
        <line x1={ex + (sx / sl) * 22} y1={ey + (sy / sl) * 22} x2={ex + (sx / sl) * 60} y2={ey + (sy / sl) * 60} stroke="#ffd54a" strokeDasharray="3 3" />
        <text x={16} y={24} fontSize="13" fill="#9fb3c8">{L('منظر من فوق القطب الشمالي للكسوف — ليس بمقياس رسم للأحجام', 'Seen from above the ecliptic north pole — sizes not to scale')}</text>
        <text x={16} y={H - 34} fontSize="12" fill="#9fb3c8">{L('شكل المدار ومواقعه حقيقية (الانحراف 0.0167 فيبدو شبه دائري).', 'Orbit shape and positions are real (eccentricity 0.0167, so it looks almost circular).')}</text>
        <text x={16} y={H - 16} fontSize="12" fill="#9fb3c8">{L('السهم الأبيض = اتجاه محور الدوران، ثابت في الفضاء طوال السنة.', 'White arrow = spin axis direction, fixed in space all year.')}</text>
      </svg>
      <aside className="orbit-info" aria-live="polite">
        <h3>{fmt(time)} {time.getUTCFullYear()}</h3>
        <p><Term id="perihelion">{L('المسافة', 'Distance')}</Term>: <b className="ltr">{o.r.toFixed(5)} AU</b> <span className="ltr muted">({(o.r * AU_KM / 1e6).toFixed(2)} M km)</span></p>
        <p><Term id="declination">{L('ميل الشمس', 'Solar declination')}</Term>: <b className="ltr">{decl.toFixed(2)}°</b> — {decl > 0.3 ? L('النصف الشمالي مائل نحو الشمس', 'the northern hemisphere leans towards the sun') : decl < -0.3 ? L('النصف الجنوبي مائل نحو الشمس', 'the southern hemisphere leans towards the sun') : L('لا نصف مائل نحو الشمس (قرب الاعتدال)', 'neither hemisphere leans towards the sun (near equinox)')}</p>
        <p>{L('الشمال', 'North')}: <b>{sname(season.north)}</b> · {L('الجنوب', 'South')}: <b>{sname(season.south)}</b></p>
        <SideView decl={decl} />
        <div className="row">
          <button className="btn" onClick={() => setState({ playing: !playing, live: false, speed: playing ? speed : Math.max(speed, 86400) })}>{playing ? L('❚❚ إيقاف', '❚❚ Pause') : L('▶ تشغيل السنة', '▶ Play the year')}</button>
          <select value={speed} onChange={(e) => setState({ speed: Number(e.target.value) })} aria-label={L('السرعة', 'Speed')}>
            <option value={86400}>{L('يوم/ث', '1 day/s')}</option>
            <option value={7 * 86400}>{L('أسبوع/ث', '1 week/s')}</option>
            <option value={30 * 86400}>{L('شهر/ث', '1 month/s')}</option>
          </select>
        </div>
      </aside>
    </div>
  );
}

/** Side view perpendicular to the Earth–Sun line: the axis leans towards/away from the sun by the declination. */
function SideView({ decl }: { decl: number }) {
  const a = (decl * Math.PI) / 180;
  const cx = 150, cy = 60, r = 34;
  return (
    <svg viewBox="0 0 220 120" className="side-view" role="img" aria-label={L('منظر جانبي لميل المحور نحو الشمس', 'Side view of axis lean towards the sun')}>
      <circle cx="18" cy={cy} r="14" fill="#ffd54a" />
      <line x1="34" y1={cy} x2={cx - r - 6} y2={cy} stroke="#ffd54a" strokeDasharray="3 3" />
      <circle cx={cx} cy={cy} r={r} fill="#0d1b2a" stroke="#7fd4ff" />
      <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} fill="#3b8bd6" />
      <line x1={cx + Math.sin(a) * 50} y1={cy + Math.cos(a) * 50} x2={cx - Math.sin(a) * 50} y2={cy - Math.cos(a) * 50} stroke="#fff" strokeWidth="2" />
      <line x1={cx - Math.cos(a) * r} y1={cy + Math.sin(a) * r} x2={cx + Math.cos(a) * r} y2={cy - Math.sin(a) * r} stroke="#ff7a7a" />
      <text x={cx - Math.sin(a) * 50 + 4} y={cy - Math.cos(a) * 50 + 4} fontSize="10" fill="#fff">N</text>
      <text x="40" y="112" fontSize="10" fill="#9fb3c8">{L('ميل نحو الشمس', 'lean to sun')} = {decl.toFixed(1)}°</text>
    </svg>
  );
}
