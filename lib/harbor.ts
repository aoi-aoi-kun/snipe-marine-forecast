import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";
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
  blendNowcastWithPatternMatch,
  withNowcastThresholdAlerts,
} from "./nowcast-pattern-blend";
import {
  blendCalibView,
  learnBlendCalib,
  recordBlendPending,
  summarizeBlendCalib,
} from "./nowcast-pattern-blend-calib";
import {
  applyHarborBoost,
  learnFromSamples,
  matchPattern,
  type PatternMatch,
} from "./pattern";
import {
  applyPatternForecastCalib,
  learnPatternForecastCalib,
  recordPatternForecastPending,
  summarizePatternForecastCalib,
} from "./pattern-forecast-calib";
import { estimateRampOutlook, formatRampOutlookLine } from "./ramp-outlook";
import type { HarborBundle } from "./types";

function nearestOffshoreMeanMs(
  windows: WindowForecast[],
  nowMs: number,
): number | null {
  let best: { gap: number; mean: number } | null = null;
  for (const window of windows) {
    if (window.windMeanMs == null) continue;
    const start = Date.parse(window.start);
    if (!Number.isFinite(start)) continue;
    const gap = Math.abs(start - nowMs);
    if (!best || gap < best.gap) best = { gap, mean: window.windMeanMs };
  }
  return best && best.gap <= 4 * 60 * 60_000 ? best.mean : null;
}

