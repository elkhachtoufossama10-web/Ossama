/** Small, dependency-free fetch layer: timeout, retries with backoff, Retry-After, in-flight de-duplication,
 * TTL cache (memory + sessionStorage) and mandatory response validation. */

export class SourceError extends Error {
  constructor(message: string, public status?: number, public source?: string) {
    super(message);
  }
}

export type Validator<T> = (x: unknown) => T; // throws on invalid input

interface Opts<T> {
  ttlMs: number;
  validate: Validator<T>;
  source: string;
  timeoutMs?: number;
  retries?: number;
  persist?: boolean;
  headers?: Record<string, string>;
}

const mem = new Map<string, { t: number; v: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, o: Opts<T>): Promise<{ data: T; fetchedAt: Date; fromCache: boolean }> {
  const now = Date.now();
  const hit = mem.get(url);
  if (hit && now - hit.t < o.ttlMs) return { data: hit.v as T, fetchedAt: new Date(hit.t), fromCache: true };
  if (o.persist !== false) {
    try {
      const raw = sessionStorage.getItem('eo.c:' + url);
      if (raw) {
        const { t, v } = JSON.parse(raw);
        if (now - t < o.ttlMs) {
          const data = o.validate(v);
          mem.set(url, { t, v: data });
          return { data, fetchedAt: new Date(t), fromCache: true };
        }
      }
    } catch { /* ignore cache problems */ }
  }
  let p = inflight.get(url) as Promise<T> | undefined;
  if (!p) {
    p = doFetch(url, o).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  const data = await p;
  const t = Date.now();
  return { data, fetchedAt: new Date(mem.get(url)?.t ?? t), fromCache: false };
}

async function doFetch<T>(url: string, o: Opts<T>): Promise<T> {
  const retries = o.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json, application/geo+json', ...o.headers } });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('Retry-After'));
        lastErr = new SourceError(`HTTP ${res.status}`, res.status, o.source);
        if (attempt < retries) {
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 800 * 2 ** attempt);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        let reason = '';
        try { reason = (await res.json())?.reason ?? ''; } catch { /* body not JSON */ }
        throw new SourceError(`HTTP ${res.status}${reason ? ': ' + reason : ''}`, res.status, o.source);
      }
      const json = await res.json();
      const data = o.validate(json);
      const t = Date.now();
      mem.set(url, { t, v: data });
      if (o.persist !== false) {
        try { sessionStorage.setItem('eo.c:' + url, JSON.stringify({ t, v: json })); } catch { /* quota */ }
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e instanceof SourceError && e.status && e.status < 500 && e.status !== 429) throw e;
      if (attempt < retries) await sleep(800 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof SourceError) throw lastErr;
  throw new SourceError(lastErr instanceof Error ? (lastErr.name === 'AbortError' ? 'timeout' : lastErr.message) : 'network error', undefined, o.source);
}

// ---------------------------------------------------------------- tiny validation helpers
export function obj(x: unknown, what: string): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new SourceError(`invalid response: ${what} is not an object`);
  return x as Record<string, unknown>;
}
export function arr(x: unknown, what: string): unknown[] {
  if (!Array.isArray(x)) throw new SourceError(`invalid response: ${what} is not an array`);
  return x;
}
export function num(x: unknown, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new SourceError(`invalid response: ${what} is not a number`);
  return x;
}
export function numOrNull(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}
export function str(x: unknown, what: string): string {
  if (typeof x !== 'string') throw new SourceError(`invalid response: ${what} is not a string`);
  return x;
}
/** numeric series with physical bounds; out-of-range values become null rather than being displayed */
export function series(x: unknown, what: string, min = -Infinity, max = Infinity): (number | null)[] {
  return arr(x, what).map((v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null));
}

/** Round coordinates before sending them to third parties (≈1.1 km at 2 decimals). */
export const roundCoord = (v: number, decimals = 2) => Number(v.toFixed(decimals));
