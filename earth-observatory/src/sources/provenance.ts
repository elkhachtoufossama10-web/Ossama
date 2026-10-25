/**
 * Every value shown in the app carries one of these labels. The categories are deliberately strict:
 * - observation: a measurement by an instrument at a place/time (station, METAR, satellite imagery)
 * - retrieval:   a geophysical quantity derived from satellite radiances (e.g. AIRS surface air temperature)
 * - analysis:    best estimate of the current/recent state blending observations and a model (e.g. IMERG)
 * - forecast:    output of a numerical weather prediction model for a future (or current) valid time
 * - reanalysis:  a consistent past record produced by re-running a fixed model with past observations (ERA5, MERRA-2)
 * - climatology: long-term statistics (here computed from ERA5 1991–2020)
 * - simulation:  computed by this app (astronomy) — not weather data
 */
export type DataKind = 'observation' | 'retrieval' | 'analysis' | 'forecast' | 'reanalysis' | 'climatology' | 'simulation' | 'static';

export interface Provenance {
  kind: DataKind;
  /** organisation that produced the data */
  producer: string;
  /** service the app actually fetched it from (may differ from the producer) */
  provider: string;
  model?: string;
  runTime?: Date;
  validTime?: Date;
  validRange?: [Date, Date];
  fetchedAt: Date;
  coverage: string;
  resolution: string;
  terms: string;
  termsUrl: string;
  url?: string;
  /** expected update cadence in minutes, used for staleness warnings */
  updateEveryMin?: number;
  /** the instant the user asked for (timeline); staleness is judged against it, so a deliberate look at the past is not "stale" */
  requestedFor?: Date;
  notes?: string[];
}

export function staleness(p: Provenance, now = new Date()): 'fresh' | 'aging' | 'stale' {
  const ref = p.kind === 'forecast' ? p.runTime : p.validTime ?? p.runTime;
  if (!ref || !p.updateEveryMin) return 'fresh';
  const target = p.requestedFor && p.requestedFor.getTime() < now.getTime() ? p.requestedFor : now;
  const age = (target.getTime() - ref.getTime()) / 60000;
  if (age > p.updateEveryMin * 3) return 'stale';
  if (age > p.updateEveryMin * 1.5) return 'aging';
  return 'fresh';
}

export const KIND_LABEL: Record<DataKind, [string, string]> = {
  observation: ['رصد', 'Observation'],
  retrieval: ['استرجاع ساتلي', 'Satellite retrieval'],
  analysis: ['تحليل', 'Analysis'],
  forecast: ['توقع نموذج', 'Model forecast'],
  reanalysis: ['إعادة تحليل', 'Reanalysis'],
  climatology: ['معدلات مناخية', 'Climatology'],
  simulation: ['محاكاة فلكية', 'Astronomical simulation'],
  static: ['طبقة ثابتة', 'Static layer'],
};