const CACHE_DIR = getCacheDir();
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
  const patternForecastCalib = await learnPatternForecastCalib({
    harbor: harborForLearn,
    events: patternStore.events,
    nowMs,
  });
  const patternForecastSummary = summarizePatternForecastCalib(patternForecastCalib);
  const blendCalibStore = await learnBlendCalib({
    harbor: harborForLearn,
    events: patternStore.events,
    nowMs,
  });
  const blendCalibSummary = summarizeBlendCalib(blendCalibStore);
  const blendCalib = blendCalibView(blendCalibStore);
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

  const seedNowcast = buildNowcast(resolved.samples, nowMs, calibStore);
  const pendingRaw: {
    raw: Parameters<typeof applyPatternForecastCalib>[0] | null;
    currentMeanMs: number | null;
  } = { raw: null, currentMeanMs: null };
  const offshoreNow = nearestOffshoreMeanMs(windows, nowMs);
  const matchBase: PatternMatch | null = sourceStale
    ? null
    : matchPattern(
        resolved.samples,
        patternStore,
        nowMs,
        seedNowcast.riseRateMsPerHour,
        (raw, currentMeanMs) => {
          pendingRaw.raw = raw;
          pendingRaw.currentMeanMs = currentMeanMs;
          return applyPatternForecastCalib(raw, currentMeanMs, patternForecastCalib);
        },
        offshoreNow,
      );
  const rampOutlook = matchBase
    ? estimateRampOutlook(matchBase.score, patternForecastCalib.cases)
    : null;
  const match: PatternMatch | null = matchBase
    ? {
        ...matchBase,
        calib: {
          caseCount: patternForecastSummary.caseCount,
          calibrated: patternForecastSummary.calibrated,
          note: patternForecastSummary.note,
        },
      }
    : null;
  if (match && pendingRaw.raw && pendingRaw.currentMeanMs != null && !sourceStale) {
    await recordPatternForecastPending({
      nowMs,
      currentMeanMs: pendingRaw.currentMeanMs,
      match,
      raw: pendingRaw.raw,
    });
  }

  // Rising-regime calib when a match is active (even if the 30-min slope is flat).
  const rawNowcast = buildNowcast(resolved.samples, nowMs, calibStore, {
    preferRising: Boolean(match),
  });
  // Stale enowin: keep the last observation, but do not extend a frozen series.
  const nowcast = sourceStale
    ? {
        ...rawNowcast,
        riseRateMsPerHour: null,
        nowcast: [],
        alerts: rawNowcast.alerts.filter((alert) => {
          if (alert.kind === "stale") return true;
          return alert.kind === "threshold" && !alert.message.includes("ナウキャスト");
        }),
      }
    : rawNowcast;

  const patternBlend =
    match && !sourceStale
      ? blendNowcastWithPatternMatch(
          nowcast.nowcast,
          latest.meanMs,
          {
            score: match.score,
            expectedPeakMs: match.expectedPeakMs,
            horizonMinutes: match.horizonMinutes,
          },
          blendCalib,
        )
      : {
          points: nowcast.nowcast,
          blended: false,
          note: null as string | null,
          traces: [],
        };
  if (match && patternBlend.blended && patternBlend.traces.length > 0 && !sourceStale) {
    await recordBlendPending({
      nowMs,
      currentMeanMs: latest.meanMs,
      score: match.score,
      expectedPeakMs: match.expectedPeakMs,
      matchHorizonMinutes: match.horizonMinutes,
      points: patternBlend.traces.map((trace) => ({
        minutesAhead: trace.minutesAhead,
        nowcastMeanMs: trace.nowcastMeanMs,
        analogMeanMs: trace.analogMeanMs,
        baseWeight: trace.baseWeight,
      })),
    });
  }
  const fusedNowcast = patternBlend.points;
  const fusedAlerts = patternBlend.blended
    ? withNowcastThresholdAlerts(nowcast.alerts, fusedNowcast)
    : nowcast.alerts;
  const outlookLine = rampOutlook ? formatRampOutlookLine(rampOutlook) : null;
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
      ? "5分間隔の実況です。公開が止まっている間は、短時間予測を表示しません。"
      : "5分間隔の実況です。いまから約1時間先までを、この画面で確認できます。",
    fetchedAt: new Date(resolved.fetchedAt).toISOString(),
    degraded: resolved.degraded,
    latest: toObservation(latest),
    recent: recent.map(toObservation),
    riseRateMsPerHour: nowcast.riseRateMsPerHour,
    directionChangeDeg: nowcast.directionChangeDeg,
    nowcast: fusedNowcast,
    nowcastSkill: {
      caseCount: nowcastSkill.caseCount,
      calibrated: nowcast.calibrated,
      patternBlended: patternBlend.blended,
      risingRegime: Boolean(match) || (nowcast.riseRateMsPerHour ?? 0) >= 2,
      risingHorizons: (nowcastSkill.risingHorizons ?? []).map((item) => ({
        minutesAhead: item.minutesAhead,
        count: item.count,
        maeCalibrated: item.maeCalibrated,
        maeRaw: item.maeRaw,
        dampen: item.dampen,
        skillVsPersistence: item.skillVsPersistence,
      })),
      rampOutlook: rampOutlook
        ? {
            pRiseGe25: rampOutlook.pRiseGe25,
            pPeakGe10: rampOutlook.pPeakGe10,
            support: rampOutlook.support,
            note: rampOutlook.note,
          }
        : null,
      blendCalib: {
        caseCount: blendCalibSummary.caseCount,
        calibrated: blendCalibSummary.calibrated,
        globalGain: blendCalibSummary.globalGain,
        note: blendCalibSummary.note,
        horizons: blendCalibSummary.horizons.map((item) => ({
          minutesAhead: item.minutesAhead,
          count: item.count,
          gain: item.gain,
          biasMs: item.biasMs,
          maeCalibrated: item.maeCalibrated,
          maeNowcast: item.maeNowcast,
          skillVsNowcast: item.skillVsNowcast,
        })),
      },
      note: sourceStale
        ? "実況の公開停止中のため、ナウキャストは抑制しています。"
        : [nowcastSkill.note, patternBlend.note, blendCalibSummary.note, outlookLine]
            .filter(Boolean)
            .join(" "),
      horizons: nowcastSkill.horizons.map((item) => ({
        minutesAhead: item.minutesAhead,
        count: item.count,
        maeCalibrated: item.maeCalibrated,
        maeRaw: item.maeRaw,
        dampen: item.dampen,
        skillVsPersistence: item.skillVsPersistence,
      })),
    },
    alerts: fusedAlerts,
    pattern: {
      storedEvents: patternStore.events.length,
      match: match
        ? {
            score: match.score,
            boostFactor: match.boostFactor,
            sampleAt: match.sampleAt,
            note: match.note,
            expectedRiseMs: match.expectedRiseMs,
            expectedPeakMs: match.expectedPeakMs,
            expectedMaxMs: match.expectedMaxMs,
            horizonMinutes: match.horizonMinutes,
            outlook: rampOutlook
              ? {
                  pRiseGe25: rampOutlook.pRiseGe25,
                  pPeakGe10: rampOutlook.pPeakGe10,
                  support: rampOutlook.support,
                  note: rampOutlook.note,
                }
              : null,
            calib: match.calib,
          }
        : null,
    },
    mos: {
      ...mosSummary,
      note: mosSummary.note,
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
