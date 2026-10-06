import { extractPoint } from "./grib";
import { formatCycle, HOUR_MS, WINDOW_MS, windowStarts } from "./time";
import type { HourSample } from "./aggregate";

export const POINT = { lat: 35.25, lon: 139.5, name: "七里ヶ浜沖" };
const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast)";

function filterUrl(ymd: string, hh: string, forecastHour: number): string {
  const fff = String(forecastHour).padStart(3, "0");
  const params = new URLSearchParams({
    dir: `/gfs.${ymd}/${hh}/atmos`,
    file: `gfs.t${hh}z.pgrb2.0p25.f${fff}`,
    var_TMP: "on",
    var_UGRD: "on",
    var_VGRD: "on",
    var_APCP: "on",
    var_TCDC: "on",
    lev_2_m_above_ground: "on",
    lev_10_m_above_ground: "on",
    lev_surface: "on",
    lev_entire_atmosphere: "on",
    subregion: "",
    toplat: String(POINT.lat),
    bottomlat: String(POINT.lat),
    leftlon: String(POINT.lon),
    rightlon: String(POINT.lon),
  });
  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl?${params}`;
}

async function fetchGrib(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== "GRIB") {
        throw new Error("GRIB2ではありません");
      }
      return bytes;
    } catch (error) {
      if (attempt === 2) {
        console.warn("GFS fetch failed", url, error);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function neededForecastHours(initMs: number, nowMs: number): number[] {
  const starts = windowStarts(nowMs);
  const horizonEnd = (starts.at(-1) ?? nowMs) + WINDOW_MS;
  const from = Math.max(0, Math.floor((nowMs - initMs) / HOUR_MS) - 1);
  const to = Math.min(120, Math.ceil((horizonEnd - initMs) / HOUR_MS));
  if (to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

export async function fetchCycleHours(
  initMs: number,
  hours: number[],
  already: Map<number, HourSample>,
): Promise<Map<number, HourSample>> {
  const { ymd, hh } = formatCycle(initMs);
  const missing = hours.filter((hour) => !already.has(hour));
  const downloaded = await mapPool(missing, 4, async (forecastHour) => {
    const bytes = await fetchGrib(filterUrl(ymd, hh, forecastHour));
    if (!bytes) return null;
    try {
      const sample = extractPoint(bytes, POINT.lat, POINT.lon);
      if (Math.abs(sample.forecastHour - forecastHour) > 0.2) return null;
      const hour: HourSample = {
        validMs: initMs + forecastHour * HOUR_MS,
        tempC: sample.tempK - 273.15,
        u: sample.u,
        v: sample.v,
        cloudPct: Math.min(100, Math.max(0, sample.cloudPct)),
        precipRunMm: Math.max(0, sample.precipRunMm),
      };
      return { forecastHour, hour };
    } catch (error) {
      console.warn("GFS decode failed", ymd, hh, forecastHour, error);
      return null;
    }
  });

  const merged = new Map(already);
  for (const item of downloaded) {
    if (item) merged.set(item.forecastHour, item.hour);
  }
  return merged;
}

export async function probeCycle(initMs: number): Promise<boolean> {
  const { ymd, hh } = formatCycle(initMs);
  const bytes = await fetchGrib(filterUrl(ymd, hh, 0));
  return bytes !== null;
}
