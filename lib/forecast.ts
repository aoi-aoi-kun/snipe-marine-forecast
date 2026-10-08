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
const IFS_WAIT_MS = 35_000;
const IFS_NEAR_HOURS = 24;

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
          existing?.initMs === initMs ? hoursToMap(initMs, existing.hours) : new Map<number, HourSample>();

        // Save every few steps so waiting requests can return mid-download.
        for (let i = 0; i < near.length; i += 3) {
          const chunk = near.slice(i, i + 3);
          map = await fetchCycleSamples(initMs, chunk, map);
          await saveHours(initMs, map);
          console.info(`IFS near chunk saved: ${map.size} hours (init ${new Date(initMs).toISOString()})`);
        }

        const rest = neededSteps(initMs, nowMs);
        map = await fetchCycleSamples(initMs, rest, map);
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

  // Any usable cache: return now, refresh in background.
  if (existing && existing.hours.length >= 3 && !refresh) {
    startIfsFill(nowMs);
    return { cache: existing, degraded: !covers(existing, nowMs) };
  }

  startIfsFill(nowMs);

  const deadline = Date.now() + IFS_WAIT_MS;
  while (Date.now() < deadline) {
    const current = await loadIfsCache();
    if (current && current.hours.length >= 3) {
      return { cache: current, degraded: !covers(current, nowMs) };
    }
    await sleep(1_500);
  }

  const late = await loadIfsCache();
  if (late && late.hours.length > 0) {
    return { cache: late, degraded: true };
  }
  if (existing && existing.hours.length > 0) {
    return { cache: existing, degraded: true };
  }
  throw new Error(
    "ECMWF の公開データを取得しています。20〜40秒後に再読み込みしてください。",
  );
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

  const learnStatus = await getLearnStatus();
  const harbor = harborResolved.harbor
    ? {
        ...harborResolved.harbor,
        mos: {
          ...harborResolved.harbor.mos,
          continuous: getContinuousLearnStatus(),
        },
        learnOps: {
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
