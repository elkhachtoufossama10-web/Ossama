import { L, setLang, useLang } from '../i18n';
import { setState, useStore, type TempUnit, type TimeMode, type WindUnit } from '../store';

export default function SettingsPanel() {
  const lang = useLang();
  const tu = useStore((s) => s.tempUnit);
  const wu = useStore((s) => s.windUnit);
  const tm = useStore((s) => s.timeMode);
  const rg = useStore((s) => s.reverseGeocode);
  return (
    <div className="panel-body settings">
      <h2>{L('الإعدادات', 'Settings')}</h2>
      <label>{L('اللغة', 'Language')}
        <select value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en')}><option value="ar">العربية</option><option value="en">English</option></select>
      </label>
      <label>{L('الحرارة', 'Temperature')}
        <select value={tu} onChange={(e) => setState({ tempUnit: e.target.value as TempUnit })}><option value="C">°C</option><option value="F">°F</option></select>
      </label>
      <label>{L('الرياح', 'Wind')}
        <select value={wu} onChange={(e) => setState({ windUnit: e.target.value as WindUnit })}><option value="kmh">km/h</option><option value="ms">m/s</option><option value="kn">{L('عقدة', 'knots')}</option></select>
      </label>
      <label>{L('شريط الزمن يعرض', 'Timeline shows')}
        <select value={tm} onChange={(e) => setState({ timeMode: e.target.value as TimeMode })}><option value="local">{L('التوقيت المحلي للموقع المختار', 'local time of the selected place')}</option><option value="utc">UTC</option></select>
      </label>
      <label className="check"><input type="checkbox" checked={rg} onChange={(e) => setState({ reverseGeocode: e.target.checked })} />
        {L('معرفة اسم المكان عند النقر (يرسل إحداثيات مقربة إلى OpenStreetMap Nominatim)', 'Look up place names on click (sends rounded coordinates to OpenStreetMap Nominatim)')}</label>
      <button className="btn" onClick={() => {
        try {
          Object.keys(localStorage).filter((k) => k.startsWith('eo.')).forEach((k) => localStorage.removeItem(k));
          Object.keys(sessionStorage).filter((k) => k.startsWith('eo.')).forEach((k) => sessionStorage.removeItem(k));
        } catch { /* storage unavailable */ }
        setState({ pins: [] });
      }}>{L('حذف كل البيانات المحفوظة على هذا الجهاز', 'Delete all data stored on this device')}</button>
      <p className="muted">{L('يحترم التطبيق إعداد «تقليل الحركة» في نظامك.', 'The app honours your system “reduce motion” setting.')}</p>
    </div>
  );
}
