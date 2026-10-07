import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWindows, type HourSample } from "./aggregate";
import {
  fetchCycleSamples,
  ifsCycleCandidates,
  neededSteps,
  POINT,
  probeCycle,
} from "./ecmwf";
import { getContinuousLearnStatus } from "./continuous-learn-state";
import { resolveHarbor } from "./harbor";
import { getBytes } from "./http";
import { parseWarnings } from "./jma";
import { HOUR_MS } from "./time";
import type { ForecastResponse } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const IFS_CACHE = path.join(CACHE_DIR, "ifs.json");
const JMA_CACHE = path.join(CACHE_DIR, "jma.json");
const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast)";
const IFS_FRESH_MS = 30 * 60 * 1000;
const JMA_FRESH_MS = 20 * 60 * 1000;

type IfsCache = {
  source: "ecmwf-ifs-0p25-10fg";
  initMs: number;
  fetchedAt: number;
  hours: HourSample[];
};

type JmaCache = {
  fetchedAt: number;
  warnings: unknown;
};

let ifsMemory: IfsCache | null = null;
let jmaMemory: JmaCache | null = null;
let pending: { key: string; promise: Promise<ForecastResponse> } | null = null;

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

function isIfsCache(value: IfsCache | null): value is IfsCache {
  return (
    value?.source === "ecmwf-ifs-0p25-10fg" &&
    Number.isFinite(value.initMs) &&
    Array.isArray(value.hours)
  );
}

async function loadIfsCache(): Promise<IfsCache | null> {
  if (ifsMemory) return ifsMemory;
  const stored = await readJson<IfsCache>(IFS_CACHE);
  ifsMemory = isIfsCache(stored) ? stored : null;
  return ifsMemory;
}

async function saveIfsCache(cache: IfsCache) {
  ifsMemory = cache;
  await writeJson(IFS_CACHE, cache);
}

async function loadJmaCache(): Promise<JmaCache | null> {
  if (jmaMemory) return jmaMemory;
  jmaMemory = await readJson<JmaCache>(JMA_CACHE);
  return jmaMemory;
}

function covers(cache: IfsCache, nowMs: number): boolean {
  const needed = neededSteps(cache.initMs, nowMs);
  if (needed.length === 0) return false;
  const have = new Map(
    cache.hours.map((hour) => [Math.round((hour.validMs - cache.initMs) / HOUR_MS), hour]),
  );
  return needed.every((step) => Number.isFinite(have.get(step)?.gustMs));
}

async function fetchJma(): Promise<JmaCache> {
  const warningRes = await getBytes("https://www.jma.go.jp/bosai/warning/data/r8/140000.json", {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeoutMs: 15_000,
  });
  if (warningRes.status !== 200) throw new Error(`警報 HTTP ${warningRes.status}`);
  const cache: JmaCache = {
    fetchedAt: Date.now(),
    warnings: JSON.parse(new TextDecoder().decode(warningRes.body)),
  };
  jmaMemory = cache;
  await writeJson(JMA_CACHE, cache);
  return cache;
}

async function resolveIfs(nowMs: number, refresh: boolean): Promise<{
  cache: IfsCache;
  degraded: boolean;
}> {
  const existing = await loadIfsCache();
  const fresh =
    existing && Date.now() - existing.fetchedAt < IFS_FRESH_MS && covers(existing, nowMs);
  if (fresh && !refresh && existing) return { cache: existing, degraded: false };

  for (const initMs of ifsCycleCandidates(nowMs)) {
    const steps = neededSteps(initMs, nowMs);
    if (steps.length === 0) continue;
    if (existing?.initMs === initMs && covers(existing, nowMs)) {
      const touched = { ...existing, fetchedAt: Date.now() };
      await saveIfsCache(touched);
      return { cache: touched, degraded: false };
    }
    const available = await probeCycle(initMs, steps);
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
    const hours = await fetchCycleSamples(initMs, steps, previous);
    const cache: IfsCache = {
      source: "ecmwf-ifs-0p25-10fg",
      initMs,
      fetchedAt: Date.now(),
      hours: [...hours.values()].sort((a, b) => a.validMs - b.validMs),
    };
    if (!covers(cache, nowMs)) {
      if (existing && covers(existing, nowMs)) return { cache: existing, degraded: true };
      await saveIfsCache(cache);
      return { cache, degraded: true };
    }
    await saveIfsCache(cache);
    return { cache, degraded: false };
  }

  if (existing) return { cache: existing, degraded: true };
  throw new Error("ECMWF の公開データを取得できませんでした");
}

