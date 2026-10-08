import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWindows, type HourSample } from "./aggregate";
import { attachCycleSpread } from "./cycle-spread";
import {
  fetchCycleSamples,
  ifsCycleCandidates,
  nearNeededSteps,
  neededSteps,
  POINT,
  probeCycle,
} from "./ecmwf";
import { getContinuousLearnStatus } from "./continuous-learn-state";
import { resolveHarbor } from "./harbor";
import { getBytes } from "./http";
import { parseWarnings } from "./jma";
import { getLearnStatus } from "./learn-status";
import { fetchOpenMeteoIfsForecast } from "./open-meteo-forecast";
import { HOUR_MS } from "./time";
import type { ForecastResponse } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const IFS_CACHE = path.join(CACHE_DIR, "ifs.json");
const IFS_PREV_CACHE = path.join(CACHE_DIR, "ifs-prev.json");
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
let ifsPrevMemory: IfsCache | null = null;
let jmaMemory: JmaCache | null = null;
let pending: {
  key: string;
  promise: Promise<ForecastResponse>;
  startedAt: number;
} | null = null;
const PENDING_MAX_MS = 15_000;
/** Stay under Render free's ~30s request limit (including harbor). */
const BUILD_BUDGET_MS = 8_000;

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

async function loadIfsPrevCache(): Promise<IfsCache | null> {
  if (ifsPrevMemory) return ifsPrevMemory;
  const stored = await readJson<IfsCache>(IFS_PREV_CACHE);
  ifsPrevMemory = isIfsCache(stored) ? stored : null;
  return ifsPrevMemory;
}

