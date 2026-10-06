export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const FINE_WINDOW_MS = 6 * HOUR_MS;
export const COARSE_WINDOW_MS = 12 * HOUR_MS;
export const FINE_HORIZON_MS = 48 * HOUR_MS;
export const HORIZON_MS = 96 * HOUR_MS;

export type TimeWindow = {
  start: number;
  end: number;
};

export type JstParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
};

export function jstParts(utcMs: number): JstParts {
  const shifted = new Date(utcMs + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
  };
}

export function jstDateKey(utcMs: number): string {
  const parts = jstParts(utcMs);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

/** Start of the Japan-time block of `stepHours` that contains utcMs. */
export function floorBlockStart(utcMs: number, stepHours: number): number {
  const parts = jstParts(utcMs);
  const hour = Math.floor(parts.hour / stepHours) * stepHours;
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour) - JST_OFFSET_MS;
}

export function floorHour(utcMs: number): number {
  return Math.floor(utcMs / HOUR_MS) * HOUR_MS;
}

/**
 * 6-hour blocks from the block containing now through 48 hours ahead.
 * If that run ends away from 00 or 12 JST, one more 6-hour block is added
 * so the remainder stays on 00–12 and 12–24 through 96 hours ahead.
 */
export function forecastWindows(nowMs: number): TimeWindow[] {
  const fineUntil = nowMs + FINE_HORIZON_MS;
  const horizon = nowMs + HORIZON_MS;
  const windows: TimeWindow[] = [];

  let start = floorBlockStart(nowMs, 6);
  while (start < fineUntil) {
    windows.push({ start, end: start + FINE_WINDOW_MS });
    start += FINE_WINDOW_MS;
  }
  while (jstParts(start).hour % 12 !== 0) {
    windows.push({ start, end: start + FINE_WINDOW_MS });
    start += FINE_WINDOW_MS;
  }
  while (start < horizon) {
    windows.push({ start, end: start + COARSE_WINDOW_MS });
    start += COARSE_WINDOW_MS;
  }
  return windows;
}

export function cycleCandidates(nowMs: number): number[] {
  const step = 6 * HOUR_MS;
  const latest = Math.floor(nowMs / step) * step;
  return Array.from({ length: 6 }, (_, index) => latest - index * step);
}

export function formatCycle(utcMs: number): { ymd: string; hh: string } {
  const date = new Date(utcMs);
  const ymd = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  return { ymd, hh: String(date.getUTCHours()).padStart(2, "0") };
}
