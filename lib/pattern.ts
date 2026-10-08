import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";
import type { WindowForecast } from "./aggregate";
import type { HarborSample } from "./enowin";
import { detectRampEvents, type RampEvent } from "./nowcast";
import { jstParts } from "./time";
import { windSector8 } from "./wind";

const CACHE_DIR = getCacheDir();
const PATTERN_CACHE = path.join(CACHE_DIR, "harbor-patterns.json");
const MAX_EVENTS = 200;
const MATCH_SCORE_MIN = 0.5;

export type PatternEvent = {
  atMs: number;
  hourBucket: number;
  dirSector: number | null;
  beforeMeanMs: number;
  peakMeanMs: number;
  riseMs: number;
  riseMinutes: number;
  offshoreMeanMs: number | null;
  boostFactor: number;
};

export type PatternStore = {
  updatedAt: number;
  events: PatternEvent[];
};

export type PatternMatch = {
  score: number;
  boostFactor: number;
  sampleAt: string;
  note: string;
  /** Analog estimate: expected mean-wind rise (m/s) over the horizon. */
  expectedRiseMs: number;
  /** Analog estimate: expected peak mean wind (m/s). */
  expectedPeakMs: number;
  /** Analog estimate: rough instantaneous max (m/s). */
  expectedMaxMs: number;
  /** Minutes over which the historical rise typically unfolded. */
  horizonMinutes: number;
  /** Post-match verification status for the quantitative estimate. */
  calib?: {
    caseCount: number;
    calibrated: boolean;
    note: string;
  };
};

/** Map a matched historical ramp onto the current harbor mean (pre-calibration). */
export function estimateFromMatchedEvent(
  currentMeanMs: number,
  event: PatternEvent,
  score: number,
  _calib: null = null,
): Pick<
  PatternMatch,
  "expectedRiseMs" | "expectedPeakMs" | "expectedMaxMs" | "horizonMinutes"
> {
  void _calib;
  const confidence = clamp(score, 0.5, 1);
  // Weaker matches → milder rise (still based on the analog event).
  const riseScale = 0.55 + 0.45 * confidence;
  const expectedRiseMs = clamp(event.riseMs * riseScale, 0.8, 12);
  const expectedPeakMs = clamp(currentMeanMs + expectedRiseMs, currentMeanMs, 25);
  const historicalGustGap = Math.max(0.4, expectedRiseMs * 0.35);
  const expectedMaxMs = clamp(expectedPeakMs + historicalGustGap, expectedPeakMs, 30);
  const horizonMinutes = Math.round(
    clamp(event.riseMinutes || 30, 15, 90),
  );
  return {
    expectedRiseMs: Math.round(expectedRiseMs * 10) / 10,
    expectedPeakMs: Math.round(expectedPeakMs * 10) / 10,
    expectedMaxMs: Math.round(expectedMaxMs * 10) / 10,
    horizonMinutes,
  };
}

export type AnalogQuery = {
  hourBucket: number;
  dirSector: number | null;
  beforeMeanMs: number;
  riseRate: number;
  /** Nearest offshore IFS mean (m/s), when available. */
  offshoreMeanMs?: number | null;
};

/** Best historical ramp analog for a pre-rise harbor state. */
export function findAnalogEvent(
  current: AnalogQuery,
  events: PatternEvent[],
  options: { requireRising?: boolean } = {},
): { event: PatternEvent; score: number } | null {
  if (events.length === 0) return null;
  let best: { event: PatternEvent; score: number } | null = null;
  for (const event of events) {
    const score = scoreMatch(current, event);
    if (!best || score > best.score) best = { event, score };
  }
  if (!best || best.score < MATCH_SCORE_MIN) return null;
  if (options.requireRising !== false) {
    if (current.riseRate < 1.5 && best.event.riseMs < 3 && best.score < 0.75) {
      return null;
    }
  }
  return best;
}