async function saveIfsPrevCache(cache: IfsCache) {
  ifsPrevMemory = cache;
  await writeJson(IFS_PREV_CACHE, cache);
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

let ifsFillPromise: Promise<void> | null = null;
/** Free-tier: keep first paint short; extend later in small chunks. */
const IFS_NEAR_HOURS = Number(process.env.IFS_NEAR_HOURS || 36) || 36;
const IFS_FILL_CHUNK = 2;
const IFS_FILL_PAUSE_MS = 750;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hoursToMap(initMs: number, hours: HourSample[]): Map<number, HourSample> {
  return new Map(
    hours.map((hour) => [Math.round((hour.validMs - initMs) / HOUR_MS), hour]),
  );
}

async function saveHours(initMs: number, hours: Map<number, HourSample>) {
  const cache: IfsCache = {
    source: "ecmwf-ifs-0p25-10fg",
    initMs,
    fetchedAt: Date.now(),
    hours: [...hours.values()].sort((a, b) => a.validMs - b.validMs),
  };
  await saveIfsCache(cache);
  return cache;
}

async function resolveOpenMeteoBridge(nowMs: number): Promise<IfsCache> {
  const hours = await fetchOpenMeteoIfsForecast(nowMs, 7_000);
  if (hours.length < 3) {
    throw new Error("Open-Meteo ECMWF の応答が不足しています");
  }
  const initMs = ifsCycleCandidates(nowMs)[0] ?? Math.floor(nowMs / (12 * HOUR_MS)) * 12 * HOUR_MS;
  const cache: IfsCache = {
    source: "ecmwf-ifs-0p25-10fg",
    initMs,
    fetchedAt: Date.now(),
    hours,
  };
  await saveIfsCache(cache);
  console.info(`Open-Meteo IFS bridge: ${hours.length} hours`);
  return cache;
}

/** Download IFS off the request thread; save near-term chunks first for fast page paint. */
function startIfsFill(nowMs: number) {
  if (ifsFillPromise) return ifsFillPromise;
  ifsFillPromise = (async () => {
    try {
      for (const initMs of ifsCycleCandidates(nowMs)) {
        const near = nearNeededSteps(initMs, nowMs, IFS_NEAR_HOURS);
        if (near.length === 0) continue;
        const available = await probeCycle(initMs, near);
        if (!available) continue;

        const existing = await loadIfsCache();
        if (existing && existing.initMs !== initMs) await saveIfsPrevCache(existing);
        let map =
          existing?.initMs === initMs
            ? hoursToMap(initMs, existing.hours)
            : new Map<number, HourSample>();

        // Tiny chunks + pause: Render free (512MB) OOMs if many grib_ls run together.
        for (let i = 0; i < near.length; i += IFS_FILL_CHUNK) {
          const chunk = near.slice(i, i + IFS_FILL_CHUNK);
          map = await fetchCycleSamples(initMs, chunk, map);
          await saveHours(initMs, map);
          console.info(
            `IFS near chunk saved: ${map.size} hours (init ${new Date(initMs).toISOString()})`,
          );
          await sleep(IFS_FILL_PAUSE_MS);
        }

        const rest = neededSteps(initMs, nowMs).filter((step) => !map.has(step));
        for (let i = 0; i < rest.length; i += IFS_FILL_CHUNK) {
          const chunk = rest.slice(i, i + IFS_FILL_CHUNK);
          map = await fetchCycleSamples(initMs, chunk, map);
          await saveHours(initMs, map);
          await sleep(IFS_FILL_PAUSE_MS);
        }
        const done = await saveHours(initMs, map);
        console.info(
          `IFS fill done: ${done.hours.length} hours covers=${covers(done, nowMs)}`,
        );
        return;
      }
      console.warn("IFS fill: no open-data cycle available");
    } catch (error) {
      console.warn("IFS fill failed", error);
    } finally {
      ifsFillPromise = null;
    }
  })();
  return ifsFillPromise;
}

async function resolveIfs(nowMs: number, refresh: boolean): Promise<{
  cache: IfsCache;
  degraded: boolean;
}> {
  const existing = await loadIfsCache();
  const fresh =
    existing && Date.now() - existing.fetchedAt < IFS_FRESH_MS && covers(existing, nowMs);
  if (fresh && !refresh && existing) return { cache: existing, degraded: false };

  // Never block the request on GRIB downloads (Render ~30s + free-tier OOM).
  startIfsFill(nowMs);

  if (existing && existing.hours.length >= 3) {
    return { cache: existing, degraded: !covers(existing, nowMs) };
  }

  try {
    const bridge = await resolveOpenMeteoBridge(nowMs);
    return { cache: bridge, degraded: true };
  } catch (error) {
    if (existing && existing.hours.length > 0) {
      return { cache: existing, degraded: true };
    }
    throw error instanceof Error
      ? error
      : new Error("ECMWF の公開データを取得しています。自動で再読み込みします。");
  }
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

async function forecastFromCaches(
  nowMs: number,
  errors: string[],
): Promise<ForecastResponse> {
  // Prefer already-cached bytes; if empty, still try Open-Meteo before giving up.
  startIfsFill(nowMs);
  let ifs = await loadIfsCache();
  if (!ifs || ifs.hours.length === 0) {
    try {
      ifs = await resolveOpenMeteoBridge(nowMs);
    } catch {
      ifs = null;
    }
  }
  const jmaCache = await loadJmaCache();
  const ifsHours = ifs?.hours ?? [];
  const prevIfs = await loadIfsPrevCache();
  const baseWindows = ifs
    ? attachCycleSpread(buildWindows(ifsHours, nowMs), ifsHours, prevIfs?.hours ?? null)
    : [];
  if (!ifs) {
    errors.push("ECMWF の公開データを取得しています。自動で再読み込みします。");
  } else if (!covers(ifs, nowMs)) {
    errors.push("暫定表示です。ECMWF 公開データをバックグラウンドで補完しています。");
  }
  return {
    point: POINT,
    generatedAt: new Date(nowMs).toISOString(),
    ifs: ifs
      ? {
          initTime: new Date(ifs.initMs).toISOString(),
          ageHours: (nowMs - ifs.initMs) / HOUR_MS,
          fetchedAt: new Date(ifs.fetchedAt).toISOString(),
          degraded: true,
          windows: baseWindows,
        }
      : null,
    jma: jmaCache?.warnings
      ? {
          fetchedAt: new Date(jmaCache.fetchedAt).toISOString(),
          degraded: true,
          warnings: parseWarnings(jmaCache.warnings),
        }
      : null,
    harbor: null,
    errors,
  };
}

async function resolveIfsCacheOnly(nowMs: number): Promise<{
  cache: IfsCache;
  degraded: boolean;
}> {
  startIfsFill(nowMs);
  const existing = await loadIfsCache();
  if (existing && existing.hours.length > 0) {
    return { cache: existing, degraded: !covers(existing, nowMs) };
  }
  // Cold start: Open-Meteo JSON is seconds, open-data GRIB is minutes.
  const bridge = await resolveOpenMeteoBridge(nowMs);
  return { cache: bridge, degraded: true };
}

export function getForecast(
  options: boolean | ForecastFetchOptions = false,
): Promise<ForecastResponse> {
  const opts = normalizeForecastOptions(options);
  // Page / harbor polls must not wait on ECMWF downloads (Render ~30s limit).
  if (!opts.refresh) {
    const key = opts.refreshHarbor ? "page" : "cache";
    if (pending && pending.key === key && Date.now() - pending.startedAt < PENDING_MAX_MS) {
      return pending.promise;
    }
    const startedAt = Date.now();
    const promise = Promise.race([
      buildForecast({ ...opts, refresh: false }),
      sleep(BUILD_BUDGET_MS).then(() =>
        forecastFromCaches(Date.now(), [
          "ECMWF の公開データを取得しています。自動で再読み込みします。",
        ]),
      ),
    ]).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { key, promise, startedAt };
    return promise;
  }

  const key = "full";
  if (pending && pending.key === key && Date.now() - pending.startedAt < PENDING_MAX_MS) {
    return pending.promise;
  }
  const startedAt = Date.now();
  const promise = buildForecast(opts).finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { key, promise, startedAt };
  return promise;
}

async function buildForecast(options: Required<ForecastFetchOptions>): Promise<ForecastResponse> {
  const { refresh, refreshHarbor } = options;
  const nowMs = Date.now();
  const errors: string[] = [];
  const ifsResolver = refresh ? resolveIfs(nowMs, true) : resolveIfsCacheOnly(nowMs);
  const [model, warnings] = await Promise.all([
    ifsResolver.then(
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
  const prevIfs = await loadIfsPrevCache();
  const baseWindows = model.resolved
    ? attachCycleSpread(buildWindows(ifsHours, nowMs), ifsHours, prevIfs?.hours ?? null)
    : [];
  const harborResolved = await resolveHarbor(
    nowMs,
    baseWindows,
    refresh,
    ifsHours,
    refreshHarbor,
    { ifsDegraded: Boolean(model.resolved?.degraded) },
  );
  if (harborResolved.error) errors.push(harborResolved.error);

  // Keep the page path light: learn-status is nice-to-have, not required for forecast paint.
  let learnOps: NonNullable<ForecastResponse["harbor"]>["learnOps"];
  try {
    const learnStatus = await Promise.race([
      getLearnStatus(),
      sleep(2_000).then(() => null),
    ]);
    if (learnStatus) {
      learnOps = {
        tip: learnStatus.tip,
        cacheWritable: learnStatus.cache.writable,
        ticking: learnStatus.continuous.ticking,
        mosPairs: learnStatus.mos.pairCount,
        nowcastCases: learnStatus.nowcast.caseCount,
        patternEvents: learnStatus.pattern.storedEvents,
        metaMosReady: learnStatus.meta.mosReady,
        metaPatternReady: learnStatus.meta.patternReady,
        learningDays: learnStatus.ops.learningDays,
        warmCount: learnStatus.ops.warmCount,
      };
    }
  } catch {
    learnOps = undefined;
  }
  const harbor = harborResolved.harbor
    ? {
        ...harborResolved.harbor,
        mos: {
          ...harborResolved.harbor.mos,
          continuous: getContinuousLearnStatus(),
        },
        learnOps,
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
