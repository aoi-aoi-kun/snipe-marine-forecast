import { HOUR_MS } from "./time";

/**
 * Near-term windows may use more of the local correction; far windows stay closer to raw ECMWF.
 */
export function leadTimeGain(windowStartMs: number, nowMs: number): number {
  const hoursAhead = (windowStartMs - nowMs) / HOUR_MS;
  if (hoursAhead < 12) return 1;
  if (hoursAhead < 36) return 0.7;
  if (hoursAhead < 72) return 0.4;
  return 0.2;
}
