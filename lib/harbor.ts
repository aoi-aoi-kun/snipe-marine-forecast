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
import { attachConfidence } from "./confidence";
import { blendNearWindowsTowardHarbor } from "./harbor-blend";
import { leadTimeGain } from "./lead-gain";
import { captureLearningProgress } from "./learning-progress";
import {
  lambdaForMosWindow,
  learnMetaCalibration,
  summarizeMetaCalib,
} from "./meta-calib";
import { buildNowcast } from "./nowcast";
import {
  learnNowcastCalibration,
  loadNowcastCalib,
  needsDeepNowcastLearn,
  summarizeNowcastCalib,
} from "./nowcast-learn";
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
    // Page polls use a short lookback; full refresh may pull a week.
    const samples = await fetchHarborSamples(nowMs, refresh ? 7 : 2);
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
          ? `江の島ヨットハーバー実況を取得できませんでした（${error.message}）`
          : "江の島ヨットハーバー実況を取得できませんでした",
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
  refreshHarbor = refresh,
  options: { ifsDegraded?: boolean } = {},
): Promise<{
  harbor: HarborBundle | null;
  windows: WindowForecast[];
  error: string | null;
}> {
  const resolved = await resolveSamples(nowMs, refresh || refreshHarbor);
  if (resolved.samples.length === 0) {
    return { harbor: null, windows, error: resolved.error };
  }

  let calibStore = await loadNowcastCalib();
  // Always absorb the latest harbor window into the rolling verification set.
  calibStore = await learnNowcastCalibration(resolved.samples);
  let learningHarbor = resolved.samples;
  // Deep 30-day relearn only on explicit full refresh (too heavy for free-tier page polls).
  if (refresh && needsDeepNowcastLearn(calibStore, nowMs)) {
    const deepHarbor = await fetchHarborSamples(nowMs, 30);
    if (deepHarbor.length > resolved.samples.length) learningHarbor = deepHarbor;
    calibStore = await learnNowcastCalibration(learningHarbor, { deep: true });
  }
  const nowcastSkill = summarizeNowcastCalib(calibStore);
  const latest = resolved.samples[resolved.samples.length - 1];
  const lagMinutes = Math.floor((nowMs - latest.atMs) / 60_000);
  const sourceStale = lagMinutes >= 20;
  const rawNowcast = buildNowcast(resolved.samples, nowMs, calibStore);
  // Stale enowin: keep the last observation, but do not extend a frozen series.
  const nowcast = sourceStale
    ? {
        ...rawNowcast,
        riseRateMsPerHour: null,
        nowcast: [],
        alerts: rawNowcast.alerts.filter((alert) => {
          if (alert.kind === "stale") return true;
          // Keep harbor-threshold warnings; drop nowcast projections built on frozen data.
          return alert.kind === "threshold" && !alert.message.includes("ナウキャスト");
        }),
      }
    : rawNowcast;

  const harborForLearn =
    learningHarbor.length >= resolved.samples.length ? learningHarbor : resolved.samples;
  // Full refresh deepens MOS archives; harbor-only page polls stay light on free tier.
  const mosStore = await learnMos({
    nowMs,
    harbor: harborForLearn,
    ifsHours,
    refresh,
  });
  const mosSummary = summarizeMos(mosStore);
  const patternStore = await learnFromSamples(learningHarbor, windows);
  const metaStore = await learnMetaCalibration({
    harbor: harborForLearn,
    windows,
    mosStore,
    nowMs,
  });
  const metaSummary = summarizeMetaCalib(metaStore);
  const mae15 =
    nowcastSkill.horizons.find((item) => item.minutesAhead === 15)?.maeCalibrated ??
    null;
  const learning = await captureLearningProgress({
    nowMs,
    nowcastCases: nowcastSkill.caseCount,
    nowcastMae15: mae15,
    mos: mosSummary,
    meta: metaSummary,
    patternEvents: patternStore.events.length,
  });
  const match: PatternMatch | null = sourceStale
    ? null
    : matchPattern(
        resolved.samples,
        patternStore,
        nowMs,
        nowcast.riseRateMsPerHour,
      );
  const mosOnly = applyMosCorrection(windows, mosStore, (window, correction) => {
    const scenario = lambdaForMosWindow(metaStore, window, correction);
    return scenario * leadTimeGain(Date.parse(window.start), nowMs);
  });
  const boosted =
    match && !sourceStale
      ? applyHarborBoost(mosOnly, match, metaStore.patternLambda)
      : mosOnly;
  // Pattern boost is for the next hours; far windows stay on MOS-only / raw ECMWF.
  const limited = boosted.map((window, index) => {
    if (!window.harborAdjusted) return window;
    if (leadTimeGain(Date.parse(window.start), nowMs) >= 0.7) return window;
    return {
      ...mosOnly[index],
      harborAdjusted: false,
      harborAdjustNote: null,
    };
  });
  const blendSamples = resolved.samples.filter(
    (sample) => nowMs - sample.atMs <= 45 * 60_000,
  );
  const blendAnchor =
    blendSamples.length > 0
      ? {
          meanMs:
            blendSamples.reduce((sum, sample) => sum + sample.meanMs, 0) /
            blendSamples.length,
          maxMs: Math.max(...blendSamples.map((sample) => sample.maxMs)),
        }
      : { meanMs: latest.meanMs, maxMs: latest.maxMs };
  const blended = blendNearWindowsTowardHarbor(
    limited,
    blendAnchor,
    nowMs,
    sourceStale,
  );
  const adjusted = attachConfidence(blended, nowMs, {
    ifsDegraded: options.ifsDegraded,
  });

  const recent = resolved.samples.filter((sample) => nowMs - sample.atMs <= 2 * 60 * 60 * 1000);

  const harbor: HarborBundle = {
    source: ENOWIN_SOURCE,
    pointName: "江の島ヨットハーバー",
    note: sourceStale
      ? "5分ごとの実況です。公開が止まっているため短時間予測は出していません。"
      : "5分ごとの実況です。沖の予報とは地点が異なります。いま〜1時間はここ、近い3時間枠は実況も混ぜ、それより先は沖予報を参照。",
    fetchedAt: new Date(resolved.fetchedAt).toISOString(),
    degraded: resolved.degraded,
    latest: toObservation(latest),
    recent: recent.map(toObservation),
    riseRateMsPerHour: nowcast.riseRateMsPerHour,
    directionChangeDeg: nowcast.directionChangeDeg,
    nowcast: nowcast.nowcast,
    nowcastSkill: {
      caseCount: nowcastSkill.caseCount,
      calibrated: nowcast.calibrated,
      note: sourceStale
        ? "実況の公開停止中のため、ナウキャストは抑制しています。"
        : nowcastSkill.note,
      horizons: nowcastSkill.horizons.map((item) => ({
        minutesAhead: item.minutesAhead,
        count: item.count,
        maeCalibrated: item.maeCalibrated,
        maeRaw: item.maeRaw,
        dampen: item.dampen,
        skillVsPersistence: item.skillVsPersistence,
      })),
    },
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
      note: `${mosSummary.note} ${metaSummary.note}`,
      meta: metaSummary,
      continuous: {
        started: false,
        intervalMinutes: 15,
        lastTickAt: null,
        lastTickError: null,
      },
    },
    learning,
  };

  return { harbor, windows: adjusted, error: resolved.error };
}
