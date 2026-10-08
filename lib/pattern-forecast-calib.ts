import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarborSample } from "./enowin";
import {
  estimateFromMatchedEvent,
  findAnalogEvent,
  type PatternEvent,
  type PatternMatch,
} from "./pattern";
import { recencyWeights, weightedMean } from "./recency";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const STORE_PATH = path.join(CACHE_DIR, "pattern-forecast-calib.json");
const MAX_CASES = 400;
const MAX_PENDING = 40;
const MIN_CASES = 10;
const PENDING_COOLDOWN_MS = 20 * 60 * 1000;
const VERIFY_GRACE_MS = 5 * 60 * 1000;

export type PatternForecastCase = {
  atMs: number;
  horizonMinutes: number;
  currentMeanMs: number;
  score: number;
  /** Pre-calibration analog rise. */
  rawRiseMs: number;
  rawPeakMs: number;
  rawMaxMs: number;
  /** Shown (post-calibration) values at issue time. */
  expectedRiseMs: number;
  expectedPeakMs: number;
  expectedMaxMs: number;
  actualRiseMs: number | null;
  actualPeakMs: number | null;
  actualMaxMs: number | null;
  verifiedAtMs: number | null;
  source: "live" | "retrospective";
};

export type PatternForecastCalibStore = {
  updatedAt: number;
  pending: PatternForecastCase[];
  cases: PatternForecastCase[];
  riseScale: number;
  peakBiasMs: number;
  maxBiasMs: number;
  maeRise: number;
  maePeak: number;
  caseCount: number;
  calibrated: boolean;
};

export type PatternForecastCalibSummary = {
  caseCount: number;
  calibrated: boolean;
  riseScale: number;
  peakBiasMs: number;
  maxBiasMs: number;
  maeRise: number;
  maePeak: number;
  pendingCount: number;
  note: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyStore(): PatternForecastCalibStore {
  return {
    updatedAt: 0,
    pending: [],
    cases: [],
    riseScale: 1,
    peakBiasMs: 0,
    maxBiasMs: 0,
    maeRise: 0,
    maePeak: 0,
    caseCount: 0,
    calibrated: false,
  };
}

function normalizeCase(raw: Partial<PatternForecastCase>): PatternForecastCase | null {
  if (
    raw.atMs == null ||
    raw.horizonMinutes == null ||
    raw.currentMeanMs == null ||
    raw.rawRiseMs == null ||
    raw.rawPeakMs == null ||
    raw.expectedRiseMs == null ||
    raw.expectedPeakMs == null
  ) {
    return null;
  }
  return {
    atMs: raw.atMs,
    horizonMinutes: raw.horizonMinutes,
    currentMeanMs: raw.currentMeanMs,
    score: raw.score ?? 0.5,
    rawRiseMs: raw.rawRiseMs,
    rawPeakMs: raw.rawPeakMs,
    rawMaxMs: raw.rawMaxMs ?? raw.rawPeakMs,
    expectedRiseMs: raw.expectedRiseMs,
    expectedPeakMs: raw.expectedPeakMs,
    expectedMaxMs: raw.expectedMaxMs ?? raw.expectedPeakMs,
    actualRiseMs: raw.actualRiseMs ?? null,
    actualPeakMs: raw.actualPeakMs ?? null,
    actualMaxMs: raw.actualMaxMs ?? null,
    verifiedAtMs: raw.verifiedAtMs ?? null,
    source: raw.source === "retrospective" ? "retrospective" : "live",
  };
}

export async function loadPatternForecastCalib(): Promise<PatternForecastCalibStore> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as PatternForecastCalibStore;
    const cases = (raw.cases ?? [])
      .map((item) => normalizeCase(item))
      .filter((item): item is PatternForecastCase => item !== null);
    const pending = (raw.pending ?? [])
      .map((item) => normalizeCase(item))
      .filter((item): item is PatternForecastCase => item !== null);
    return {
      updatedAt: raw.updatedAt ?? 0,
      pending,
      cases,
      riseScale: Number.isFinite(raw.riseScale) ? clamp(raw.riseScale, 0.4, 1.6) : 1,
      peakBiasMs: Number.isFinite(raw.peakBiasMs) ? clamp(raw.peakBiasMs, -4, 4) : 0,
      maxBiasMs: Number.isFinite(raw.maxBiasMs) ? clamp(raw.maxBiasMs, -4, 4) : 0,
      maeRise: Number.isFinite(raw.maeRise) ? raw.maeRise : 0,
      maePeak: Number.isFinite(raw.maePeak) ? raw.maePeak : 0,
      caseCount: cases.length,
      calibrated: cases.length >= MIN_CASES,
    };
  } catch {
    return emptyStore();
  }
}

