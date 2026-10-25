import tzlookup from '@photostructure/tz-lookup';
import { getLang, locale } from '../i18n';

/** IANA time zone for coordinates — offline lookup (tz-lookup, built from timezone-boundary-builder). */
export function timeZoneAt(lat: number, lon: number): string {
  try {
    return tzlookup(lat, lon);
  } catch {
    return 'UTC';
  }
}

/** Offset of `zone` from UTC at `date`, in minutes (handles DST through Intl). */
export function zoneOffsetMinutes(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant of local midnight (start of the local civil day) for `date` in `zone`. */
export function localMidnight(date: Date, zone: string): Date {
  const off = zoneOffsetMinutes(date, zone);
  const local = new Date(date.getTime() + off * 60000);
  const midLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // offset may differ at midnight (DST change day) — iterate once
  const guess = new Date(midLocal - off * 60000);
  const off2 = zoneOffsetMinutes(guess, zone);
  return new Date(midLocal - off2 * 60000);
}

export function formatTime(date: Date | null, zone: string, withSeconds = false) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: zone, hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hourCycle: 'h23' }).format(date);
}

export function formatDate(date: Date, zone: string) {
  return new Intl.DateTimeFormat(locale(), { timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function formatDateTime(date: Date, zone: string) {
  return new Intl.DateTimeFormat(locale(), { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function formatOffset(min: number) {
  const s = min >= 0 ? '+' : '−';
  const a = Math.abs(min);
  return `UTC${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function hoursToHM(h: number) {
  const tot = Math.round(h * 60);
  const ar = getLang() === 'ar';
  return `${Math.floor(tot / 60)} ${ar ? 'س' : 'h'} ${String(tot % 60).padStart(2, '0')} ${ar ? 'د' : 'min'}`;
}

/** Human-readable age of data, e.g. "قبل 3 ساعات". */
export function ageLabel(from: Date, now = new Date()) {
  const m = Math.round((now.getTime() - from.getTime()) / 60000);
  const ar = getLang() === 'ar';
  if (m < 0) return ar ? `بعد ${fmtSpan(-m)}` : `in ${fmtSpan(-m)}`;
  if (m < 1) return ar ? 'قبل أقل من دقيقة' : 'less than a minute ago';
  return ar ? `قبل ${fmtSpan(m)}` : `${fmtSpan(m)} ago`;
}

function fmtSpan(m: number) {
  const ar = getLang() === 'ar';
  if (m < 60) return ar ? `${m} دقيقة` : `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return ar ? `${h} ساعة` : `${h} h`;
  return ar ? `${Math.round(h / 24)} يوم` : `${Math.round(h / 24)} days`;
}
