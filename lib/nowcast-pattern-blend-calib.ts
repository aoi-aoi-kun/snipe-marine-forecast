import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";
import type { HarborSample } from "./enowin";
import {
  HORIZONS,
  estimateTrendAt,
  sampleNear,
  type NowcastHorizon,
} from "./nowcast";
import {
  analogMeanAt,
  calibratedBlendMean,
  patternBlendWeight,
  type BlendCalibView,
} from "./nowcast-pattern-blend";
import {
  estimateFromMatchedEvent,
  findAnalogEvent,
  type PatternEvent,
} from "./pattern";
import { recencyWeights, weightedMae, weightedMean } from "./recency";
import { jstParts } from "./time";
import { windSector8 } from "./wind";

export type { BlendCalibView };

const CACHE_DIR = getCacheDir();
const STORE_PATH = path.join(CACHE_DIR, "nowcast-pattern-blend-calib.json");
const MAX_CASES = 600;
const MAX_PENDING = 48;
const MIN_CASES = 12;
const PENDING_COOLDOWN_MS = 15 * 60 * 1000;
const VERIFY_GRACE_MS = 4 * 60 * 1000;
const ACTUAL_TOLERANCE_MS = 4 * 60 * 1000;

export type BlendCalibCase = {
  atMs: number;
  minutesAhead: NowcastHorizon;
  currentMeanMs: number;
  nowcastMeanMs: number;
  analogMeanMs: number;
  baseWeight: number;
  score: number;
  expectedPeakMs: number;
  matchHorizonMinutes: number;
  actualMeanMs: number | null;
  verifiedAtMs: number | null;
  source: "live" | "retrospective";
};

export type BlendHorizonCalib = {
  minutesAhead: NowcastHorizon;
  count: number;
  gain: number;
  biasMs: number;
  maeNowcast: number;
  maeNaiveBlend: number;
  maeCalibrated: number;
  skillVsNowcast: number;
};

export type BlendCalibStore = {
  updatedAt: number;
  pending: BlendCalibCase[];
  cases: BlendCalibCase[];
  horizons: BlendHorizonCalib[];
  globalGain: number;
  caseCount: number;
  calibrated: boolean;
};

