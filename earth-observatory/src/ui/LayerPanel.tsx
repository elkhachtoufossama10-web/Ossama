import { useEffect, useState } from 'react';
import { L, useLang } from '../i18n';
import { setLayers, useStore, type LayerState } from '../store';
import { GIBS, gibsActualTime, gibsProvenance, gibsTime } from '../sources/gibs';
import { modelGrid, type GridSample } from '../sources/openMeteo';
import { renderGrid } from '../globe/gridImage';
import { globeApi } from '../globe/Globe';
import { SCALES, gradientCss } from '../globe/colormaps';
import { ProvenanceCard, KindBadge, Term } from './common';

const OVERLAYS: [string, string, string][] = [
  ['VIIRS_SNPP_CorrectedReflectance_TrueColor', 'صورة الأقمار الصناعية (ألوان حقيقية، يومية)', 'Satellite true colour (daily)'],
  ['MODIS_Terra_Cloud_Fraction_Day', 'نسبة الغطاء السحابي (MODIS، يومية)', 'Cloud fraction (MODIS, daily)'],
  ['IMERG_Precipitation_Rate_30min', 'شدة الهطول (IMERG، كل 30 دقيقة)', 'Precipitation rate (IMERG, 30 min)'],
  ['AIRS_L2_Surface_Air_Temperature_Day', 'حرارة الهواء السطحي — نهاراً (AIRS)', 'Surface air temperature — day (AIRS)'],
  ['AIRS_L2_Surface_Air_Temperature_Night', 'حرارة الهواء السطحي — ليلاً (AIRS)', 'Surface air temperature — night (AIRS)'],
  ['AIRS_L2_Surface_Relative_Humidity_Day', 'الرطوبة النسبية السطحية (AIRS)', 'Surface relative humidity (AIRS)'],
  ['MERRA2_2m_Air_Temperature_Monthly', 'متوسط حرارة الشهر (MERRA-2)', 'Monthly mean 2 m temperature (MERRA-2)'],
];
const MODEL_VARS: [NonNullable<LayerState['model']>, string, string][] = [
  ['temperature_2m', 'درجة الحرارة (2 م)', 'Temperature (2 m)'],
  ['apparent_temperature', 'الحرارة المحسوسة', 'Apparent temperature'],
  ['cloud_cover', 'الغطاء السحابي', 'Cloud cover'],
  ['precipitation', 'الهطول (ساعة)', 'Precipitation (1 h)'],
  ['wind_speed_10m', 'سرعة الرياح (10 م)', 'Wind speed (10 m)'],
  ['pressure_msl', 'الضغط عند سطح البحر', 'Sea-level pressure'],
  ['relative_humidity_2m', 'الرطوبة النسبية', 'Relative humidity'],
];

export interface ModelLayerStatus { state: 'off' | 'loading' | 'ready' | 'error' | 'out-of-range'; grid?: GridSample; error?: string }

/** Fetches the global model sample for the timeline hour (debounced, cached) and pushes it to the globe. */
export function useModelLayer(forecastEnd: Date | null): ModelLayerStatus {
  const variable = useStore((s) => s.layers.model);
  const opacity = useStore((s) => s.layers.modelOpacity);
  const time = useStore((s) => s.time);
  const hourKey = Math.floor(time.getTime() / 3600e3);
  const [st, setSt] = useState<ModelLayerStatus>({ state: 'off' });
  useEffect(() => {
    if (!variable) { setSt({ state: 'off' }); globeApi.setModelCanvas(null, 0); return; }
    const hour = new Date(hourKey * 3600e3);
    const end = forecastEnd ?? new Date(Date.now() + 15 * 86400e3);
    if (hour.getTime() < Date.now() - 2 * 86400e3 || hour > end) {
      setSt({ state: 'out-of-range' });
      globeApi.setModelCanvas(null, 0);
      return;
    }
    let alive = true;
    setSt((s) => ({ ...s, state: 'loading' }));
    const id = setTimeout(() => {
      modelGrid(hour).then((g) => {
        if (!alive) return;
        setSt({ state: 'ready', grid: g });
      }, (e) => alive && setSt({ state: 'error', error: e.message }));
    }, 700);
    return () => { alive = false; clearTimeout(id); };
  }, [variable, hourKey, forecastEnd]);
  useEffect(() => {
    if (st.state === 'ready' && st.grid && variable) globeApi.setModelCanvas(renderGrid(st.grid, variable), opacity);
    // opacity changes are applied by the globe sync without re-rendering the image
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, variable]);
  return st;
}

