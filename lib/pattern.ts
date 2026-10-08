import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WindowForecast } from "./aggregate";
import type { HarborSample } from "./enowin";
import { detectRampEvents, type RampEvent } from "./nowcast";
import { jstParts } from "./time";
import { windSector8 } from "./wind";

const CACHE_DIR = path.join(process.cwd(), ".cache");
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
};

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
  await writeFile(PATTERN_CACHE, JSON.stringify(store));
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

function scoreMatch(
  current: { hourBucket: number; dirSector: number | null; beforeMeanMs: number; riseRate: number },
  event: PatternEvent,
): number {
  let score = 0;
  if (current.hourBucket === event.hourBucket) score += 0.35;
  else if (Math.abs(current.hourBucket - event.hourBucket) === 1) score += 0.15;

  if (current.dirSector !== null && event.dirSector !== null) {
    const diff = Math.min(
      Math.abs(current.dirSector - event.dirSector),
      8 - Math.abs(current.dirSector - event.dirSector),
    );
    if (diff === 0) score += 0.35;
    else if (diff === 1) score += 0.18;
  } else {
    score += 0.1;
  }

  const speedGap = Math.abs(current.beforeMeanMs - event.beforeMeanMs);
  if (speedGap <= 1.5) score += 0.2;
  else if (speedGap <= 3) score += 0.1;

  if (current.riseRate > 0 && event.riseMs / Math.max(event.riseMinutes / 60, 0.25) > 2) {
    score += 0.1;
  }
  return score;
}

export function matchPattern(
  samples: HarborSample[],
  store: PatternStore,
  nowMs: number,
  riseRateMsPerHour: number | null,
): PatternMatch | null {
  if (samples.length === 0 || store.events.length === 0) return null;
  const latest = samples[samples.length - 1];
  const recent = samples.filter((sample) => nowMs - sample.atMs <= 40 * 60 * 1000);
  const before =
    recent.length >= 2 ? recent[0].meanMs : latest.meanMs;
  const current = {
    hourBucket: hourBucket(latest.atMs),
    dirSector: latest.fromDeg === null ? null : windSector8(latest.fromDeg),
    beforeMeanMs: before,
    riseRate: riseRateMsPerHour ?? 0,
  };

  let best: { event: PatternEvent; score: number } | null = null;
  for (const event of store.events) {
    const score = scoreMatch(current, event);
    if (!best || score > best.score) best = { event, score };
  }
  if (!best || best.score < MATCH_SCORE_MIN) return null;
  if ((riseRateMsPerHour ?? 0) < 1.5 && best.event.riseMs < 3) {
    // Require some rising signal unless the historical event was strong and score is high
    if (best.score < 0.75) return null;
  }

  const parts = jstParts(best.event.atMs);
  return {
    score: best.score,
    boostFactor: best.event.boostFactor,
    sampleAt: new Date(best.event.atMs).toISOString(),
    note: `${parts.month}月${parts.day}日 ${String(parts.hour).padStart(2, "0")}時台の急上昇（+${best.event.riseMs.toFixed(1)} m/s）に似た流れです。`,
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
