export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const WINDOW_MS = 12 * HOUR_MS;
export const HORIZON_MS = 96 * HOUR_MS;

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

/** Start of the 00–12 or 12–24 Japan-time block that contains utcMs. */
export function floorWindowStart(utcMs: number): number {
  const parts = jstParts(utcMs);
  const hour = parts.hour < 12 ? 0 : 12;
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour) - JST_OFFSET_MS;
}

export function floorHour(utcMs: number): number {
  return Math.floor(utcMs / HOUR_MS) * HOUR_MS;
}

export function windowStarts(nowMs: number): number[] {
  const horizon = nowMs + HORIZON_MS;
  const starts: number[] = [];
  for (let start = floorWindowStart(nowMs); start < horizon; start += WINDOW_MS) {
    starts.push(start);
  }
  return starts;
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
