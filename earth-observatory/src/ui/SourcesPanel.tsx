import { L, useLang } from '../i18n';
import { useProvenanceList } from './provRegistry';
import { ProvenanceCard, KindBadge } from './common';
import type { DataKind } from '../sources/provenance';

interface Src { name: string; kind: DataKind[]; producer: string; access: string; url: string; terms: string; use: [string, string] }

const USED: Src[] = [
  { name: 'ECMWF IFS 0.25° open data', kind: ['forecast'], producer: 'European Centre for Medium-Range Weather Forecasts', access: 'Open-Meteo Forecast API (models=ecmwf_ifs025)', url: 'https://open-meteo.com/en/docs/ecmwf-api', terms: 'CC BY 4.0', use: ['التوقع الساعي واليومي حتى ~15 يوماً، وحالة النموذج الحالية، وحقول الشبكة العالمية', 'Hourly/daily forecast to ~15 days, current model state, global grid fields'] },
  { name: 'ERA5 reanalysis', kind: ['reanalysis', 'climatology'], producer: 'ECMWF for the Copernicus Climate Change Service (C3S)', access: 'Open-Meteo Historical Weather API (models=era5)', url: 'https://open-meteo.com/en/docs/historical-weather-api', terms: 'Copernicus licence + CC BY 4.0', use: ['السجل الماضي (من 1940) والمعدلات المناخية 1991–2020 المحسوبة في التطبيق', 'Past record (from 1940) and 1991–2020 normals computed in the app'] },
  { name: 'NASA GIBS', kind: ['observation', 'retrieval', 'analysis', 'reanalysis', 'static'], producer: 'NASA ESDIS (VIIRS, MODIS, AIRS, GPM IMERG, MERRA-2, Blue Marble, Black Marble)', access: 'WMTS EPSG:3857 tiles', url: 'https://nasa-gibs.github.io/gibs-api-docs/', terms: 'NASA open data policy, attribution', use: ['صور الأقمار الصناعية والطبقات الساتلية والخرائط الأساسية', 'Satellite imagery, satellite layers and base maps'] },
  { name: 'NOAA Aviation Weather Center — METAR', kind: ['observation'], producer: 'National met services via NOAA AWC', access: 'Data API through this app’s server relay (no CORS)', url: 'https://aviationweather.gov/data/api/', terms: 'Public domain', use: ['أقرب رصد فعلي لمحطة مطار في العالم', 'Nearest actual airport observation worldwide'] },
  { name: 'NOAA National Weather Service', kind: ['observation', 'analysis'], producer: 'NOAA/NWS', access: 'api.weather.gov', url: 'https://www.weather.gov/documentation/services-web-api', terms: 'Public domain', use: ['التحذيرات الرسمية ورصد المحطات داخل الولايات المتحدة', 'Official alerts and station observations in the US'] },
  { name: 'Open-Meteo Geocoding', kind: ['static'], producer: 'GeoNames', access: 'geocoding-api.open-meteo.com', url: 'https://open-meteo.com/en/docs/geocoding-api', terms: 'CC BY 4.0', use: ['البحث عن المدن (يُرسَل نص البحث فقط)', 'City search (only the typed text is sent)'] },
  { name: 'OpenStreetMap Nominatim', kind: ['static'], producer: 'OpenStreetMap contributors', access: 'nominatim.openstreetmap.org (≤1 req/s)', url: 'https://operations.osmfoundation.org/policies/nominatim/', terms: 'ODbL', use: ['اسم المكان عند النقر على الكرة (إحداثيات مقربة إلى ~1 كم، ويمكن إيقافه)', 'Place name for clicked points (coordinates rounded to ~1 km; can be disabled)'] },
  { name: 'astronomy-engine', kind: ['simulation'], producer: 'Don Cross (VSOP87, IAU 2006/2000B)', access: 'bundled library, offline', url: 'https://github.com/cosinekitty/astronomy', terms: 'MIT', use: ['كل حسابات الشمس والفصول والمدار، دون اتصال', 'All sun, season and orbit calculations, offline'] },
  { name: 'tz-lookup', kind: ['static'], producer: 'timezone-boundary-builder', access: 'bundled library, offline', url: 'https://github.com/photostructure/tz-lookup', terms: 'MIT / ODbL', use: ['المنطقة الزمنية من الإحداثيات دون اتصال', 'Time zone from coordinates, offline'] },
];

