import { useMemo } from 'react';
import { L, useLang } from '../i18n';
import { PRESETS, setState, useStore, type Place } from '../store';
import { astronomicalSeason, dayInfo, sunAt } from '../astro/solar';
import { formatTime, hoursToHM, localMidnight, timeZoneAt } from '../astro/time';
import { pointForecast } from '../sources/openMeteo';
import { useAsync, KindBadge } from './common';
import { fmtTemp } from './units';
import { globeApi } from '../globe/Globe';

function PinRow({ p }: { p: Place }) {
  useLang();
  const time = useStore((s) => s.time);
  const tu = useStore((s) => s.tempUnit);
  const zone = timeZoneAt(p.lat, p.lon);
  const mid = localMidnight(time, zone).getTime();
  const day = useMemo(() => dayInfo(new Date(mid), p.lat, p.lon), [mid, p.lat, p.lon]);
  const sun = sunAt(time, p.lat, p.lon);
  const season = astronomicalSeason(time);
  const s = p.lat >= 0 ? season.north : season.south;
  const fc = useAsync(() => pointForecast(p.lat, p.lon), [p.lat.toFixed(2), p.lon.toFixed(2)]);
  const f = fc.data?.data;
  const i = f ? f.hourly.time.findIndex((t) => Math.floor(t / 3600) === Math.floor(time.getTime() / 3600e3)) : -1;
  const temp = f && i >= 0 ? f.hourly.temperature_2m[i] : null;
  const sname = { spring: L('ربيع', 'spring'), summer: L('صيف', 'summer'), autumn: L('خريف', 'autumn'), winter: L('شتاء', 'winter') }[s];
  return (
    <tr>
      <th scope="row"><button className="link" onClick={() => { setState({ selected: p, panel: 'place' }); globeApi.flyTo(p.lat, p.lon); }}>{p.name || `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`}</button></th>
      <td className="ltr">{formatTime(time, zone)}</td>
      <td className="ltr">{sun.altitude.toFixed(1)}°</td>
      <td className="ltr">{day.noonAltitude.toFixed(1)}°</td>
      <td>{hoursToHM(day.dayLengthHours)}</td>
      <td>{sname}</td>
      <td>{fc.loading ? '…' : temp !== null ? fmtTemp(temp, tu) : <span title={L('خارج مدى التوقع', 'outside forecast range')}>—</span>}</td>
      <td><button className="btn small" aria-label={L('إزالة', 'Remove')} onClick={() => setState((st) => ({ pins: st.pins.filter((x) => x.id !== p.id) }))}>✕</button></td>
    </tr>
  );
}

export default function PinsCompare() {
  useLang();
  const pins = useStore((s) => s.pins);
  const add = (ps: Place[]) => setState((st) => ({ pins: [...st.pins.filter((x) => !ps.some((p) => p.id === x.id)), ...ps].slice(-6) }));
  return (
    <div className="panel-body">
      <h2>{L('مقارنة المواقع المثبّتة', 'Compare pinned places')}</h2>
      <p className="muted">{L('ثبّت حتى 6 مواقع من لوحة الموقع. القيم كلها للحظة نفسها على شريط الزمن.', 'Pin up to 6 places from the location panel. All values are for the same moment on the timeline.')}</p>
      <div className="row">
        <button className="btn" onClick={() => add([PRESETS[0], PRESETS[1]])}>{L('طنجة ↔ كيب تاون', 'Tangier ↔ Cape Town')}</button>
        <button className="btn" onClick={() => add([PRESETS[2], PRESETS[3], PRESETS[4]])}>{L('ترومسو · كيتو · بوينس آيرس', 'Tromsø · Quito · Buenos Aires')}</button>
      </div>
      {pins.length === 0 ? <p>{L('لا توجد مواقع مثبّتة بعد.', 'No pinned places yet.')}</p> : (
        <div className="table-scroll">
          <table className="compare wide">
            <thead><tr><th>{L('الموقع', 'Place')}</th><th>{L('الوقت المحلي', 'Local time')}</th><th>{L('ارتفاع الشمس', 'Sun alt.')}</th><th>{L('عند الزوال', 'At noon')}</th><th>{L('طول النهار', 'Day length')}</th><th>{L('الفصل', 'Season')}</th><th><KindBadge kind="forecast" /> {L('الحرارة', 'Temp.')}</th><th></th></tr></thead>
            <tbody>{pins.map((p) => <PinRow key={p.id} p={p} />)}</tbody>
          </table>
        </div>
      )}
      <p className="muted">{L('الحرارة: توقع ECMWF IFS (عبر Open-Meteo) للساعة المختارة؛ تظهر «—» خارج مدى التوقع.', 'Temperature: ECMWF IFS forecast (via Open-Meteo) for the selected hour; “—” outside the forecast range.')}</p>
    </div>
  );
}
