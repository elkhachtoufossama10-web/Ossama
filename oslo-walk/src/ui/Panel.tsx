import type { Quality, Season, Settings, TimePreset, Weather } from '../engine/types';
import { LOCATIONS, isNight } from '../engine/types';
import { LABEL } from './Welcome';
import { Icon } from './Icon';

interface Props {
  settings: Settings;
  onChange(s: Partial<Settings>): void;
  stats: { fps: number; scale: number; people: number };
  onFullscreen(): void;
  onRespawn(): void;
  onClose(): void;
}

export function Panel({ settings: s, onChange, stats, onFullscreen, onRespawn, onClose }: Props) {
  const night = isNight(s.time);
  return (
    <aside className="panel" aria-label="Experience settings">
      <div className="toggle">
        <h2>Experience</h2>
        <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Close settings" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="row">
        <div className="field-label">Day / Night</div>
        <div className="seg" role="group" aria-label="Day or night">
          <button aria-pressed={!night} onClick={() => onChange({ time: 'sunny' })}><Icon name="sun" /> Day</button>
          <button aria-pressed={night} onClick={() => onChange({ time: 'night' })}><Icon name="moon" /> Night</button>
        </div>
        <div className="seg" role="group" aria-label="Time of day">
          {((night ? ['blue', 'night'] : ['sunny', 'overcast', 'golden']) as TimePreset[]).map((t) => (
            <button key={t} aria-pressed={s.time === t} onClick={() => onChange({ time: t })}>{LABEL[t]}</button>
          ))}
        </div>
      </div>

      <div className="row">
        <label className="field-label" htmlFor="loc">Location</label>
        <select id="loc" value={s.location} onChange={(e) => onChange({ location: e.target.value as Settings['location'] })}>
          {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>

      <div className="row">
        <label className="field-label" htmlFor="weather">Weather</label>
        <select id="weather" value={s.weather} onChange={(e) => onChange({ weather: e.target.value as Weather })}>
          <option value="clear">Clear</option>
          <option value="overcast">Overcast</option>
          <option value="rain">{s.season === 'winter' ? 'Snowfall' : 'Light rain'}</option>
          <option value="wet">Wet streets (after rain)</option>
        </select>
      </div>

      <div className="row">
        <label className="field-label" htmlFor="season">Season</label>
        <select id="season" value={s.season} onChange={(e) => onChange({ season: e.target.value as Season })}>
          <option value="summer">Summer greenery</option>
          <option value="autumn">Autumn leaves</option>
          <option value="winter">Snowy winter</option>
        </select>
      </div>

      <div className="row">
        <div className="field-label">Walking speed</div>
        <div className="slider">
          <input id="speed" type="range" min={0.6} max={1.8} step={0.05} value={s.walkSpeed} onChange={(e) => onChange({ walkSpeed: +e.target.value })} aria-label="Walking speed" />
          <output htmlFor="speed">{(1.4 * s.walkSpeed * 3.6).toFixed(1)} km/h</output>
        </div>
      </div>

      <div className="row">
        <div className="field-label">Look sensitivity</div>
        <div className="slider">
          <input id="sens" type="range" min={0.3} max={2.2} step={0.05} value={s.sensitivity} onChange={(e) => onChange({ sensitivity: +e.target.value })} aria-label="Look sensitivity" />
          <output htmlFor="sens">{s.sensitivity.toFixed(2)}×</output>
        </div>
      </div>

      <div className="row">
        <div className="field-label">Ambient sound</div>
        <div className="slider">
          <input id="vol" type="range" min={0} max={1} step={0.01} value={s.volume} onChange={(e) => onChange({ volume: +e.target.value, muted: false })} aria-label="Volume" />
          <output htmlFor="vol">{s.muted ? 'muted' : `${Math.round(s.volume * 100)}%`}</output>
        </div>
        <label className="toggle">
          <span>Mute</span>
          <input id="mute" type="checkbox" checked={s.muted} onChange={(e) => onChange({ muted: e.target.checked })} />
        </label>
      </div>

      <div className="row">
        <div className="field-label">Graphics quality</div>
        <div className="seg" role="group" aria-label="Graphics quality">
          {(['low', 'high', 'ultra'] as Quality[]).map((q) => (
            <button key={q} aria-pressed={s.quality === q} onClick={() => onChange({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}</button>
          ))}
        </div>
      </div>

      <label className="toggle">
        <span>Reduced motion (less head-bob)</span>
        <input id="reduced" type="checkbox" checked={s.reducedMotion} onChange={(e) => onChange({ reducedMotion: e.target.checked })} />
      </label>

      <div className="panel-buttons">
        <button className="ghost" onClick={onFullscreen}>Fullscreen</button>
        <button className="ghost" onClick={onRespawn}>Back to start point</button>
      </div>
      <div className="stats">{stats.fps} fps · render scale {Math.round(stats.scale * 100)}% · {stats.people} people nearby</div>
    </aside>
  );
}