async function savePatternForecastCalib(store: PatternForecastCalibStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store));
}

/** Observed peak mean / max in [start, end]. */
export function observedRampOutcome(
  samples: HarborSample[],
  startMs: number,
  endMs: number,
  baselineMeanMs: number,
): { actualPeakMs: number; actualRiseMs: number; actualMaxMs: number } | null {
  const inWindow = samples.filter(
    (sample) => sample.atMs >= startMs && sample.atMs <= endMs,
  );
  if (inWindow.length < 2) return null;
  const actualPeakMs = Math.max(...inWindow.map((sample) => sample.meanMs));
  const actualMaxMs = Math.max(...inWindow.map((sample) => sample.maxMs));
  return {
    actualPeakMs,
    actualRiseMs: actualPeakMs - baselineMeanMs,
    actualMaxMs: Math.max(actualMaxMs, actualPeakMs),
  };
}

export function applyPatternForecastCalib(
  raw: Pick<
    PatternMatch,
    "expectedRiseMs" | "expectedPeakMs" | "expectedMaxMs" | "horizonMinutes"
  >,
  currentMeanMs: number,
  store: Pick<PatternForecastCalibStore, "riseScale" | "peakBiasMs" | "maxBiasMs" | "calibrated">,
): Pick<
  PatternMatch,
  "expectedRiseMs" | "expectedPeakMs" | "expectedMaxMs" | "horizonMinutes"
> {
  if (!store.calibrated) return raw;
  const rise = clamp(raw.expectedRiseMs * store.riseScale, 0.5, 12);
  const peak = clamp(currentMeanMs + rise + store.peakBiasMs, currentMeanMs, 25);
  const max = clamp(Math.max(peak, raw.expectedMaxMs + store.maxBiasMs), peak, 30);
  return {
    expectedRiseMs: Math.round(rise * 10) / 10,
    expectedPeakMs: Math.round(peak * 10) / 10,
    expectedMaxMs: Math.round(max * 10) / 10,
    horizonMinutes: raw.horizonMinutes,
  };
}

/** Fit riseScale / biases from verified cases (recency-weighted). */
export function fitPatternForecastCalib(
  cases: PatternForecastCase[],
  nowMs: number,
): Pick<
  PatternForecastCalibStore,
  "riseScale" | "peakBiasMs" | "maxBiasMs" | "maeRise" | "maePeak" | "calibrated" | "caseCount"
> {
  const verified = cases.filter(
    (item) =>
      item.actualRiseMs != null &&
      item.actualPeakMs != null &&
      item.rawRiseMs > 0.3,
  );
  if (verified.length < MIN_CASES) {
    return {
      riseScale: 1,
      peakBiasMs: 0,
      maxBiasMs: 0,
      maeRise: 0,
      maePeak: 0,
      calibrated: false,
      caseCount: verified.length,
    };
  }

  const weights = recencyWeights(
    verified.map((item) => item.verifiedAtMs ?? item.atMs),
    nowMs,
    21,
  );
  const ratios = verified.map((item) =>
    clamp((item.actualRiseMs as number) / item.rawRiseMs, 0.35, 1.8),
  );
  const riseScale = clamp(weightedMean(ratios, weights), 0.45, 1.55);

  const peakResiduals = verified.map((item) => {
    const projected = item.currentMeanMs + item.rawRiseMs * riseScale;
    return (item.actualPeakMs as number) - projected;
  });
  const peakBiasMs = clamp(weightedMean(peakResiduals, weights), -3, 3);

  const maxResiduals = verified.map((item) => {
    const projectedPeak = item.currentMeanMs + item.rawRiseMs * riseScale + peakBiasMs;
    const projectedMax = projectedPeak + Math.max(0.4, item.rawRiseMs * riseScale * 0.35);
    return (item.actualMaxMs ?? item.actualPeakMs ?? projectedMax) - projectedMax;
  });
  const maxBiasMs = clamp(weightedMean(maxResiduals, weights), -3, 3);

  const maeRise =
    weightedMean(
      verified.map((item) =>
        Math.abs((item.actualRiseMs as number) - item.rawRiseMs * riseScale),
      ),
      weights,
    ) ?? 0;
  const maePeak =
    weightedMean(
      verified.map((item) => {
        const projected = item.currentMeanMs + item.rawRiseMs * riseScale + peakBiasMs;
        return Math.abs((item.actualPeakMs as number) - projected);
      }),
      weights,
    ) ?? 0;

  return {
    riseScale: Math.round(riseScale * 100) / 100,
    peakBiasMs: Math.round(peakBiasMs * 100) / 100,
    maxBiasMs: Math.round(maxBiasMs * 100) / 100,
    maeRise: Math.round(maeRise * 100) / 100,
    maePeak: Math.round(maePeak * 100) / 100,
    calibrated: true,
    caseCount: verified.length,
  };
}

