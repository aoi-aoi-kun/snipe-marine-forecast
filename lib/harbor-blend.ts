import { departureBlocked, type WindowForecast } from "./aggregate";
import { HOUR_MS } from "./time";

export type HarborAnchor = {
  meanMs: number;
  maxMs: number;
};

/**
 * Pull the current / next 3h offshore windows toward live harbor wind.
 * Weight decays with lead; skipped when enowin is stale.
 */
export function nearHarborBlendWeight(windowStartMs: number, nowMs: number): number {
  const leadH = (windowStartMs - nowMs) / HOUR_MS;
  if (leadH <= 0) return 0.42;
  if (leadH < 3) return 0.28;
  if (leadH < 6) return 0.12;
  return 0;
}

export function blendNearWindowsTowardHarbor(
  windows: WindowForecast[],
  harbor: HarborAnchor | null,
  nowMs: number,
  sourceStale: boolean,
): WindowForecast[] {
  if (!harbor || sourceStale || !Number.isFinite(harbor.meanMs)) return windows;
  const gustAnchor = Math.max(harbor.maxMs, harbor.meanMs);

  return windows.map((window) => {
    if (!window.available || window.windMeanMs === null) return window;
    const start = Date.parse(window.start);
    const w = nearHarborBlendWeight(start, nowMs);
    if (w <= 0) return window;

    const mean = (1 - w) * window.windMeanMs + w * harbor.meanMs;
    const gust =
      window.windGustMs === null
        ? null
        : (1 - w) * window.windGustMs + w * gustAnchor;
    const max =
      window.windMaxMs === null ? null : (1 - w) * window.windMaxMs + w * gustAnchor;
    const note = `実況寄り: ハーバーいま ${harbor.meanMs.toFixed(1)} m/s を ${(w * 100).toFixed(0)}% 混ぜた。`;
    const prev = window.mosAdjustNote ?? window.harborAdjustNote;
    return {
      ...window,
      windMeanMs: mean,
      windGustMs: gust,
      windMaxMs: max,
      noDeparture: departureBlocked(mean, gust ?? 0),
      mosAdjusted: window.mosAdjusted || true,
      mosAdjustNote: prev ? `${prev} ${note}` : note,
    };
  });
}
