import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { L, useLang } from '../i18n';
import { KIND_LABEL, staleness, type DataKind, type Provenance } from '../sources/provenance';
import { GLOSSARY } from './glossary';
import { ageLabel } from '../astro/time';
import { registerProvenance } from './provRegistry';

export function Term({ id, children }: { id: keyof typeof GLOSSARY; children?: ReactNode }) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const tid = useId();
  const g = GLOSSARY[id];
  const [title, text] = lang === 'ar' ? g.ar : g.en;
  return (
    <span className="term" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="term-btn" aria-describedby={open ? tid : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}>
        {children ?? title}
        <span className="term-q" aria-hidden>?</span>
      </button>
      {open && (
        <span role="tooltip" id={tid} className="term-tip">
          <strong>{title}</strong>
          {text}
        </span>
      )}
    </span>
  );
}

export function KindBadge({ kind }: { kind: DataKind }) {
  useLang();
  const [ar, en] = KIND_LABEL[kind];
  return <span className={`kind kind-${kind}`}>{L(ar, en)}</span>;
}

const fmtUTC = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export function ProvenanceCard({ p, id, compact, noRegister }: { p: Provenance; id: string; compact?: boolean; noRegister?: boolean }) {
  useLang();
  useEffect(() => { if (!noRegister) registerProvenance(id, p); }, [id, p, noRegister]);
  const st = staleness(p);
  return (
    <details className={`prov prov-${st}`}>
      <summary>
        <KindBadge kind={p.kind} />
        <span className="prov-src">{p.producer}{p.provider && p.provider !== p.producer ? <> · {L('عبر', 'via')} {p.provider}</> : null}</span>
        {st !== 'fresh' && <span className="prov-warn" role="status">{st === 'stale' ? L('⚠ بيانات قديمة', '⚠ stale data') : L('بيانات متأخرة قليلاً', 'slightly old')}</span>}
        {!compact && (
          <span className="prov-times">
            {p.runTime && <>{L('تشغيل', 'run')} {fmtUTC(p.runTime)} · </>}
            {p.validTime && <>{L('صالح', 'valid')} {fmtUTC(p.validTime)} · </>}
            {L('جُلب', 'fetched')} {ageLabel(p.fetchedAt)}
          </span>
        )}
      </summary>
      <dl className="prov-dl">
        {p.model && <><dt>{L('المنتج/النموذج', 'Product / model')}</dt><dd>{p.model}</dd></>}
        {p.runTime && <><dt>{L('وقت تشغيل النموذج', 'Model run')}</dt><dd>{fmtUTC(p.runTime)} ({ageLabel(p.runTime)})</dd></>}
        {p.validTime && <><dt>{L('وقت الصلاحية/الرصد', 'Valid / observed')}</dt><dd>{fmtUTC(p.validTime)} ({ageLabel(p.validTime)})</dd></>}
        {p.validRange && <><dt>{L('المدى الزمني', 'Time range')}</dt><dd>{fmtUTC(p.validRange[0])} → {fmtUTC(p.validRange[1])}</dd></>}
        <dt>{L('وقت الجلب', 'Fetched')}</dt><dd>{fmtUTC(p.fetchedAt)}</dd>
        <dt>{L('التغطية', 'Coverage')}</dt><dd>{p.coverage}</dd>
        <dt>{L('الدقة', 'Resolution')}</dt><dd>{p.resolution}</dd>
        <dt>{L('الشروط', 'Terms')}</dt><dd>{p.terms} <a href={p.termsUrl} target="_blank" rel="noreferrer noopener">{L('التفاصيل', 'details')}</a></dd>
        {p.url && <><dt>{L('الطلب', 'Request')}</dt><dd className="ltr"><a href={p.url.startsWith('/') ? undefined : p.url} target="_blank" rel="noreferrer noopener">{p.url.length > 110 ? p.url.slice(0, 110) + '…' : p.url}</a></dd></>}
        {p.notes?.map((n, i) => <dd key={i} className="prov-note">ℹ {n}</dd>)}
      </dl>
    </details>
  );
}

export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]) {
  const [st, setSt] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: !!fn });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!fn) { setSt({ data: null, error: null, loading: false }); return; }
    let alive = true;
    setSt((s) => ({ data: s.data, error: null, loading: true }));
    fn().then(
      (data) => alive && setSt({ data, error: null, loading: false }),
      (error) => alive && setSt({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

export function ErrorNote({ error, onRetry, what }: { error: Error; onRetry?: () => void; what: string }) {
  useLang();
  const msg = error.message.includes('429') ? L('تم تجاوز حد الطلبات لدى المصدر. انتظر قليلاً ثم أعد المحاولة.', 'The source rate limit was reached. Wait a little and retry.')
    : error.message === 'timeout' ? L('انتهت مهلة الاتصال.', 'The request timed out.')
    : error.message;
  return (
    <div className="error-note" role="alert">
      <strong>{L('تعذّر تحميل', 'Could not load')} {what}</strong>: {msg}
      {onRetry && <button className="btn small" onClick={onRetry}>{L('إعادة المحاولة', 'Retry')}</button>}
    </div>
  );
}

export function Loading({ what }: { what?: string }) {
  useLang();
  return <div className="loading" role="status"><span className="spinner" aria-hidden />{L('جارٍ التحميل', 'Loading')}{what ? ` — ${what}` : ''}…</div>;
}

export function Stat({ label, value, sub, term }: { label: ReactNode; value: ReactNode; sub?: ReactNode; term?: keyof typeof GLOSSARY }) {
  return (
    <div className="stat">
      <div className="stat-label">{term ? <Term id={term}>{label}</Term> : label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: [T, string][]; value: T; onChange: (t: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const i = tabs.findIndex(([t]) => t === value);
        const rtl = document.documentElement.dir === 'rtl';
        const d = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
        const next = tabs[(i + d + tabs.length) % tabs.length][0];
        onChange(next);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus());
      }}>
      {tabs.map(([t, label]) => (
        <button key={t} role="tab" data-tab={t} aria-selected={t === value} tabIndex={t === value ? 0 : -1} className={t === value ? 'tab active' : 'tab'} onClick={() => onChange(t)}>{label}</button>
      ))}
    </div>
  );
}

export function Hypothetical({ children }: { children: ReactNode }) {
  return <div className="hypothetical" role="note"><span className="hyp-badge">{L('افتراضي', 'Hypothetical')}</span>{children}</div>;
}