const NOT_USED: [string, string, string][] = [
  ['Maroc Météo (DGM)', 'لم نجد واجهة برمجية عامة موثقة، والموقع لم يكن متاحاً من بيئة التطوير. نضع رابطاً مباشراً للنشرات الرسمية بدلاً من استخراج البيانات من الموقع.', 'No documented public API was found and the site was unreachable from the build environment. We link to the official bulletins instead of scraping the site.'],
  ['ECMWF open data (GRIB) مباشرة', 'ملفات GRIB2 كبيرة وغير مناسبة للمتصفح؛ نستخدم البيانات نفسها عبر Open-Meteo مع ذكر ذلك صراحة.', 'GRIB2 files are large and not browser-friendly; the same data is used via Open-Meteo, stated explicitly.'],
  ['Copernicus Climate Data Store', 'يتطلب مفتاحاً شخصياً وطابوراً غير متزامن؛ نستخدم ERA5 عبر أرشيف Open-Meteo.', 'Requires a personal key and an asynchronous queue; ERA5 is used via the Open-Meteo archive.'],
  ['تحذيرات خارج الولايات المتحدة', 'لا توجد واجهة عالمية موحدة ومفتوحة تسمح بالطلب من المتصفح؛ نضع روابط رسمية (WMO SWIC، MeteoAlarm، Maroc Météo).', 'No open, unified, browser-accessible global API; official links are given (WMO SWIC, MeteoAlarm, Maroc Météo).'],
];

export default function SourcesPanel() {
  const lang = useLang();
  const live = useProvenanceList();
  return (
    <div className="panel-body">
      <h2>{L('المصادر المستخدمة فعلاً', 'Sources actually used')}</h2>
      <div className="sources">
        {USED.map((s) => (
          <div className="src" key={s.name}>
            <h3><a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a> {s.kind.map((k) => <KindBadge key={k} kind={k} />)}</h3>
            <p>{lang === 'ar' ? s.use[0] : s.use[1]}</p>
            <p className="muted">{L('المنتِج', 'Producer')}: {s.producer} · {L('الوصول', 'Access')}: {s.access} · {L('الشروط', 'Terms')}: {s.terms}</p>
          </div>
        ))}
      </div>
      <h2>{L('مصادر طُلبت ولم تُستخدم مباشرة', 'Requested sources not used directly')}</h2>
      <ul className="not-used">{NOT_USED.map(([n, ar, en]) => <li key={n}><b>{n}</b>: {lang === 'ar' ? ar : en}</li>)}</ul>
      <h2>{L('ما يُعرض على الشاشة الآن', 'What is on screen now')}</h2>
      {live.length === 0 ? <p className="muted">{L('افتح لوحة موقع أو طبقة لعرض سجل المصادر.', 'Open a location panel or a layer to list provenance here.')}</p> :
        live.map(([id, p]) => <ProvenanceCard key={id} id={id} p={p} noRegister />)}
      <h2>{L('الخصوصية', 'Privacy')}</h2>
      <ul>
        <li>{L('لا حسابات، لا ملفات تعريف تتبع، لا تحليلات. التفضيلات والمواقع المثبّتة محفوظة على جهازك فقط.', 'No accounts, no tracking cookies, no analytics. Preferences and pins are stored on your device only.')}</li>
        <li>{L('موقع الجهاز يُطلب فقط عند الضغط على ⌖، ويُقرَّب إلى منزلتين عشريتين (~1 كم) قبل أي استخدام.', 'Device location is requested only when you press ⌖, and rounded to 2 decimals (~1 km) before any use.')}</li>
        <li>{L('الإحداثيات (مقربة) تُرسل إلى مصادر الطقس المذكورة أعلاه لأنها ضرورية لجلب بيانات المكان، وإلى Nominatim لمعرفة الاسم (يمكن إيقافه من الإعدادات).', 'Rounded coordinates are sent to the weather sources above because they are needed to fetch data for the place, and to Nominatim for the name (can be disabled in Settings).')}</li>
      </ul>
    </div>
  );
}
