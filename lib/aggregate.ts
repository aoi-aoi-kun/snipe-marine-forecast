import { forecastWindows, HOUR_MS } from "./time";
import { windFromDegrees, windFromLabel } from "./wind";

export type HourSample = {
  validMs: number;
  tempC: number;
  u: number;
  v: number;
  cloudPct: number;
  precipRunMm: number;
  gustMs: number;
};

export type WindowForecast = {
  start: string;
  end: string;
  partialFrom: string | null;
  available: boolean;
  weather: "晴れ" | "くもり" | "雨" | null;
  precipMm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  windFromDeg: number | null;
  windFromLabel: string | null;
  windMeanMs: number | null;
  windMaxMs: number | null;
  windGustMs: number | null;
  noDeparture: boolean;
  harborAdjusted?: boolean;
  harborAdjustNote?: string | null;
  mosAdjusted?: boolean;
  mosAdjustNote?: string | null;
  /** |wind| difference vs previous ECMWF cycle at the same valid time, if available. */
  cycleSpreadMs?: number | null;
  confidence?: "high" | "mid" | "low";
  confidenceLabel?: string | null;
  confidenceScore?: number | null;
};

const CALM_MS = 0.3;
const NO_DEPARTURE_MEAN_MS = 10;
const NO_DEPARTURE_GUST_MS = 13;
const SAMPLE_MS = 3 * HOUR_MS;

function stepFloor(utcMs: number): number {
  return Math.floor(utcMs / SAMPLE_MS) * SAMPLE_MS;
}

export function departureBlocked(meanMs: number, gustMs: number): boolean {
  return meanMs >= NO_DEPARTURE_MEAN_MS || gustMs >= NO_DEPARTURE_GUST_MS;
}

function stepPrecip(hours: HourSample[]): Map<number, number> {
  const byTime = new Map(hours.map((hour) => [hour.validMs, hour]));
  const amounts = new Map<number, number>();
  for (const hour of hours) {
    const previous = byTime.get(hour.validMs - SAMPLE_MS);
    if (!previous) continue;
    amounts.set(
      hour.validMs,
      Math.max(0, hour.precipRunMm - previous.precipRunMm),
    );
  }
  return amounts;
}

function weatherOf(precipMm: number, cloudPct: number): "晴れ" | "くもり" | "雨" {
  if (precipMm >= 0.5) return "雨";
  if (precipMm >= 0.1 && cloudPct >= 90) return "雨";
  if (cloudPct >= 80) return "くもり";
  return "晴れ";
}

export function buildWindows(hours: HourSample[], nowMs: number): WindowForecast[] {
  const byTime = new Map(hours.map((hour) => [hour.validMs, hour]));
  const precip = stepPrecip(hours);
  const firstStep = stepFloor(nowMs);

  const windows: WindowForecast[] = [];
  for (const { start, end } of forecastWindows(nowMs)) {
    const instantFrom = Math.max(start, firstStep);
    const instants: HourSample[] = [];
    for (let time = instantFrom; time < end; time += SAMPLE_MS) {
      const hour = byTime.get(time);
      if (hour) instants.push(hour);
    }
    const expectedInstants = Math.round((end - instantFrom) / SAMPLE_MS);
    const precipTimes: number[] = [];
    for (let time = instantFrom + SAMPLE_MS; time <= end; time += SAMPLE_MS) {
      precipTimes.push(time);
    }
    const precipValues = precipTimes.map((time) => precip.get(time));
    const gustValues = precipTimes.map((time) => byTime.get(time)?.gustMs);
    const complete =
      expectedInstants > 0 &&
      instants.length === expectedInstants &&
      precipValues.every((value) => value !== undefined) &&
      gustValues.every((value) => value !== undefined);
    // Free-tier cold start may only have a subset of 3h steps — still show those windows.
    if (!complete && instants.length === 0) continue;

    const temps = instants.map((hour) => hour.tempC);
    const clouds = instants.map((hour) => hour.cloudPct);
    const speeds = instants.map((hour) => Math.hypot(hour.u, hour.v));
    const meanU = instants.reduce((sum, hour) => sum + hour.u, 0) / instants.length;
    const meanV = instants.reduce((sum, hour) => sum + hour.v, 0) / instants.length;
    const precipMm = precipValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const cloudPct = clouds.reduce((sum, value) => sum + value, 0) / clouds.length;
    const calm = Math.hypot(meanU, meanV) < CALM_MS;
    const from = windFromDegrees(meanU, meanV);
    const windMeanMs = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
    const windMaxMs = Math.max(...speeds);
    const windGustMs = Math.max(
      ...gustValues.map((value) => value ?? 0),
      ...instants.map((hour) => hour.gustMs),
    );

    windows.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      partialFrom: instantFrom > start ? new Date(instantFrom).toISOString() : null,
      available: true,
      weather: weatherOf(precipMm, cloudPct),
      precipMm,
      tempMinC: Math.min(...temps),
      tempMaxC: Math.max(...temps),
      windFromDeg: calm ? null : from,
      windFromLabel: calm ? "風向なし" : windFromLabel(from),
      windMeanMs,
      windMaxMs,
      windGustMs,
      noDeparture: departureBlocked(windMeanMs, windGustMs),
      cycleSpreadMs: null,
    });
  }
  return windows;
}