export type BlendCalibSummary = {
  caseCount: number;
  calibrated: boolean;
  globalGain: number;
  pendingCount: number;
  horizons: BlendHorizonCalib[];
  note: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyStore(): BlendCalibStore {
  return {
    updatedAt: 0,
    pending: [],
    cases: [],
    horizons: [],
    globalGain: 1,
    caseCount: 0,
    calibrated: false,
  };
}

function normalizeCase(raw: Partial<BlendCalibCase>): BlendCalibCase | null {
  if (
    raw.atMs == null ||
    raw.minutesAhead == null ||
    raw.currentMeanMs == null ||
    raw.nowcastMeanMs == null ||
    raw.analogMeanMs == null ||
    raw.baseWeight == null ||
    raw.expectedPeakMs == null ||
    raw.matchHorizonMinutes == null
  ) {
    return null;
  }
  const minutesAhead = raw.minutesAhead as number;
  if (minutesAhead !== 15 && minutesAhead !== 30 && minutesAhead !== 60) {
    return null;
  }
  return {
    atMs: raw.atMs,
    minutesAhead,
    currentMeanMs: raw.currentMeanMs,
    nowcastMeanMs: raw.nowcastMeanMs,
    analogMeanMs: raw.analogMeanMs,
    baseWeight: raw.baseWeight,
    score: raw.score ?? 0.5,
    expectedPeakMs: raw.expectedPeakMs,
    matchHorizonMinutes: raw.matchHorizonMinutes,
    actualMeanMs: raw.actualMeanMs ?? null,
    verifiedAtMs: raw.verifiedAtMs ?? null,
    source: raw.source === "retrospective" ? "retrospective" : "live",
  };
}

function normalizeHorizon(raw: Partial<BlendHorizonCalib>): BlendHorizonCalib | null {
  if (raw.minutesAhead == null || raw.count == null || raw.gain == null) return null;
  const minutesAhead = raw.minutesAhead as number;
  if (minutesAhead !== 15 && minutesAhead !== 30 && minutesAhead !== 60) {
    return null;
  }
  return {
    minutesAhead,
    count: raw.count,
    gain: clamp(raw.gain, 0.15, 1.6),
    biasMs: Number.isFinite(raw.biasMs) ? clamp(raw.biasMs as number, -3, 3) : 0,
    maeNowcast: Number.isFinite(raw.maeNowcast) ? (raw.maeNowcast as number) : 0,
    maeNaiveBlend: Number.isFinite(raw.maeNaiveBlend) ? (raw.maeNaiveBlend as number) : 0,
    maeCalibrated: Number.isFinite(raw.maeCalibrated) ? (raw.maeCalibrated as number) : 0,
    skillVsNowcast: Number.isFinite(raw.skillVsNowcast)
      ? (raw.skillVsNowcast as number)
      : 0,
  };
}

export async function loadBlendCalib(): Promise<BlendCalibStore> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as BlendCalibStore;
    const cases = (raw.cases ?? [])
      .map((item) => normalizeCase(item))
      .filter((item): item is BlendCalibCase => item !== null);
    const pending = (raw.pending ?? [])
      .map((item) => normalizeCase(item))
      .filter((item): item is BlendCalibCase => item !== null);
    let horizons = (raw.horizons ?? [])
      .map((item) => normalizeHorizon(item))
      .filter((item): item is BlendHorizonCalib => item !== null);
    if (horizons.length === 0 && cases.length >= MIN_CASES) {
      const fit = fitBlendCalib(cases, Date.now());
      horizons = fit.horizons;
      return {
        updatedAt: raw.updatedAt ?? 0,
        pending,
        cases,
        horizons,
        globalGain: fit.globalGain,
        caseCount: fit.caseCount,
        calibrated: fit.calibrated,
      };
    }
    return {
      updatedAt: raw.updatedAt ?? 0,
      pending,
      cases,
      horizons,
      globalGain: Number.isFinite(raw.globalGain)
        ? clamp(raw.globalGain, 0.2, 1.5)
        : 1,
      caseCount: cases.filter((item) => item.actualMeanMs != null).length,
      calibrated: cases.filter((item) => item.actualMeanMs != null).length >= MIN_CASES,
    };
  } catch {
    return emptyStore();
  }
}

async function saveBlendCalib(store: BlendCalibStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const { writeProtectedJson } = await import("./learning-persist");
  await writeProtectedJson(STORE_PATH, JSON.stringify(store), {
    label: "nowcast-pattern-blend-calib.json",
  });
}

export function blendCalibView(store: BlendCalibStore): BlendCalibView {
  return {
    calibrated: store.calibrated,
    globalGain: store.globalGain,
    horizons: store.horizons.map((item) => ({
      minutesAhead: item.minutesAhead,
      gain: item.gain,
      biasMs: item.biasMs,
    })),
  };
}

function idealGainForCase(item: BlendCalibCase): number | null {
  if (item.actualMeanMs == null || item.baseWeight < 0.05) return null;
  const denom = item.analogMeanMs - item.nowcastMeanMs;
  if (Math.abs(denom) < 0.2) return null;
  const targetW = clamp((item.actualMeanMs - item.nowcastMeanMs) / denom, 0, 0.9);
  return clamp(targetW / item.baseWeight, 0.15, 1.8);
}

function projectWithGain(item: BlendCalibCase, gain: number, biasMs: number): number {
  const weight = clamp(item.baseWeight * gain, 0, 0.85);
  return calibratedBlendMean(item.nowcastMeanMs, item.analogMeanMs, weight, biasMs);
}

