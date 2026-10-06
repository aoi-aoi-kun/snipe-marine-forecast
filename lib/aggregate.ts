import { forecastWindows, floorHour, HOUR_MS } from "./time";
import { windFromDegrees, windFromLabel } from "./wind";

export type HourSample = {
  validMs: number;
  tempC: number;
  u: number;
  v: number;
  cloudPct: number;
  precipRunMm: number;
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
  noDeparture: boolean;
};

const CALM_MS = 0.3;
const NO_DEPARTURE_MEAN_MS = 10;
const NO_DEPARTURE_MAX_MS = 13;

export function departureBlocked(meanMs: number, maxMs: number): boolean {
  return meanMs >= NO_DEPARTURE_MEAN_MS || maxMs >= NO_DEPARTURE_MAX_MS;
}

function hourlyPrecip(hours: HourSample[]): Map<number, number> {
  const byTime = new Map(hours.map((hour) => [hour.validMs, hour]));
  const amounts = new Map<number, number>();
  for (const hour of hours) {
    const previous = byTime.get(hour.validMs - HOUR_MS);
    if (!previous) continue;
    amounts.set(
      hour.validMs,
      Math.max(0, hour.precipRunMm - previous.precipRunMm),
    );
  }
  return amounts;
}

function weatherOf(precipMm: number, cloudPct: number): "晴れ" | "くもり" | "雨" {
  if (precipMm >= 1) return "雨";
  if (cloudPct >= 80) return "くもり";
  return "晴れ";
}

export function buildWindows(hours: HourSample[], nowMs: number): WindowForecast[] {
  const byTime = new Map(hours.map((hour) => [hour.validMs, hour]));
  const precip = hourlyPrecip(hours);
  const firstHour = floorHour(nowMs);

  return forecastWindows(nowMs).map(({ start, end }) => {
    const instantFrom = Math.max(start, firstHour);
    const instants: HourSample[] = [];
    for (let time = instantFrom; time < end; time += HOUR_MS) {
      const hour = byTime.get(time);
      if (hour) instants.push(hour);
    }
    const expectedInstants = Math.round((end - instantFrom) / HOUR_MS);
    const precipTimes: number[] = [];
    for (let time = instantFrom + HOUR_MS; time <= end; time += HOUR_MS) {
      precipTimes.push(time);
    }
    const precipValues = precipTimes.map((time) => precip.get(time));
    const complete =
      expectedInstants > 0 &&
      instants.length === expectedInstants &&
      precipValues.every((value) => value !== undefined);

    if (!complete) {
      return {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        partialFrom: instantFrom > start ? new Date(instantFrom).toISOString() : null,
        available: false,
        weather: null,
        precipMm: null,
        tempMinC: null,
        tempMaxC: null,
        windFromDeg: null,
        windFromLabel: null,
        windMeanMs: null,
        windMaxMs: null,
        noDeparture: false,
      };
    }

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

    return {
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
      noDeparture: departureBlocked(windMeanMs, windMaxMs),
    };
  });
}
