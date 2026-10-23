import { useState } from 'react';
import type { Settings, TimePreset } from '../engine/types';
import { LOCATIONS } from '../engine/types';
import { Icon } from './Icon';

interface Props {
  settings: Settings;
  onChange(s: Partial<Settings>): void;
  onStart(): void;
  ready: boolean;
  progress: { p: number; label: string };
}

const DAY: TimePreset[] = ['sunny', 'overcast', 'golden'];
const NIGHT: TimePreset[] = ['blue', 'night'];

export function Welcome({ settings, onChange, onStart, ready, progress }: Props) {
  const [leaving, setLeaving] = useState(false);
  const night = NIGHT.includes(settings.time);
  const go = () => {
    setLeaving(true);
    onStart();
  };
  return (
    <div className={`welcome${leaving ? ' leaving' : ''}`}>
      <div className="welcome-inner">
        <div>
          <p className="eyebrow">An immersive city experience · Norway</p>
          <h1 className="title">
            OSLO<br />
            <span>WALK</span>
          </h1>
          <p className="subtitle">Explore Norway, one street at a time.</p>
        </div>
        <div className="card">
          <div>
            <div className="field-label">Where to start</div>
            <div className="locs">
              {LOCATIONS.map((l) => (
                <button key={l.id} className="loc" aria-pressed={settings.location === l.id} onClick={() => onChange({ location: l.id })}>
                  <b>{l.title}</b>
                  <small>{l.blurb}</small>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label">Light</div>
            <div className="seg" role="group" aria-label="Day or night">
              <button aria-pressed={!night} onClick={() => onChange({ time: 'sunny' })}>
                <Icon name="sun" /> Day
              </button>
              <button aria-pressed={night} onClick={() => onChange({ time: 'night' })}>
                <Icon name="moon" /> Night
              </button>
            </div>
            <div className="seg" style={{ marginTop: 8 }} role="group" aria-label="Time of day">
              {(night ? NIGHT : DAY).map((t) => (
                <button key={t} aria-pressed={settings.time === t} onClick={() => onChange({ time: t })}>
                  {LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <button className="start" onClick={go} disabled={!ready}>
              <span>{ready ? 'Start Walking' : 'Preparing the city…'}</span>
              <Icon name="arrow" />
            </button>
            <div className="progress" style={{ marginTop: 12 }} aria-hidden={ready}>
              <i style={{ width: `${Math.round(progress.p * 100)}%` }} />
            </div>
            <div className="progress-label">
              <span>{progress.label}</span>
              <span>{Math.round(progress.p * 100)}%</span>
            </div>
          </div>
          <div className="keys">
            <span><kbd>W A S D</kbd>walk</span>
            <span><kbd>Mouse</kbd>look</span>
            <span><kbd>Shift</kbd>walk faster</span>
            <span><kbd>Esc</kbd>menu</span>
          </div>
          <p className="credit">
            Streets, buildings, trees and lamps come from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> (ODbL). Building shapes and heights are real where mapped; facades, materials and people are procedural reconstructions, not photographs or scans.
          </p>
        </div>
      </div>
    </div>
  );
}

export const LABEL: Record<TimePreset, string> = {
  sunny: 'Sunny',
  overcast: 'Overcast',
  golden: 'Golden hour',
  blue: 'Blue hour',
  night: 'Night',
};