function hourBucket(atMs: number): number {
  return Math.floor(jstParts(atMs).hour / 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function offshoreAt(
  windows: WindowForecast[],
  atMs: number,
): number | null {
  for (const window of windows) {
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    if (atMs >= start && atMs < end && window.windMeanMs !== null) {
      return window.windMeanMs;
    }
  }
  return null;
}

function boostFrom(event: RampEvent, offshoreMeanMs: number | null): number {
  if (offshoreMeanMs !== null && offshoreMeanMs > 0.5) {
    return clamp(event.peakMeanMs / offshoreMeanMs, 1.05, 1.7);
  }
  return clamp(1 + event.riseMs / 8, 1.08, 1.5);
}

export function toPatternEvent(
  event: RampEvent,
  windows: WindowForecast[],
): PatternEvent {
  const offshoreMeanMs = offshoreAt(windows, event.atMs);
  return {
    atMs: event.atMs,
    hourBucket: hourBucket(event.atMs),
    dirSector: event.fromDeg === null ? null : windSector8(event.fromDeg),
    beforeMeanMs: event.beforeMeanMs,
    peakMeanMs: event.peakMeanMs,
    riseMs: event.riseMs,
    riseMinutes: event.riseMinutes,
    offshoreMeanMs,
    boostFactor: boostFrom(event, offshoreMeanMs),
  };
}

export async function loadPatternStore(): Promise<PatternStore> {
  try {
    const raw = JSON.parse(await readFile(PATTERN_CACHE, "utf8")) as PatternStore;
    if (!Array.isArray(raw.events)) return { updatedAt: 0, events: [] };
    return raw;
  } catch {
    return { updatedAt: 0, events: [] };
  }
}

export async function savePatternStore(store: PatternStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const { writeProtectedJson } = await import("./learning-persist");
  await writeProtectedJson(PATTERN_CACHE, JSON.stringify(store), {
    label: "harbor-patterns.json",
  });
}

export function mergePatternEvents(
  existing: PatternEvent[],
  incoming: PatternEvent[],
): PatternEvent[] {
  const byTime = new Map<number, PatternEvent>();
  for (const event of existing) byTime.set(event.atMs, event);
  for (const event of incoming) {
    const previous = byTime.get(event.atMs);
    if (!previous) {
      byTime.set(event.atMs, event);
      continue;
    }
    byTime.set(event.atMs, {
      ...previous,
      ...event,
      offshoreMeanMs: event.offshoreMeanMs ?? previous.offshoreMeanMs,
      boostFactor:
        event.offshoreMeanMs !== null ? event.boostFactor : previous.boostFactor,
    });
  }
  return [...byTime.values()]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, MAX_EVENTS);
}

export async function learnFromSamples(
  samples: HarborSample[],
  windows: WindowForecast[],
): Promise<PatternStore> {
  const store = await loadPatternStore();
  const detected = detectRampEvents(samples).map((event) => toPatternEvent(event, windows));
  const events = mergePatternEvents(store.events, detected);
  const next = { updatedAt: Date.now(), events };
  await savePatternStore(next);
  return next;
}

function scoreMatch(current: AnalogQuery, event: PatternEvent): number {
  let score = 0;
  if (current.hourBucket === event.hourBucket) score += 0.32;
  else if (Math.abs(current.hourBucket - event.hourBucket) === 1) score += 0.14;

  if (current.dirSector !== null && event.dirSector !== null) {
    const diff = Math.min(
      Math.abs(current.dirSector - event.dirSector),
      8 - Math.abs(current.dirSector - event.dirSector),
    );
    if (diff === 0) score += 0.32;
    else if (diff === 1) score += 0.16;
  } else {
    score += 0.1;
  }

  const speedGap = Math.abs(current.beforeMeanMs - event.beforeMeanMs);
  if (speedGap <= 1.5) score += 0.18;
  else if (speedGap <= 3) score += 0.09;

  if (current.riseRate > 0 && event.riseMs / Math.max(event.riseMinutes / 60, 0.25) > 2) {
    score += 0.08;
  }

  const offshore = current.offshoreMeanMs;
  if (
    offshore != null &&
    Number.isFinite(offshore) &&
    event.offshoreMeanMs != null &&
    Number.isFinite(event.offshoreMeanMs)
  ) {
    const gap = Math.abs(offshore - event.offshoreMeanMs);
    if (gap <= 1.5) score += 0.12;
    else if (gap <= 3) score += 0.06;
  }

  return score;
}

export function matchPattern(
  samples: HarborSample[],
  store: PatternStore,
  nowMs: number,
  riseRateMsPerHour: number | null,
  calibrate?: (
    raw: Pick<
      PatternMatch,
      "expectedRiseMs" | "expectedPeakMs" | "expectedMaxMs" | "horizonMinutes"
    >,
    currentMeanMs: number,
  ) => Pick<
    PatternMatch,
    "expectedRiseMs" | "expectedPeakMs" | "expectedMaxMs" | "horizonMinutes"
  >,
  offshoreMeanMs: number | null = null,
): PatternMatch | null {
  if (samples.length === 0 || store.events.length === 0) return null;
  const latest = samples[samples.length - 1];
  const recent = samples.filter((sample) => nowMs - sample.atMs <= 40 * 60 * 1000);
  const before =
    recent.length >= 2 ? recent[0].meanMs : latest.meanMs;
  const current: AnalogQuery = {
    hourBucket: hourBucket(latest.atMs),
    dirSector: latest.fromDeg === null ? null : windSector8(latest.fromDeg),
    beforeMeanMs: before,
    riseRate: riseRateMsPerHour ?? 0,
    offshoreMeanMs,
  };

  const best = findAnalogEvent(current, store.events);
  if (!best) return null;

  const parts = jstParts(best.event.atMs);
  const raw = estimateFromMatchedEvent(latest.meanMs, best.event, best.score);
  const estimate = calibrate ? calibrate(raw, latest.meanMs) : raw;
  return {
    score: best.score,
    boostFactor: best.event.boostFactor,
    sampleAt: new Date(best.event.atMs).toISOString(),
    note: `${parts.month}月${parts.day}日 ${String(parts.hour).padStart(2, "0")}時台の急上昇（実績 +${best.event.riseMs.toFixed(1)} m/s / ${best.event.riseMinutes}分）に似た流れです。`,
    ...estimate,
  };
}

export function applyHarborBoost(
  windows: WindowForecast[],
  match: PatternMatch | null,
  lambda = 1,
): WindowForecast[] {
  if (!match) {
    return windows.map((window) => ({
      ...window,
      harborAdjusted: false,
      harborAdjustNote: null,
    }));
  }

  const gain = clamp(lambda, 0, 1);
  const factor = 1 + gain * (match.boostFactor - 1);
  if (Math.abs(factor - 1) < 0.02) {
    return windows.map((window) => ({
      ...window,
      harborAdjusted: false,
      harborAdjustNote: null,
    }));
  }

  let applied = 0;
  return windows.map((window) => {
    if (!window.available || window.windMeanMs === null || applied >= 2) {
      return { ...window, harborAdjusted: false, harborAdjustNote: null };
    }
    applied += 1;
    const mean = window.windMeanMs * factor;
    const gust =
      window.windGustMs === null ? null : window.windGustMs * factor;
    const noDeparture = mean >= 10 || (gust !== null && gust >= 13);
    const mosNote = window.mosAdjustNote;
    const boostNote =
      gain < 0.999
        ? `${match.note} 補正の補正 λ=${gain.toFixed(2)} → ×${factor.toFixed(2)}。`
        : match.note;
    return {
      ...window,
      windMeanMs: mean,
      windMaxMs: window.windMaxMs === null ? null : window.windMaxMs * factor,
      windGustMs: gust,
      noDeparture,
      harborAdjusted: true,
      harborAdjustNote: mosNote ? `${boostNote} ${mosNote}` : boostNote,
    };
  });
}
