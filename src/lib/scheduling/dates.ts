/**
 * Calendar-day arithmetic on ISO dates (YYYY-MM-DD).
 *
 * Internally the engine works on integer "day numbers" (days since the Unix
 * epoch, UTC) so there are no timezone or DST surprises. All tasks use a
 * 7-day calendar: every day is a working day.
 */

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toDayNumber(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date "${iso}" (expected YYYY-MM-DD)`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY);
}

export function fromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Signed number of days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** Inclusive end date for a span starting at `start` lasting `duration` days. */
export function endDateFor(start: string, duration: number): string {
  return duration <= 0 ? start : addDays(start, duration - 1);
}

/** Duration in days of an inclusive [start, end] span (0 if end < start). */
export function durationBetween(start: string, end: string): number {
  return Math.max(0, diffDays(start, end) + 1);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return new Date(toDayNumber(iso) * MS_PER_DAY).getUTCDay();
}

export function todayIso(): string {
  const now = new Date();
  return fromDayNumber(
    Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY),
  );
}
