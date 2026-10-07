import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HourSample, WindowForecast } from "./aggregate";
import {
  ENOWIN_SOURCE,
  fetchHarborSamples,
  type HarborSample,
} from "./enowin";
import { learnMos } from "./mos-learn";
import { applyMosCorrection, summarizeMos } from "./mos";
import { buildNowcast } from "./nowcast";
import {
  applyHarborBoost,
  learnFromSamples,
  matchPattern,
  type PatternMatch,
} from "./pattern";
import type { HarborBundle } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const HARBOR_CACHE = path.join(CACHE_DIR, "harbor.json");
const FRESH_MS = 3 * 60 * 1000;

type HarborCache = {
  fetchedAt: number;
  samples: HarborSample[];
};

let memory: HarborCache | null = null;

async function loadCache(): Promise<HarborCache | null> {
  if (memory) return memory;
  try {
    memory = JSON.parse(await readFile(HARBOR_CACHE, "utf8")) as HarborCache;
    return memory;
  } catch {
    return null;
  }
}

async function saveCache(cache: HarborCache) {
  memory = cache;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(HARBOR_CACHE, JSON.stringify(cache));
}

async function resolveSamples(nowMs: number, refresh: boolean): Promise<{
  samples: HarborSample[];
  fetchedAt: number;
  degraded: boolean;
  error: string | null;
}> {
  const cached = await loadCache();
  const fresh = cached && nowMs - cached.fetchedAt < FRESH_MS;
  if (fresh && !refresh && cached) {
    return {
      samples: cached.samples,
      fetchedAt: cached.fetchedAt,
      degraded: false,
      error: null,
    };
  }

  try {
    const samples = await fetchHarborSamples(nowMs, 5);
    if (samples.length === 0) throw new Error("実況行がありません");
    const next = { fetchedAt: Date.now(), samples };
    await saveCache(next);
    return {
      samples,
      fetchedAt: next.fetchedAt,
      degraded: false,
      error: null,
    };
  } catch (error) {
    if (cached?.samples?.length) {
      return {
        samples: cached.samples,
        fetchedAt: cached.fetchedAt,
        degraded: true,
        error: null,
      };
    }
    return {
      samples: [],
      fetchedAt: nowMs,
      degraded: true,
      error:
        error instanceof Error
          ? `江ノ島ハーバー実況を取得できませんでした（${error.message}）`
          : "江ノ島ハーバー実況を取得できませんでした",
    };
  }
}

function toObservation(sample: HarborSample) {
  return {
    at: new Date(sample.atMs).toISOString(),
    meanMs: sample.meanMs,
    maxMs: sample.maxMs,
    fromLabel: sample.fromLabel,
    fromDeg: sample.fromDeg,
  };
}

export async function resolveHarbor(
  nowMs: number,
  windows: WindowForecast[],
  refresh: boolean,
  ifsHours: HourSample[] = [],
): Promise<{
  harbor: HarborBundle | null;
  windows: WindowForecast[];
  error: string | null;
}> {
  const resolved = await resolveSamples(nowMs, refresh);
  if (resolved.samples.length === 0) {
    return { harbor: null, windows, error: resolved.error };
  }

  const nowcast = buildNowcast(resolved.samples, nowMs);
  const mosStore = await learnMos({
    nowMs,
    harbor: resolved.samples,
    ifsHours,
    refresh,
  });
  const mosSummary = summarizeMos(mosStore);
  const patternStore = await learnFromSamples(resolved.samples, windows);
  const match: PatternMatch | null = matchPattern(
    resolved.samples,
    patternStore,
    nowMs,
    nowcast.riseRateMsPerHour,
  );
  let adjusted = applyMosCorrection(windows, mosStore);
  adjusted = applyHarborBoost(adjusted, match);

  const latest = resolved.samples[resolved.samples.length - 1];
  const recent = resolved.samples.filter((sample) => nowMs - sample.atMs <= 2 * 60 * 60 * 1000);

  const harbor: HarborBundle = {
    source: ENOWIN_SOURCE,
    pointName: "江の島ヨットハーバー",
    note: "岸の5分実況です。沖の3時間予報とは地点が異なります。",
    fetchedAt: new Date(resolved.fetchedAt).toISOString(),
    degraded: resolved.degraded,
    latest: toObservation(latest),
    recent: recent.map(toObservation),
    riseRateMsPerHour: nowcast.riseRateMsPerHour,
    directionChangeDeg: nowcast.directionChangeDeg,
    nowcast: nowcast.nowcast,
    alerts: nowcast.alerts,
    pattern: {
      storedEvents: patternStore.events.length,
      match: match
        ? {
            score: match.score,
            boostFactor: match.boostFactor,
            sampleAt: match.sampleAt,
            note: match.note,
          }
        : null,
    },
    mos: {
      ...mosSummary,
      continuous: {
        started: false,
        intervalMinutes: 15,
        lastTickAt: null,
        lastTickError: null,
      },
    },
  };

  return { harbor, windows: adjusted, error: resolved.error };
}
