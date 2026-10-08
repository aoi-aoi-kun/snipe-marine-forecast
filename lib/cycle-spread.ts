import type { HourSample, WindowForecast } from "./aggregate";

/** Attach |current − previous cycle| wind speed at the window's main sample time. */
export function attachCycleSpread(
  windows: WindowForecast[],
  currentHours: HourSample[],
  previousHours: HourSample[] | null,
): WindowForecast[] {
  if (!previousHours || previousHours.length === 0) {
    return windows.map((window) => ({ ...window, cycleSpreadMs: null }));
  }
  const prevByValid = new Map(
    previousHours.map((hour) => [hour.validMs, Math.hypot(hour.u, hour.v)]),
  );
  const curByValid = new Map(
    currentHours.map((hour) => [hour.validMs, Math.hypot(hour.u, hour.v)]),
  );

  return windows.map((window) => {
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    let best: number | null = null;
    for (const [validMs, speed] of curByValid) {
      if (validMs < start || validMs >= end) continue;
      const prev = prevByValid.get(validMs);
      if (prev === undefined) continue;
      const spread = Math.abs(speed - prev);
      if (best === null || spread > best) best = spread;
    }
    return { ...window, cycleSpreadMs: best };
  });
}