export function fitBlendHorizon(
  cases: BlendCalibCase[],
  minutesAhead: NowcastHorizon,
  nowMs: number,
): BlendHorizonCalib | null {
  const subset = cases.filter(
    (item) =>
      item.minutesAhead === minutesAhead &&
      item.actualMeanMs != null &&
      item.baseWeight >= 0.05,
  );
  if (subset.length < Math.max(4, Math.floor(MIN_CASES / 3))) return null;

  const weights = recencyWeights(
    subset.map((item) => item.verifiedAtMs ?? item.atMs),
    nowMs,
    21,
  );
  const idealGains = subset.map((item) => idealGainForCase(item));
  const gainSamples: number[] = [];
  const gainWeights: number[] = [];
  for (let index = 0; index < subset.length; index++) {
    const gain = idealGains[index];
    if (gain == null) continue;
    gainSamples.push(gain);
    gainWeights.push(weights[index]);
  }
  const gain =
    gainSamples.length >= 3
      ? clamp(weightedMean(gainSamples, gainWeights), 0.25, 1.45)
      : 1;

  const residuals = subset.map((item) => {
    const projected = projectWithGain(item, gain, 0);
    return (item.actualMeanMs as number) - projected;
  });
  const biasMs = clamp(weightedMean(residuals, weights), -2.5, 2.5);

  const maeNowcast = weightedMae(
    subset.map((item) => (item.actualMeanMs as number) - item.nowcastMeanMs),
    weights,
  );
  const maeNaiveBlend = weightedMae(
    subset.map((item) => (item.actualMeanMs as number) - projectWithGain(item, 1, 0)),
    weights,
  );
  const maeCalibrated = weightedMae(
    subset.map((item) => (item.actualMeanMs as number) - projectWithGain(item, gain, biasMs)),
    weights,
  );
  const skillVsNowcast =
    maeNowcast > 0.05 ? clamp(1 - maeCalibrated / maeNowcast, -1, 1) : 0;

  return {
    minutesAhead,
    count: subset.length,
    gain: Math.round(gain * 100) / 100,
    biasMs: Math.round(biasMs * 100) / 100,
    maeNowcast: Math.round(maeNowcast * 100) / 100,
    maeNaiveBlend: Math.round(maeNaiveBlend * 100) / 100,
    maeCalibrated: Math.round(maeCalibrated * 100) / 100,
    skillVsNowcast: Math.round(skillVsNowcast * 100) / 100,
  };
}

export function fitBlendCalib(
  cases: BlendCalibCase[],
  nowMs: number,
): Pick<BlendCalibStore, "horizons" | "globalGain" | "caseCount" | "calibrated"> {
  const verified = cases.filter((item) => item.actualMeanMs != null);
  if (verified.length < MIN_CASES) {
    return {
      horizons: [],
      globalGain: 1,
      caseCount: verified.length,
      calibrated: false,
    };
  }

  const horizons = HORIZONS.map((minutes) => fitBlendHorizon(verified, minutes, nowMs)).filter(
    (item): item is BlendHorizonCalib => item !== null,
  );

  const weights = recencyWeights(
    verified.map((item) => item.verifiedAtMs ?? item.atMs),
    nowMs,
    21,
  );
  const idealGains = verified.map((item) => idealGainForCase(item));
  const gainSamples: number[] = [];
  const gainWeights: number[] = [];
  for (let index = 0; index < verified.length; index++) {
    const gain = idealGains[index];
    if (gain == null) continue;
    gainSamples.push(gain);
    gainWeights.push(weights[index]);
  }
  const globalGain =
    gainSamples.length >= MIN_CASES
      ? Math.round(clamp(weightedMean(gainSamples, gainWeights), 0.35, 1.35) * 100) / 100
      : 1;

  return {
    horizons,
    globalGain,
    caseCount: verified.length,
    calibrated: horizons.length > 0,
  };
}