export function verifyPendingForecasts(
  pending: PatternForecastCase[],
  samples: HarborSample[],
  nowMs: number,
): { stillPending: PatternForecastCase[]; newlyVerified: PatternForecastCase[] } {
  const stillPending: PatternForecastCase[] = [];
  const newlyVerified: PatternForecastCase[] = [];
  for (const item of pending) {
    const endMs = item.atMs + item.horizonMinutes * 60_000;
    if (nowMs < endMs + VERIFY_GRACE_MS) {
      stillPending.push(item);
      continue;
    }
    const outcome = observedRampOutcome(samples, item.atMs, endMs, item.currentMeanMs);
    if (!outcome) {
      // Keep briefly so late samples can arrive; drop after 3h past horizon.
      if (nowMs < endMs + 3 * 60 * 60_000) stillPending.push(item);
      continue;
    }
    newlyVerified.push({
      ...item,
      actualRiseMs: Math.round(outcome.actualRiseMs * 10) / 10,
      actualPeakMs: Math.round(outcome.actualPeakMs * 10) / 10,
      actualMaxMs: Math.round(outcome.actualMaxMs * 10) / 10,
      verifiedAtMs: nowMs,
    });
  }
  return { stillPending, newlyVerified };
}

/**
 * Leave-one-out retrospective: for each stored ramp, pretend we matched another
 * event at the pre-rise state and compare the analog estimate to the real peak.
 */
export function collectRetrospectiveForecastCases(
  events: PatternEvent[],
  nowMs: number,
): PatternForecastCase[] {
  if (events.length < 2) return [];
  const out: PatternForecastCase[] = [];
  for (let index = 0; index < events.length; index++) {
    const target = events[index];
    const others = events.filter((_, i) => i !== index);
    const analog = findAnalogEvent(
      {
        hourBucket: target.hourBucket,
        dirSector: target.dirSector,
        beforeMeanMs: target.beforeMeanMs,
        riseRate: target.riseMs / Math.max(target.riseMinutes / 60, 0.25),
      },
      others,
      { requireRising: true },
    );
    if (!analog) continue;
    const raw = estimateFromMatchedEvent(target.beforeMeanMs, analog.event, analog.score, null);
    out.push({
      atMs: target.atMs,
      horizonMinutes: raw.horizonMinutes,
      currentMeanMs: target.beforeMeanMs,
      score: analog.score,
      rawRiseMs: raw.expectedRiseMs,
      rawPeakMs: raw.expectedPeakMs,
      rawMaxMs: raw.expectedMaxMs,
      expectedRiseMs: raw.expectedRiseMs,
      expectedPeakMs: raw.expectedPeakMs,
      expectedMaxMs: raw.expectedMaxMs,
      actualRiseMs: Math.round(target.riseMs * 10) / 10,
      actualPeakMs: Math.round(target.peakMeanMs * 10) / 10,
      actualMaxMs: Math.round(Math.max(target.peakMeanMs, target.peakMeanMs + 0.5) * 10) / 10,
      verifiedAtMs: nowMs,
      source: "retrospective",
    });
  }
  return out;
}