async function resolveJma(refresh: boolean): Promise<{
  jma: ForecastResponse["jma"];
  error: string | null;
}> {
  try {
    const cached = await loadJmaCache();
    const useCache = cached && !refresh && Date.now() - cached.fetchedAt < JMA_FRESH_MS;
    const source = useCache && cached ? cached : await fetchJma();
    return {
      jma: {
        fetchedAt: new Date(source.fetchedAt).toISOString(),
        degraded: false,
        warnings: parseWarnings(source.warnings),
      },
      error: null,
    };
  } catch (error) {
    const cached = await loadJmaCache();
    if (cached?.warnings) {
      return {
        jma: {
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          degraded: true,
          warnings: parseWarnings(cached.warnings),
        },
        error: null,
      };
    }
    return {
      jma: null,
      error:
        error instanceof Error
          ? `気象庁の警報・注意報を取得できませんでした（${error.message}）`
          : "気象庁の警報・注意報を取得できませんでした",
    };
  }
}

export type ForecastFetchOptions = {
  refresh?: boolean;
  refreshHarbor?: boolean;
};

function normalizeForecastOptions(
  options: boolean | ForecastFetchOptions = false,
): Required<ForecastFetchOptions> {
  if (typeof options === "boolean") {
    return { refresh: options, refreshHarbor: options };
  }
  const refresh = Boolean(options.refresh);
  return {
    refresh,
    refreshHarbor: Boolean(options.refreshHarbor) || refresh,
  };
}

export function getForecast(
  options: boolean | ForecastFetchOptions = false,
): Promise<ForecastResponse> {
  const opts = normalizeForecastOptions(options);
  const key = `${opts.refresh ? 1 : 0}:${opts.refreshHarbor ? 1 : 0}`;
  if (!pending || pending.key !== key) {
    const promise = buildForecast(opts).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { key, promise };
  }
  return pending.promise;
}

async function buildForecast(options: Required<ForecastFetchOptions>): Promise<ForecastResponse> {
  const { refresh, refreshHarbor } = options;
  const nowMs = Date.now();
  const errors: string[] = [];
  const [model, warnings] = await Promise.all([
    resolveIfs(nowMs, refresh).then(
      (resolved) => ({ resolved, error: null as string | null }),
      (error: unknown) => ({
        resolved: null,
        error:
          error instanceof Error ? error.message : "ECMWF の公開データを取得できませんでした",
      }),
    ),
    resolveJma(refresh),
  ]);

  if (model.error) errors.push(model.error);
  if (warnings.error) errors.push(warnings.error);

  const ifsHours = model.resolved?.cache.hours ?? [];
  const baseWindows = model.resolved ? buildWindows(ifsHours, nowMs) : [];
  const harborResolved = await resolveHarbor(
    nowMs,
    baseWindows,
    refresh,
    ifsHours,
    refreshHarbor,
  );
  if (harborResolved.error) errors.push(harborResolved.error);

  const harbor = harborResolved.harbor
    ? {
        ...harborResolved.harbor,
        mos: {
          ...harborResolved.harbor.mos,
          continuous: getContinuousLearnStatus(),
        },
      }
    : null;

  return {
    point: POINT,
    generatedAt: new Date(nowMs).toISOString(),
    ifs: model.resolved
      ? {
          initTime: new Date(model.resolved.cache.initMs).toISOString(),
          ageHours: (nowMs - model.resolved.cache.initMs) / HOUR_MS,
          fetchedAt: new Date(model.resolved.cache.fetchedAt).toISOString(),
          degraded: model.resolved.degraded,
          windows: harborResolved.windows,
        }
      : null,
    jma: warnings.jma,
    harbor,
    errors,
  };
}
