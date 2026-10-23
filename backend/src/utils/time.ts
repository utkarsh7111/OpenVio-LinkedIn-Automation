/** Parse a timestamp and return canonical UTC ISO-8601, or null for invalid input. */
export function toUtcIso(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function addMillisecondsUtc(value: unknown, milliseconds: number): string {
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(milliseconds)) throw new TypeError('A valid timestamp and duration are required');
  return new Date(date.getTime() + milliseconds).toISOString();
}

export function isAtLeastMinutesAhead(value: unknown, minutes: number, now: Date = new Date()): boolean {
  const timestamp = new Date(value as string | number | Date).getTime();
  const current = new Date(now).getTime();
  return Number.isFinite(timestamp) && Number.isFinite(current) && timestamp >= current + minutes * 60_000;
}