export default function LayerPanel({ model }: { model: ModelLayerStatus }) {
  const lang = useLang();
  const layers = useStore((s) => s.layers);
  const time = useStore((s) => s.time);
  const [actual, setActual] = useState<string | null>(null);
  const g = layers.gibs ? gibsTime(layers.gibs, time) : null;
  useEffect(() => {
    setActual(null);
    if (!layers.gibs || !g) return;
    let alive = true;
    gibsActualTime(layers.gibs, g.time).then((a) => alive && setActual(a));
    return () => { alive = false; };
  }, [layers.gibs, g?.time]);
  const gl = layers.gibs ? GIBS[layers.gibs] : null;

  return (
    <div className="layers">
      <fieldset>
        <legend>{L('الخريطة الأساسية', 'Base map')}</legend>
        <select value={layers.base} onChange={(e) => setLayers({ base: e.target.value as LayerState['base'] })} aria-label={L('الخريطة الأساسية', 'Base map')}>
          <option value="BlueMarble_ShadedRelief_Bathymetry">{L('الرخامة الزرقاء (تضاريس وأعماق)', 'Blue Marble (relief & bathymetry)')}</option>
          <option value="VIIRS_SNPP_CorrectedReflectance_TrueColor">{L('صورة ساتلية للتاريخ المختار', 'Satellite image of the selected date')}</option>
          <option value="ASTER_GDEM_Greyscale_Shaded_Relief">{L('تضاريس رمادية (ASTER)', 'Greyscale relief (ASTER)')}</option>
        </select>
        <div className="checks">
          {([['nightLights', 'أضواء المدن ليلاً', 'City lights at night'], ['borders', 'الحدود والسواحل', 'Borders & coastlines'], ['labels', 'أسماء الأماكن', 'Place labels'], ['graticule', 'خطوط العرض والطول الخاصة', 'Special latitudes & grid'], ['terminator', 'خط الليل والنهار والشفق', 'Day/night & twilight lines']] as [keyof LayerState, string, string][]).map(([k, ar, en]) => (
            <label key={k} className="check"><input type="checkbox" checked={!!layers[k]} onChange={(e) => setLayers({ [k]: e.target.checked } as Partial<LayerState>)} />{lang === 'ar' ? ar : en}</label>
          ))}
        </div>
        {layers.terminator && (
          <div className="mini-legend" aria-label={L('مفتاح خطوط الإضاءة', 'Lighting lines legend')}>
            <span><i style={{ background: '#ffd54a' }} />{L('شروق/غروب', 'sunrise/sunset')}</span>
            <span><i style={{ background: '#ff9f5a' }} />{L('نهاية الشفق المدني', 'end of civil twilight')}</span>
            <span><i style={{ background: '#b07cff' }} />{L('البحري', 'nautical')}</span>
            <span><i style={{ background: '#6c7bff' }} />{L('الفلكي', 'astronomical')}</span>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>{L('طبقات الأقمار الصناعية (NASA GIBS)', 'Satellite layers (NASA GIBS)')}</legend>
        <select value={layers.gibs ?? ''} onChange={(e) => setLayers({ gibs: e.target.value || null })} aria-label={L('طبقة ساتلية', 'Satellite layer')}>
          <option value="">{L('— بدون —', '— none —')}</option>
          {OVERLAYS.map(([id, ar, en]) => <option key={id} value={id}>{lang === 'ar' ? ar : en}</option>)}
        </select>
        {gl && g && (
          <div className="layer-info">
            <label className="slider small"><span>{L('الشفافية', 'Opacity')}</span><input type="range" min={0} max={1} step={0.05} value={layers.gibsOpacity} onChange={(e) => setLayers({ gibsOpacity: Number(e.target.value) })} /></label>
            <p>
              {L('التاريخ المطلوب', 'Requested')}: <b className="ltr">{g.label === 'latest' ? L('الأحدث المتاح', 'latest available') : g.label}</b>
              {actual && <> · {L('المعروض فعلاً', 'served')}: <b className="ltr">{actual.replace('T00:00:00Z', '')}</b></>}
            </p>
            {g.clamped === 'after' && <p className="warn">{L('لا توجد صور ساتلية للمستقبل؛ تُعرض أحدث صورة متاحة.', 'There is no satellite imagery of the future; the latest available image is shown.')}</p>}
            {g.clamped === 'before' && <p className="warn">{L('التاريخ قبل بداية هذا المنتج؛ يُعرض أول يوم متاح.', 'Date is before this product started; its first day is shown.')}</p>}
            {gl.legend && <img className="gibs-legend" src={gl.legend} alt={L('مفتاح ألوان الطبقة', 'Layer colour legend')} loading="lazy" />}
            <ProvenanceCard id="layer-gibs" p={gibsProvenance(gl.id, g.label, actual, time)} />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>{L('حقول نموذج ECMWF (شبكة عالمية)', 'ECMWF model fields (global grid)')}</legend>
        <select value={layers.model ?? ''} onChange={(e) => setLayers({ model: (e.target.value || null) as LayerState['model'] })} aria-label={L('حقل النموذج', 'Model field')}>
          <option value="">{L('— بدون —', '— none —')}</option>
          {MODEL_VARS.map(([id, ar, en]) => <option key={id} value={id}>{lang === 'ar' ? ar : en}</option>)}
        </select>
        {layers.model && (
          <div className="layer-info">
            <label className="slider small"><span>{L('الشفافية', 'Opacity')}</span><input type="range" min={0} max={1} step={0.05} value={layers.modelOpacity} onChange={(e) => setLayers({ modelOpacity: Number(e.target.value) })} /></label>
            <div className="legend-bar" aria-label={L('مفتاح الألوان', 'Colour legend')}>
              <div className="legend-grad" style={{ background: gradientCss(SCALES[layers.model]) }} />
              <div className="legend-ticks ltr">
                {SCALES[layers.model].ticks.map((t) => {
                  const s = SCALES[layers.model!].stops;
                  const lo = s[0][0], hi = s[s.length - 1][0];
                  return <span key={t} style={{ left: `${((t - lo) / (hi - lo)) * 100}%` }}>{t}</span>;
                })}
                <em>{SCALES[layers.model].unit}</em>
              </div>
            </div>
            {model.state === 'loading' && <p className="muted">{L('جارٍ جلب قيم النموذج لهذه الساعة…', 'Fetching model values for this hour…')}</p>}
            {model.state === 'out-of-range' && <p className="warn">{L('هذه الساعة خارج مدى بيانات النموذج المتاحة (من أمس حتى نهاية التوقع). لا نعرض قيماً مخترعة.', 'This hour is outside the model data range (yesterday to the end of the forecast). No invented values are shown.')}</p>}
            {model.state === 'error' && <p className="warn">{L('تعذّر التحميل', 'Could not load')}: {model.error}</p>}
            {model.grid && (
              <>
                <p className="muted"><KindBadge kind="forecast" /> {L('صالح لـ', 'valid')} <b className="ltr">{model.grid.hour.toISOString().slice(0, 13).replace('T', ' ')}:00 UTC</b> · <Term id="run">{L('تشغيل وصلاحية', 'run vs valid')}</Term></p>
                <ProvenanceCard id="layer-model" p={model.grid.prov} />
              </>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}
