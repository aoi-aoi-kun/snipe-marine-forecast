export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const WINDOW_MS = 3 * HOUR_MS;
export const HORIZON_MS = 144 * HOUR_MS;

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

/** Start of the Japan-time block of `stepHours` that contains utcMs. */
export function floorBlockStart(utcMs: number, stepHours: number): number {
  const parts = jstParts(utcMs);
  const hour = Math.floor(parts.hour / stepHours) * stepHours;
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour) - JST_OFFSET_MS;
}

/** 3-hour Japan-time blocks from the block containing now through 144 hours ahead. */
export function forecastWindows(nowMs: number): TimeWindow[] {
  const horizon = nowMs + HORIZON_MS;
  const windows: TimeWindow[] = [];
  let start = floorBlockStart(nowMs, 3);
  while (start < horizon) {
    windows.push({ start, end: start + WINDOW_MS });
    start += WINDOW_MS;
  }
  return windows;
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
