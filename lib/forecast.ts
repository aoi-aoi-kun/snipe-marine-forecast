import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWindows, type HourSample } from "./aggregate";
import { fetchCycleHours, neededForecastHours, POINT, probeCycle } from "./gfs";
import { parseJmaForecast, parseWarnings } from "./jma";
import { cycleCandidates, HOUR_MS, jstDateKey, windowStarts } from "./time";
import type { ForecastResponse } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const GFS_CACHE = path.join(CACHE_DIR, "gfs.json");
const JMA_CACHE = path.join(CACHE_DIR, "jma.json");
const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast)";
const GFS_FRESH_MS = 30 * 60 * 1000;
const JMA_FRESH_MS = 20 * 60 * 1000;

type GfsCache = {
  initMs: number;
  fetchedAt: number;
  hours: HourSample[];
};

type JmaCache = {
  fetchedAt: number;
  forecast: unknown;
  warnings: unknown;
};

let gfsMemory: GfsCache | null = null;
let jmaMemory: JmaCache | null = null;
let pending: Promise<ForecastResponse> | null = null;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

async function loadGfsCache(): Promise<GfsCache | null> {
  if (gfsMemory) return gfsMemory;
  gfsMemory = await readJson<GfsCache>(GFS_CACHE);
  return gfsMemory;
}

async function saveGfsCache(cache: GfsCache) {
  gfsMemory = cache;
  await writeJson(GFS_CACHE, cache);
}

async function loadJmaCache(): Promise<JmaCache | null> {
  if (jmaMemory) return jmaMemory;
  jmaMemory = await readJson<JmaCache>(JMA_CACHE);
  return jmaMemory;
}

function covers(cache: GfsCache, nowMs: number): boolean {
  const needed = new Set(neededForecastHours(cache.initMs, nowMs));
  const have = new Set(
    cache.hours.map((hour) => Math.round((hour.validMs - cache.initMs) / HOUR_MS)),
  );
  for (const hour of needed) {
    if (!have.has(hour)) return false;
  }
  return needed.size > 0;
}

async function fetchJma(): Promise<JmaCache> {
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
  const [forecastRes, warningRes] = await Promise.all([
    fetch("https://www.jma.go.jp/bosai/forecast/data/forecast/140000.json", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetch("https://www.jma.go.jp/bosai/warning/data/r8/140000.json", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  if (!forecastRes.ok) throw new Error(`予報 HTTP ${forecastRes.status}`);
  if (!warningRes.ok) throw new Error(`警報 HTTP ${warningRes.status}`);
  const cache: JmaCache = {
    fetchedAt: Date.now(),
    forecast: await forecastRes.json(),
    warnings: await warningRes.json(),
  };
  jmaMemory = cache;
  await writeJson(JMA_CACHE, cache);
  return cache;
}

async function resolveGfs(nowMs: number, refresh: boolean): Promise<{
  cache: GfsCache;
  degraded: boolean;
}> {
  const existing = await loadGfsCache();
  const fresh =
    existing &&
    Date.now() - existing.fetchedAt < GFS_FRESH_MS &&
    covers(existing, nowMs);
  if (fresh && !refresh && existing) return { cache: existing, degraded: false };

  for (const initMs of cycleCandidates(nowMs)) {
    if (existing?.initMs === initMs && covers(existing, nowMs)) {
      const touched = { ...existing, fetchedAt: Date.now() };
      await saveGfsCache(touched);
      return { cache: touched, degraded: false };
    }
    const available = await probeCycle(initMs);
    if (!available) continue;
    const previous =
      existing?.initMs === initMs
        ? new Map(
            existing.hours.map((hour) => [
              Math.round((hour.validMs - initMs) / HOUR_MS),
              hour,
            ]),
          )
        : new Map<number, HourSample>();
    const needed = neededForecastHours(initMs, nowMs);
    const hours = await fetchCycleHours(initMs, needed, previous);
    const cache: GfsCache = {
      initMs,
      fetchedAt: Date.now(),
      hours: [...hours.values()].sort((a, b) => a.validMs - b.validMs),
    };
    if (!covers(cache, nowMs)) {
      if (existing && covers(existing, nowMs)) {
        return { cache: existing, degraded: true };
      }
      await saveGfsCache(cache);
      return { cache, degraded: true };
    }
    await saveGfsCache(cache);
    return { cache, degraded: false };
  }

  if (existing) return { cache: existing, degraded: true };
  throw new Error("NOAA GFS を取得できませんでした");
}

function datesFor(nowMs: number): string[] {
  const keys = new Set<string>();
  for (const start of windowStarts(nowMs)) {
    keys.add(jstDateKey(start));
    keys.add(jstDateKey(start + 12 * HOUR_MS - 1));
  }
  return [...keys].sort();
}

export function getForecast(refresh = false): Promise<ForecastResponse> {
  if (!pending) {
    pending = buildForecast(refresh).finally(() => {
      pending = null;
    });
  }
  return pending;
}

async function buildForecast(refresh: boolean): Promise<ForecastResponse> {
  const nowMs = Date.now();
  const errors: string[] = [];
  let gfs: ForecastResponse["gfs"] = null;
  let jma: ForecastResponse["jma"] = null;

  try {
    const resolved = await resolveGfs(nowMs, refresh);
    gfs = {
      initTime: new Date(resolved.cache.initMs).toISOString(),
      ageHours: (nowMs - resolved.cache.initMs) / HOUR_MS,
      fetchedAt: new Date(resolved.cache.fetchedAt).toISOString(),
      degraded: resolved.degraded,
      windows: buildWindows(resolved.cache.hours, nowMs),
    };
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : "NOAA GFS を取得できませんでした",
    );
  }

  const dates = datesFor(nowMs);
  try {
    const cached = await loadJmaCache();
    const useCache = cached && !refresh && Date.now() - cached.fetchedAt < JMA_FRESH_MS;
    const source = useCache && cached ? cached : await fetchJma();
    const parsed = parseJmaForecast(source.forecast, dates);
    jma = {
      office: parsed.office,
      reportDatetime: parsed.reportDatetime,
      fetchedAt: new Date(source.fetchedAt).toISOString(),
      degraded: false,
      days: parsed.days,
      warnings: parseWarnings(source.warnings),
    };
  } catch (error) {
    const cached = await loadJmaCache();
    if (cached) {
      const parsed = parseJmaForecast(cached.forecast, dates);
      jma = {
        office: parsed.office,
        reportDatetime: parsed.reportDatetime,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        degraded: true,
        days: parsed.days,
        warnings: parseWarnings(cached.warnings),
      };
    } else {
      errors.push(
        error instanceof Error
          ? `気象庁の予報を取得できませんでした（${error.message}）`
          : "気象庁の予報を取得できませんでした",
      );
    }
  }

  return {
    point: POINT,
    generatedAt: new Date(nowMs).toISOString(),
    gfs,
    jma,
    errors,
  };
}
