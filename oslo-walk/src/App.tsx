import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine';
import type { LocationId, Settings } from './engine/types';
import { LOCATIONS } from './engine/types';
import { Welcome } from './ui/Welcome';
import { Panel } from './ui/Panel';
import { Joystick } from './ui/Joystick';
import { Icon } from './ui/Icon';

type Phase = 'welcome' | 'exploring' | 'paused';

const DEFAULTS: Settings = {
  location: 'karljohan',
  time: 'sunny',
  weather: 'clear',
  season: 'summer',
  quality: 'high',
  walkSpeed: 1,
  sensitivity: 1,
  reducedMotion: false,
  volume: 0.7,
  muted: false,
};

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem('oslo-walk-settings') || '{}');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowEnd = matchMedia('(pointer: coarse)').matches;
    return { ...DEFAULTS, quality: lowEnd ? 'low' : DEFAULTS.quality, reducedMotion: reduced, ...s };
  } catch {
    return DEFAULTS;
  }
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [phase, setPhase] = useState<Phase>('welcome');
  const [progress, setProgress] = useState({ p: 0, label: 'Starting' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [street, setStreet] = useState('');
  const [panel, setPanel] = useState(false);
  const [hint, setHint] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState({ fps: 0, scale: 1, people: 0 });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const el = stageRef.current!;
    let engine: Engine;
    try {
      engine = new Engine(el, settings, {
        progress: (p, label) => setProgress({ p, label }),
        ready: () => {
          setReady(true);
          setToast(null);
        },
        error: (msg) => setError(msg),
        location: (s) => setStreet(s),
        lock: (locked) => {
          if (!locked && phaseRef.current === 'exploring' && !matchMedia('(pointer: coarse)').matches) setPhase('paused');
        },
        stats: (s) => setStats(s),
      });
    } catch (e) {
      setError(`WebGL could not start in this browser (${(e as Error).message}). Try an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration enabled.`);
      return;
    }
    engineRef.current = engine;
    if (import.meta.env.DEV) (window as unknown as { __oslo: Engine }).__oslo = engine;
    void engine.load(settings.location);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = useCallback((next: Partial<Settings>) => {
    setSettings((prev) => {
      const s = { ...prev, ...next };
      try {
        localStorage.setItem('oslo-walk-settings', JSON.stringify(s));
      } catch {
        /* storage unavailable */
      }
      return s;
    });
    const e = engineRef.current;
    if (!e) return;
    e.update(next);
    if (next.location) {
      setReady(false);
      setError(null);
      setToast(`Loading ${LOCATIONS.find((l) => l.id === next.location)?.title}…`);
      void e.load(next.location as LocationId);
    }
  }, []);

  const start = async () => {
    const e = engineRef.current;
    if (!e) return;
    setPhase('exploring');
    await e.begin();
  };
  const resume = () => {
    setPhase('exploring');
    setPanel(false);
    engineRef.current?.resume();
  };
  const exitToMenu = () => {
    engineRef.current?.pause();
    setPanel(false);
    setPhase('welcome');
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'KeyH' && phaseRef.current === 'exploring') setHint((h) => !h);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => setToast('Fullscreen is not available here'));
  };

  const loc = LOCATIONS.find((l) => l.id === settings.location)!;
  const exploring = phase !== 'welcome';
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  return (
    <>
      <div className="stage" ref={stageRef} aria-label="3D view of Oslo" />

      {phase === 'welcome' && (
        <Welcome settings={settings} onChange={change} onStart={start} ready={ready && !error} progress={progress} />
      )}

      {exploring && (
        <>
          <div className="hud-top">
            <div className="pill" role="status" aria-live="polite">
              <span className="dot" />
              <span className="where">{street || loc.title}</span>
              <span className="area">{loc.title === street ? 'Oslo' : loc.title}</span>
            </div>
            <div className="hud-actions">
              <button className="icon-btn" aria-label={settings.muted ? 'Unmute sound' : 'Mute sound'} onClick={() => change({ muted: !settings.muted })}>
                <Icon name={settings.muted ? 'mute' : 'sound'} />
              </button>
              <button className="icon-btn" aria-label="Settings" aria-expanded={panel} onClick={() => setPanel((p) => !p)}>
                <Icon name="sliders" />
              </button>
              <button className="icon-btn" aria-label="Pause" onClick={() => { engineRef.current?.pause(); setPhase('paused'); }}>
                <Icon name="pause" />
              </button>
            </div>
          </div>
          {!coarse && phase === 'exploring' && <div className="crosshair" />}
          {hint && phase === 'exploring' && (
            <div className="hint">
              <div className="keys">
                {coarse ? (
                  <span>Left stick to walk · drag anywhere to look</span>
                ) : (
                  <>
                    <span><kbd>W A S D</kbd>walk</span>
                    <span><kbd>Mouse</kbd>look</span>
                    <span><kbd>Shift</kbd>faster</span>
                    <span><kbd>Esc</kbd>menu</span>
                  </>
                )}
              </div>
              <button onClick={() => setHint(false)}>Hide</button>
            </div>
          )}
          {coarse && phase === 'exploring' && <Joystick onMove={(x, y) => engineRef.current?.setStick(x, y)} />}
          {panel && (
            <Panel
              settings={settings}
              onChange={change}
              stats={stats}
              onFullscreen={toggleFullscreen}
              onRespawn={() => engineRef.current?.respawn()}
              onClose={() => setPanel(false)}
            />
          )}
        </>
      )}

      {phase === 'paused' && !panel && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && resume()}>
          <div className="dialog" role="dialog" aria-label="Paused">
            <h3>Paused</h3>
            <p>{street || loc.title}, Oslo</p>
            <button className="start" onClick={resume} autoFocus>Continue walking</button>
            <div className="panel-buttons">
              <button className="ghost" onClick={() => setPanel(true)}>Settings</button>
              <button className="ghost" onClick={exitToMenu}>Main menu</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      {error && (
        <div className="overlay">
          <div className="dialog error" role="alertdialog">
            <h3>Something went wrong</h3>
            <p>{error}</p>
            <button className="start" onClick={() => { setError(null); void engineRef.current?.load(settings.location); }}>Retry</button>
          </div>
        </div>
      )}
    </>
  );
}