function mergeVerified(
  existing: PatternForecastCase[],
  incoming: PatternForecastCase[],
): PatternForecastCase[] {
  const byKey = new Map<string, PatternForecastCase>();
  for (const item of existing) {
    byKey.set(`${item.source}:${item.atMs}`, item);
  }
  for (const item of incoming) {
    byKey.set(`${item.source}:${item.atMs}`, item);
  }
  return [...byKey.values()]
    .sort((a, b) => (b.verifiedAtMs ?? b.atMs) - (a.verifiedAtMs ?? a.atMs))
    .slice(0, MAX_CASES);
}

export function summarizePatternForecastCalib(
  store: PatternForecastCalibStore,
): PatternForecastCalibSummary {
  const note = store.calibrated
    ? `定量目安は事後検証 ${store.caseCount} 件で校正（上昇×${store.riseScale.toFixed(2)} · ピーク誤差±${store.maePeak.toFixed(1)} m/s）。`
    : `定量目安の事後検証は ${store.caseCount}/${MIN_CASES} 件。足りると自動で校正します。`;
  return {
    caseCount: store.caseCount,
    calibrated: store.calibrated,
    riseScale: store.riseScale,
    peakBiasMs: store.peakBiasMs,
    maxBiasMs: store.maxBiasMs,
    maeRise: store.maeRise,
    maePeak: store.maePeak,
    pendingCount: store.pending.length,
    note,
  };
}

/** Verify pending live forecasts, thicken with retrospective cases, refit scales. */
export async function learnPatternForecastCalib(options: {
  harbor: HarborSample[];
  events: PatternEvent[];
  nowMs: number;
}): Promise<PatternForecastCalibStore> {
  const store = await loadPatternForecastCalib();
  const { stillPending, newlyVerified } = verifyPendingForecasts(
    store.pending,
    options.harbor,
    options.nowMs,
  );
  const retrospective = collectRetrospectiveForecastCases(options.events, options.nowMs);
  const cases = mergeVerified(store.cases, [...newlyVerified, ...retrospective]);
  const fit = fitPatternForecastCalib(cases, options.nowMs);
  const next: PatternForecastCalibStore = {
    updatedAt: Date.now(),
    pending: stillPending.slice(0, MAX_PENDING),
    cases,
    riseScale: fit.riseScale,
    peakBiasMs: fit.peakBiasMs,
    maxBiasMs: fit.maxBiasMs,
    maeRise: fit.maeRise,
    maePeak: fit.maePeak,
    caseCount: fit.caseCount,
    calibrated: fit.calibrated,
  };
  await savePatternForecastCalib(next);
  return next;
}

/** Remember a live match so we can score it after the horizon elapses. */
export async function recordPatternForecastPending(options: {
  nowMs: number;
  currentMeanMs: number;
  match: PatternMatch;
  raw: Pick<
    PatternMatch,
    "expectedRiseMs" | "expectedPeakMs" | "expectedMaxMs" | "horizonMinutes"
  >;
}): Promise<void> {
  const store = await loadPatternForecastCalib();
  const recent = store.pending.find(
    (item) => options.nowMs - item.atMs < PENDING_COOLDOWN_MS,
  );
  if (recent) return;

  const entry: PatternForecastCase = {
    atMs: options.nowMs,
    horizonMinutes: options.match.horizonMinutes,
    currentMeanMs: options.currentMeanMs,
    score: options.match.score,
    rawRiseMs: options.raw.expectedRiseMs,
    rawPeakMs: options.raw.expectedPeakMs,
    rawMaxMs: options.raw.expectedMaxMs,
    expectedRiseMs: options.match.expectedRiseMs,
    expectedPeakMs: options.match.expectedPeakMs,
    expectedMaxMs: options.match.expectedMaxMs,
    actualRiseMs: null,
    actualPeakMs: null,
    actualMaxMs: null,
    verifiedAtMs: null,
    source: "live",
  };
  const next: PatternForecastCalibStore = {
    ...store,
    updatedAt: Date.now(),
    pending: [entry, ...store.pending].slice(0, MAX_PENDING),
  };
  await savePatternForecastCalib(next);
}