export function verifyPendingBlendCases(
  pending: BlendCalibCase[],
  samples: HarborSample[],
  nowMs: number,
): { stillPending: BlendCalibCase[]; newlyVerified: BlendCalibCase[] } {
  const stillPending: BlendCalibCase[] = [];
  const newlyVerified: BlendCalibCase[] = [];
  for (const item of pending) {
    const targetMs = item.atMs + item.minutesAhead * 60_000;
    if (nowMs < targetMs + VERIFY_GRACE_MS) {
      stillPending.push(item);
      continue;
    }
    const actual = sampleNear(samples, targetMs, ACTUAL_TOLERANCE_MS);
    if (!actual) {
      if (nowMs < targetMs + 3 * 60 * 60_000) stillPending.push(item);
      continue;
    }
    newlyVerified.push({
      ...item,
      actualMeanMs: Math.round(actual.meanMs * 10) / 10,
      verifiedAtMs: nowMs,
    });
  }
  return { stillPending, newlyVerified };
}

function mergeVerified(
  existing: BlendCalibCase[],
  incoming: BlendCalibCase[],
): BlendCalibCase[] {
  const byKey = new Map<string, BlendCalibCase>();
  for (const item of existing) {
    byKey.set(`${item.source}:${item.atMs}:${item.minutesAhead}`, item);
  }
  for (const item of incoming) {
    byKey.set(`${item.source}:${item.atMs}:${item.minutesAhead}`, item);
  }
  return [...byKey.values()]
    .sort((a, b) => (b.verifiedAtMs ?? b.atMs) - (a.verifiedAtMs ?? a.atMs))
    .slice(0, MAX_CASES);
}

/**
 * Leave-one-out: at each stored ramp, rebuild a trend nowcast, blend with the
 * analog peak path, and score against the real harbor sample at +15/30/60.
 */
export function collectRetrospectiveBlendCases(
  samples: HarborSample[],
  events: PatternEvent[],
  nowMs: number,
): BlendCalibCase[] {
  if (events.length < 2 || samples.length < 30) return [];
  const out: BlendCalibCase[] = [];

  for (let index = 0; index < events.length; index++) {
    const target = events[index];
    const issueMs = target.atMs;
    const trend = estimateTrendAt(samples, issueMs);
    if (!trend) continue;

    const others = events.filter((_, i) => i !== index);
    const hourBucket = Math.floor(jstParts(issueMs).hour / 3);
    const near = sampleNear(samples, issueMs, 8 * 60_000);
    const dirSector =
      near?.fromDeg == null ? null : windSector8(near.fromDeg);
    const analog = findAnalogEvent(
      {
        hourBucket,
        dirSector,
        beforeMeanMs: target.beforeMeanMs,
        riseRate: target.riseMs / Math.max(target.riseMinutes / 60, 0.25),
      },
      others,
      { requireRising: true },
    );
    if (!analog) continue;

    const estimate = estimateFromMatchedEvent(
      trend.currentMs,
      analog.event,
      analog.score,
      null,
    );
    if (!(estimate.expectedPeakMs > trend.currentMs + 0.15)) continue;

    for (const minutesAhead of HORIZONS) {
      const actual = sampleNear(samples, issueMs + minutesAhead * 60_000, ACTUAL_TOLERANCE_MS);
      if (!actual) continue;
      const nowcastMeanMs =
        Math.round((trend.currentMs + (trend.riseRateMsPerHour * minutesAhead) / 60) * 10) /
        10;
      const analogMeanMs = analogMeanAt(
        trend.currentMs,
        estimate.expectedPeakMs,
        estimate.horizonMinutes,
        minutesAhead,
      );
      const baseWeight = patternBlendWeight(
        minutesAhead,
        estimate.horizonMinutes,
        analog.score,
      );
      if (baseWeight < 0.05) continue;
      out.push({
        atMs: issueMs,
        minutesAhead,
        currentMeanMs: trend.currentMs,
        nowcastMeanMs,
        analogMeanMs: Math.round(analogMeanMs * 10) / 10,
        baseWeight: Math.round(baseWeight * 1000) / 1000,
        score: analog.score,
        expectedPeakMs: estimate.expectedPeakMs,
        matchHorizonMinutes: estimate.horizonMinutes,
        actualMeanMs: Math.round(actual.meanMs * 10) / 10,
        verifiedAtMs: nowMs,
        source: "retrospective",
      });
    }
  }
  return out.slice(0, 240);
}

