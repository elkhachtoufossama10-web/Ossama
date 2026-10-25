import { useEffect, useRef, useState } from 'react';
import { L, useLang } from '../i18n';
import { parseCoords, searchPlaces, type SearchHit } from '../sources/geocoding';
import { setState } from '../store';
import { globeApi } from '../globe/Globe';
import { roundCoord } from '../sources/http';

export default function SearchBox() {
  const lang = useLang();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || parseCoords(t) || t === chosen.current) { setHits([]); return; }
    const id = setTimeout(() => {
      searchPlaces(t, lang).then((h) => { setHits(h); setOpen(true); setActive(0); setMsg(h.length ? null : L('لا نتائج', 'No results')); }, (e) => setMsg(String(e.message)));
    }, 350);
    return () => clearTimeout(id);
  }, [q, lang]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (h: SearchHit) => {
    setState({ selected: h, panel: 'place' });
    globeApi.flyTo(h.lat, h.lon);
    setOpen(false);
    chosen.current = h.name;
    setQ(h.name);
  };
  const submit = () => {
    const c = parseCoords(q);
    if (c) {
      const p = { id: `k${c.lat},${c.lon}`, name: '', lat: c.lat, lon: c.lon, origin: 'coords' as const };
      setState({ selected: p, panel: 'place' });
      globeApi.flyTo(c.lat, c.lon);
      return;
    }
    if (hits[active]) choose(hits[active]);
  };
  const locate = () => {
    if (!('geolocation' in navigator)) { setMsg(L('المتصفح لا يدعم تحديد الموقع.', 'Geolocation is not supported.')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // Privacy: keep only ~1 km precision; that is all weather and sun calculations need.
        const lat = roundCoord(pos.coords.latitude), lon = roundCoord(pos.coords.longitude);
        setState({ selected: { id: `d${lat},${lon}`, name: '', lat, lon, origin: 'device' }, panel: 'place' });
        globeApi.flyTo(lat, lon, 3e6);
      },
      (err) => { setLocating(false); setMsg(err.code === 1 ? L('رُفض الإذن. يمكنك البحث يدوياً.', 'Permission denied. You can search manually.') : L('تعذّر تحديد الموقع.', 'Could not determine the location.')); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };

  return (
    <div className="search" ref={box}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          type="search" value={q} placeholder={L('ابحث عن مدينة أو اكتب إحداثيات (35.76, -5.83)', 'Search a city or type coordinates (35.76, -5.83)')}
          aria-label={L('بحث عن موقع', 'Search location')} aria-expanded={open && hits.length > 0} aria-controls="search-list" role="combobox" aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `hit-${active}` : undefined}
          onChange={(e) => { setQ(e.target.value); setMsg(null); }} onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <button type="button" className="btn icon" onClick={locate} disabled={locating}
          title={L('استخدم موقعي (يُطلب الإذن فقط عند الضغط، ويُقرَّب إلى ~1 كم)', 'Use my location (asked only when you click; rounded to ~1 km)')}
          aria-label={L('استخدم موقعي', 'Use my location')}>
          {locating ? '…' : '⌖'}
        </button>
      </form>
      {open && hits.length > 0 && (
        <ul className="search-list" id="search-list" role="listbox">
          {hits.map((h, i) => (
            <li key={h.id} id={`hit-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(h); }}>
              <b>{h.name}</b> <span>{[h.admin, h.country].filter(Boolean).join('، ')}</span>
            </li>
          ))}
          <li className="search-credit" aria-hidden>{L('البحث: Open-Meteo Geocoding (GeoNames)', 'Search: Open-Meteo Geocoding (GeoNames)')}</li>
        </ul>
      )}
      {msg && <div className="search-msg" role="status">{msg}</div>}
    </div>
  );
}
