import { lazy, Suspense, useEffect, useState } from 'react';
import { L, useLang } from './i18n';
import { setState, useStore } from './store';
import Globe, { globeApi } from './globe/Globe';
import TimeBar, { useClock } from './ui/TimeBar';
import SearchBox from './ui/SearchBox';
import LayerPanel, { useModelLayer } from './ui/LayerPanel';
import PlacePanel from './ui/PlacePanel';
import { useAsync } from './ui/common';
import { pointForecast } from './sources/openMeteo';

const SeasonsCompare = lazy(() => import('./ui/SeasonsCompare'));
const TiltLab = lazy(() => import('./ui/TiltLab'));
const OrbitView = lazy(() => import('./ui/OrbitView'));
const PinsCompare = lazy(() => import('./ui/PinsCompare'));
const SourcesPanel = lazy(() => import('./ui/SourcesPanel'));
const SettingsPanel = lazy(() => import('./ui/SettingsPanel'));
const GlossaryPanel = lazy(() => import('./ui/GlossaryPanel'));

type Panel = 'place' | 'seasons' | 'tilt' | 'compare' | 'sources' | 'settings' | 'glossary';

export default function App() {
  useLang();
  useClock();
  const panel = useStore((s) => s.panel);
  const view = useStore((s) => s.view);
  const sel = useStore((s) => s.selected);
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth > 900);
  // forecast range end for the selected place (shared cache with the panels)
  const fc = useAsync(sel ? () => pointForecast(sel.lat, sel.lon) : null, [sel?.lat.toFixed(2), sel?.lon.toFixed(2)]);
  const forecastEnd = fc.data?.data.lastValid ?? null;
  const model = useModelLayer(forecastEnd);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); setState((s) => ({ playing: !s.playing, live: false })); }
      if (e.key === 'n' || e.key === 'N') setState({ time: new Date(), live: true, playing: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nav: [Panel, string][] = [
    ['place', L('الموقع', 'Location')],
    ['seasons', L('لماذا الفصول؟', 'Why seasons?')],
    ['tilt', L('مختبر الميل', 'Tilt lab')],
    ['compare', L('مقارنة', 'Compare')],
    ['sources', L('المصادر', 'Sources')],
    ['glossary', L('المصطلحات', 'Glossary')],
    ['settings', L('الإعدادات', 'Settings')],
  ];

  return (
    <div className="app">
      <a href="#side" className="skip">{L('انتقل إلى اللوحة', 'Skip to panel')}</a>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◐</span>
          <div><h1>{L('مرصد الأرض', 'Earth Observatory')}</h1><small>{L('الشمس والفصول والطقس من مصادر موثوقة', 'Sun, seasons and weather from trusted sources')}</small></div>
        </div>
        <SearchBox />
        <div className="view-toggle" role="group" aria-label={L('العرض', 'View')}>
          <button className={`btn ${view === 'globe' ? 'active' : ''}`} aria-pressed={view === 'globe'} onClick={() => setState({ view: 'globe' })}>{L('الكرة الأرضية', 'Globe')}</button>
          <button className={`btn ${view === 'orbit' ? 'active' : ''}`} aria-pressed={view === 'orbit'} onClick={() => setState({ view: 'orbit' })}>{L('المدار', 'Orbit')}</button>
        </div>
        <nav className="nav" aria-label={L('اللوحات', 'Panels')}>
          {nav.map(([k, label]) => (
            <button key={k} className={`navbtn ${panel === k ? 'active' : ''}`} aria-pressed={panel === k} onClick={() => setState({ panel: panel === k ? null : k })}>{label}</button>
          ))}
        </nav>
      </header>
      <main className={`main ${panel ? 'with-panel' : ''}`}>
        <div className="stage">
          <div className="stage-globe" hidden={view !== 'globe'}>
            <Globe />
            <div className="globe-tools">
              <button className="btn icon" onClick={() => globeApi.zoom(1.6)} aria-label={L('تكبير', 'Zoom in')}>+</button>
              <button className="btn icon" onClick={() => globeApi.zoom(1 / 1.6)} aria-label={L('تصغير', 'Zoom out')}>−</button>
              <button className="btn icon" onClick={() => globeApi.resetView()} aria-label={L('إعادة العرض', 'Reset view')}>⌂</button>
              <button className="btn icon" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())} aria-label={L('ملء الشاشة', 'Full screen')}>⛶</button>
              <button className={`btn ${layersOpen ? 'active' : ''}`} aria-expanded={layersOpen} aria-controls="layers" onClick={() => setLayersOpen((o) => !o)}>{L('الطبقات', 'Layers')}</button>
            </div>
            {layersOpen && <div className="layers-float" id="layers"><LayerPanel model={model} /></div>}
          </div>
          {view === 'orbit' && <Suspense fallback={null}><OrbitView /></Suspense>}
        </div>
        {panel && (
          <aside className="side" id="side" aria-label={L('لوحة المعلومات', 'Info panel')}>
            <button className="btn small close" onClick={() => setState({ panel: null })} aria-label={L('إغلاق اللوحة', 'Close panel')}>✕</button>
            <Suspense fallback={<div className="loading">…</div>}>
              {panel === 'place' && <PlacePanel />}
              {panel === 'seasons' && <SeasonsCompare />}
              {panel === 'tilt' && <TiltLab />}
              {panel === 'compare' && <PinsCompare />}
              {panel === 'sources' && <SourcesPanel />}
              {panel === 'settings' && <SettingsPanel />}
              {panel === 'glossary' && <GlossaryPanel />}
            </Suspense>
          </aside>
        )}
      </main>
      <TimeBar forecastEnd={forecastEnd} />
    </div>
  );
}
