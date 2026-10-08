import type { HourSample } from "./aggregate";
import { OFFSHORE_POINT } from "./geo";
import { getBytes } from "./http";
import { HOUR_MS, WINDOW_MS } from "./time";

const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast)";
const SAMPLE_MS = 3 * HOUR_MS;

type OpenMeteoHourly = {
  time: string[];
  temperature_2m?: (number | null)[];
  cloud_cover?: (number | null)[];
  precipitation?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
};

/**
 * Live ECMWF IFS 0.25° via Open-Meteo JSON (no API key).
 * Cold-start bridge while ECMWF open-data GRIB chunks fill in the background.
 */
export async function fetchOpenMeteoIfsForecast(
  nowMs: number,
  timeoutMs = 8_000,
): Promise<HourSample[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(OFFSHORE_POINT.lat));
  url.searchParams.set("longitude", String(OFFSHORE_POINT.lon));
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "cloud_cover",
      "precipitation",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
    ].join(","),
  );
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("models", "ecmwf_ifs025");
  url.searchParams.set("forecast_days", "6");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("timezone", "UTC");

  const response = await getBytes(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeoutMs,
  });
  if (response.status !== 200) {
    throw new Error(`Open-Meteo forecast HTTP ${response.status}`);
  }
  const body = JSON.parse(new TextDecoder().decode(response.body)) as {
    hourly?: OpenMeteoHourly;
    reason?: string;
  };
  if (!body.hourly?.time?.length) {
    throw new Error(body.reason ?? "Open-Meteo forecast が空です");
  }
  return parseOpenMeteoForecastHours(body.hourly, nowMs);
}

/** Keep 3-hour UTC samples with cumulative precip so buildWindows can difference steps. */
export function parseOpenMeteoForecastHours(
  hourly: OpenMeteoHourly,
  nowMs: number,
): HourSample[] {
  const horizon = nowMs + 144 * HOUR_MS;
  let precipRun = 0;
  const out: HourSample[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const validMs = Date.parse(`${hourly.time[i]}Z`);
    if (!Number.isFinite(validMs)) continue;
    const precip = hourly.precipitation?.[i];
    if (precip != null && Number.isFinite(precip) && precip > 0) {
      precipRun += precip;
    }
    // Align with ECMWF open-data / aggregate SAMPLE_MS (UTC 3h grid).
    if (validMs % SAMPLE_MS !== 0) continue;
    if (validMs < nowMs - WINDOW_MS || validMs > horizon) continue;
    const speed = hourly.wind_speed_10m?.[i];
    const fromDeg = hourly.wind_direction_10m?.[i];
    const gust = hourly.wind_gusts_10m?.[i];
    const tempC = hourly.temperature_2m?.[i];
    const cloud = hourly.cloud_cover?.[i];
    if (speed == null || !Number.isFinite(speed)) continue;
    if (fromDeg == null || !Number.isFinite(fromDeg)) continue;
    const rad = (fromDeg * Math.PI) / 180;
    const u = -speed * Math.sin(rad);
    const v = -speed * Math.cos(rad);
    const gustMs =
      gust != null && Number.isFinite(gust) ? Math.max(speed, gust) : speed + 1.5;
    out.push({
      validMs,
      tempC: tempC != null && Number.isFinite(tempC) ? tempC : 20,
      u,
      v,
      cloudPct: cloud != null && Number.isFinite(cloud) ? cloud : 50,
      precipRunMm: precipRun,
      gustMs,
    });
  }
  return out;
}