export function summarizeBlendCalib(store: BlendCalibStore): BlendCalibSummary {
  const best = store.horizons
    .slice()
    .sort((a, b) => b.skillVsNowcast - a.skillVsNowcast)[0];
  const note = store.calibrated
    ? `融合は事後検証 ${store.caseCount} 件で校正（重み×${store.globalGain.toFixed(2)}` +
      (best
        ? ` · ${best.minutesAhead}分先の融合MAE ±${best.maeCalibrated.toFixed(2)} m/s`
        : "") +
      `）。`
    : `融合の事後検証は ${store.caseCount}/${MIN_CASES} 件。足りると重みとバイアスを自動校正します。`;
  return {
    caseCount: store.caseCount,
    calibrated: store.calibrated,
    globalGain: store.globalGain,
    pendingCount: store.pending.length,
    horizons: store.horizons,
    note,
  };
}

export async function learnBlendCalib(options: {
  harbor: HarborSample[];
  events: PatternEvent[];
  nowMs: number;
}): Promise<BlendCalibStore> {
  const store = await loadBlendCalib();
  const { stillPending, newlyVerified } = verifyPendingBlendCases(
    store.pending,
    options.harbor,
    options.nowMs,
  );
  const retrospective = collectRetrospectiveBlendCases(
    options.harbor,
    options.events,
    options.nowMs,
  );
  const cases = mergeVerified(store.cases, [...newlyVerified, ...retrospective]);
  const fit = fitBlendCalib(cases, options.nowMs);
  const next: BlendCalibStore = {
    updatedAt: Date.now(),
    pending: stillPending.slice(0, MAX_PENDING),
    cases,
    horizons: fit.horizons,
    globalGain: fit.globalGain,
    caseCount: fit.caseCount,
    calibrated: fit.calibrated,
  };
  await saveBlendCalib(next);
  return next;
}

/** Remember a live fusion so each horizon can be scored after it elapses. */
export async function recordBlendPending(options: {
  nowMs: number;
  currentMeanMs: number;
  score: number;
  expectedPeakMs: number;
  matchHorizonMinutes: number;
  points: {
    minutesAhead: NowcastHorizon;
    nowcastMeanMs: number;
    analogMeanMs: number;
    baseWeight: number;
  }[];
}): Promise<void> {
  if (options.points.length === 0) return;
  const store = await loadBlendCalib();
  const recent = store.pending.find(
    (item) => options.nowMs - item.atMs < PENDING_COOLDOWN_MS,
  );
  if (recent) return;

  const entries: BlendCalibCase[] = options.points.map((point) => ({
    atMs: options.nowMs,
    minutesAhead: point.minutesAhead,
    currentMeanMs: options.currentMeanMs,
    nowcastMeanMs: point.nowcastMeanMs,
    analogMeanMs: point.analogMeanMs,
    baseWeight: point.baseWeight,
    score: options.score,
    expectedPeakMs: options.expectedPeakMs,
    matchHorizonMinutes: options.matchHorizonMinutes,
    actualMeanMs: null,
    verifiedAtMs: null,
    source: "live",
  }));

  const next: BlendCalibStore = {
    ...store,
    updatedAt: Date.now(),
    pending: [...entries, ...store.pending].slice(0, MAX_PENDING),
  };
  await saveBlendCalib(next);
}
