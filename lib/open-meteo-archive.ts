import type { HourSample } from "./aggregate";
import { OFFSHORE_POINT } from "./geo";
import { getBytes } from "./http";
import { HOUR_MS, WINDOW_MS } from "./time";

const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast)";
const PAST_DAYS = 31;

type OpenMeteoHourly = {
  time: string[];
  wind_speed_10m: (number | null)[];
  wind_gusts_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
};

/**
 * ECMWF IFS 0.25° historical forecasts via Open-Meteo (no API key).
 * Used to thicken MOS when ECMWF open-data retention is only a few days.
 */
export async function fetchOpenMeteoArchiveHours(
  nowMs: number,
  pastDays = PAST_DAYS,
): Promise<HourSample[]> {
  const url = new URL("https://historical-forecast-api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(OFFSHORE_POINT.lat));
  url.searchParams.set("longitude", String(OFFSHORE_POINT.lon));
  url.searchParams.set(
    "hourly",
    "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
  );
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("models", "ecmwf_ifs025");
  url.searchParams.set("past_days", String(Math.max(1, Math.min(92, pastDays))));
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "UTC");

  const response = await getBytes(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeoutMs: 45_000,
  });
  if (response.status !== 200) {
    throw new Error(`Open-Meteo archive HTTP ${response.status}`);
  }
  const body = JSON.parse(new TextDecoder().decode(response.body)) as {
    hourly?: OpenMeteoHourly;
    reason?: string;
  };
  if (!body.hourly?.time?.length) {
    throw new Error(body.reason ?? "Open-Meteo archive が空です");
  }
  return parseOpenMeteoHours(body.hourly, nowMs);
}

/** Keep 3-hour valid times that align with MOS window starts. */
export function parseOpenMeteoHours(
  hourly: OpenMeteoHourly,
  nowMs: number,
): HourSample[] {
  const out: HourSample[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const validMs = Date.parse(`${hourly.time[i]}Z`);
    if (!Number.isFinite(validMs) || validMs > nowMs) continue;
    // MOS pairs on 3-hour block starts (UTC epochs that match JST 0/3/… via WINDOW_MS grid).
    if (validMs % WINDOW_MS !== 0) continue;
    const speed = hourly.wind_speed_10m[i];
    const fromDeg = hourly.wind_direction_10m[i];
    const gust = hourly.wind_gusts_10m[i];
    if (speed == null || !Number.isFinite(speed) || speed < 0.15) continue;
    if (fromDeg == null || !Number.isFinite(fromDeg)) continue;
    const rad = (fromDeg * Math.PI) / 180;
    // Meteorological "from" → u/v (toward).
    const u = -speed * Math.sin(rad);
    const v = -speed * Math.cos(rad);
    const gustMs =
      gust != null && Number.isFinite(gust) ? Math.max(speed, gust) : speed + 1.5;
    out.push({
      validMs,
      tempC: 20,
      u,
      v,
      cloudPct: 50,
      precipRunMm: 0,
      gustMs,
    });
  }
  return out.sort((a, b) => a.validMs - b.validMs);
}

export function openMeteoArchiveSpanHours(hours: HourSample[]): number {
  if (hours.length < 2) return 0;
  return (hours[hours.length - 1].validMs - hours[0].validMs) / HOUR_MS;
}
