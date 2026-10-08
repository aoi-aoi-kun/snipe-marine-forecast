import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WindowForecast } from "./aggregate";
import type { HarborSample } from "./enowin";
import { correctionForWindow, type MosCorrection, type MosStore } from "./mos";
import { detectRampEvents } from "./nowcast";
import { loadPatternStore } from "./pattern";
import { WINDOW_MS, jstParts } from "./time";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const STORE_PATH = path.join(CACHE_DIR, "meta-calib.json");
const MAX_CASES = 600;
const MIN_CASES = 12;
const MIN_BIN_CASES = 8;
const DEFAULT_LAMBDA = 1;

export type SpeedBand = "light" | "mod" | "strong";

export type MetaCase = {
  atMs: number;
  baseMs: number;
  rawFactor: number;
  actualMs: number;
  hourBucket: number;
  speedBand: SpeedBand;
};

export type MetaLambdaBin = {
  key: string;
  hourBucket: number | null;
  speedBand: SpeedBand | null;
  lambda: number;
  count: number;
  mae: number;
};

export type MetaCalibStore = {
  updatedAt: number;
  mosCases: MetaCase[];
  patternCases: MetaCase[];
  mosLambda: number;
  patternLambda: number;
  mosMae: number;
  patternMae: number;
  mosBins: MetaLambdaBin[];
};

export type MetaCalibSummary = {
  mosLambda: number;
  patternLambda: number;
  mosCases: number;
  patternCases: number;
  mosReady: boolean;
  patternReady: boolean;
  mosBins: number;
  note: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mae(errors: number[]): number {
  if (errors.length === 0) return 0;
  return errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
}

export function speedBandOf(ms: number): SpeedBand {
  if (ms < 4) return "light";
  if (ms < 8) return "mod";
  return "strong";
}

export function hourBucketOf(atMs: number): number {
  return Math.floor(jstParts(atMs).hour / 3);
}

export function emptyMetaCalib(): MetaCalibStore {
  return {
    updatedAt: 0,
    mosCases: [],
    patternCases: [],
    mosLambda: DEFAULT_LAMBDA,
    patternLambda: DEFAULT_LAMBDA,
    mosMae: 0,
    patternMae: 0,
    mosBins: [],
  };
}

/** Dampen a multiplicative correction: f' = 1 + λ(f − 1). */
export function dampenFactor(rawFactor: number, lambda: number): number {
  if (!Number.isFinite(rawFactor) || rawFactor <= 0) return 1;
  const gain = clamp(lambda, 0, 1);
  return 1 + gain * (rawFactor - 1);
}

export function fitLambda(
  cases: MetaCase[],
  minCases = MIN_CASES,
): { lambda: number; mae: number } {
  if (cases.length < minCases) {
    return { lambda: DEFAULT_LAMBDA, mae: 0 };
  }
  let bestLambda = DEFAULT_LAMBDA;
  let bestMae = Infinity;
  for (let step = 0; step <= 20; step++) {
    const lambda = step * 0.05;
    const errors = cases.map((item) => {
      const factor = dampenFactor(item.rawFactor, lambda);
      return item.actualMs - item.baseMs * factor;
    });
    const score = mae(errors);
    if (score < bestMae) {
      bestMae = score;
      bestLambda = lambda;
    }
  }
  return { lambda: bestLambda, mae: bestMae };
}

function normalizeCase(raw: Partial<MetaCase>): MetaCase | null {
  if (
    raw.atMs == null ||
    raw.baseMs == null ||
    raw.rawFactor == null ||
    raw.actualMs == null
  ) {
    return null;
  }
  return {
    atMs: raw.atMs,
    baseMs: raw.baseMs,
    rawFactor: raw.rawFactor,
    actualMs: raw.actualMs,
    hourBucket: raw.hourBucket ?? hourBucketOf(raw.atMs),
    speedBand: raw.speedBand ?? speedBandOf(raw.baseMs),
  };
}

function mergeCases(existing: MetaCase[], incoming: MetaCase[]): MetaCase[] {
  const byKey = new Map<string, MetaCase>();
  for (const item of existing) {
    byKey.set(`${item.atMs}:${item.rawFactor.toFixed(3)}:${item.baseMs.toFixed(2)}`, item);
  }
  for (const item of incoming) {
    byKey.set(`${item.atMs}:${item.rawFactor.toFixed(3)}:${item.baseMs.toFixed(2)}`, item);
  }
  return [...byKey.values()]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, MAX_CASES);
}

export function rebuildMosLambdaBins(cases: MetaCase[]): MetaLambdaBin[] {
  const groups = new Map<string, MetaCase[]>();
  for (const item of cases) {
    const exactKey = `h${item.hourBucket}:s${item.speedBand}`;
    const hourKey = `h${item.hourBucket}:*`;
    const bandKey = `h*:s${item.speedBand}`;
    for (const key of [exactKey, hourKey, bandKey]) {
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
  }
  const bins: MetaLambdaBin[] = [];
  for (const [key, list] of groups) {
    if (list.length < MIN_BIN_CASES) continue;
    // Deduplicate within a group (hour/band keys may receive duplicates).
    const unique = mergeCases([], list);
    if (unique.length < MIN_BIN_CASES) continue;
    const fit = fitLambda(unique, MIN_BIN_CASES);
    const [hourPart, bandPart] = key.split(":");
    bins.push({
      key,
      hourBucket: hourPart === "h*" ? null : Number(hourPart.slice(1)),
      speedBand: bandPart === "*" ? null : (bandPart.slice(1) as SpeedBand),
      lambda: fit.lambda,
      count: unique.length,
      mae: fit.mae,
    });
  }
  return bins.sort((a, b) => b.count - a.count);
}

/** Resolve scenario λ for an offshore window (falls back to global). */
export function lambdaForMosWindow(
  store: MetaCalibStore,
  window: WindowForecast,
  _correction?: MosCorrection,
): number {
  if (window.windMeanMs === null) return store.mosLambda;
  const hour = hourBucketOf(Date.parse(window.start));
  const band = speedBandOf(window.windMeanMs);
  const exact = store.mosBins.find(
    (bin) => bin.hourBucket === hour && bin.speedBand === band && bin.count >= MIN_BIN_CASES,
  );
  if (exact) return exact.lambda;
  const bandOnly = store.mosBins.find(
    (bin) => bin.hourBucket === null && bin.speedBand === band && bin.count >= MIN_BIN_CASES,
  );
  if (bandOnly) return bandOnly.lambda;
  const hourOnly = store.mosBins.find(
    (bin) => bin.hourBucket === hour && bin.speedBand === null && bin.count >= MIN_BIN_CASES,
  );
  if (hourOnly) return hourOnly.lambda;
  return store.mosLambda;
}

export async function loadMetaCalib(): Promise<MetaCalibStore> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as MetaCalibStore;
    if (!Array.isArray(raw.mosCases) || !Array.isArray(raw.patternCases)) {
      return emptyMetaCalib();
    }
    const mosCases = raw.mosCases
      .map((item) => normalizeCase(item))
      .filter((item): item is MetaCase => item !== null);
    const patternCases = raw.patternCases
      .map((item) => normalizeCase(item))
      .filter((item): item is MetaCase => item !== null);
    const mosBins = Array.isArray(raw.mosBins) ? raw.mosBins : rebuildMosLambdaBins(mosCases);
    return {
      updatedAt: raw.updatedAt ?? 0,
      mosCases,
      patternCases,
      mosLambda: Number.isFinite(raw.mosLambda) ? clamp(raw.mosLambda, 0, 1) : DEFAULT_LAMBDA,
      patternLambda: Number.isFinite(raw.patternLambda)
        ? clamp(raw.patternLambda, 0, 1)
        : DEFAULT_LAMBDA,
      mosMae: Number.isFinite(raw.mosMae) ? raw.mosMae : 0,
      patternMae: Number.isFinite(raw.patternMae) ? raw.patternMae : 0,
      mosBins,
    };
  } catch {
    return emptyMetaCalib();
  }
}

export async function saveMetaCalib(store: MetaCalibStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store));
}

/** Build MOS meta cases from stored pairs: would the applied factor overshoot harbor? */
export function collectMosMetaCases(mosStore: MosStore): MetaCase[] {
  const cases: MetaCase[] = [];
  for (const pair of mosStore.pairs) {
    const window = {
      start: new Date(pair.windowStart).toISOString(),
      end: new Date(pair.windowStart + WINDOW_MS).toISOString(),
      partialFrom: null,
      available: true,
      weather: "晴れ" as const,
      precipMm: 0,
      tempMinC: null,
      tempMaxC: null,
      windFromDeg: pair.offshoreFromDeg,
      windFromLabel: null,
      windMeanMs: pair.offshoreMeanMs,
      windMaxMs: pair.offshoreMeanMs,
      windGustMs: pair.offshoreGustMs,
      noDeparture: false,
    };
    const correction = correctionForWindow(mosStore, window);
    if (!correction || Math.abs(correction.factor - 1) < 0.02) continue;
    // Learn meta on exact/hour tiers; neighbor/global are display-damped separately.
    if (correction.tier === "global") continue;
    cases.push({
      atMs: pair.windowStart,
      baseMs: pair.offshoreMeanMs,
      rawFactor: correction.factor,
      actualMs: pair.harborMeanMs,
      hourBucket: hourBucketOf(pair.windowStart),
      speedBand: speedBandOf(pair.offshoreMeanMs),
    });
  }
  return cases;
}

function harborMeanInWindow(
  samples: HarborSample[],
  start: number,
  end: number,
): number | null {
  const inWindow = samples.filter((sample) => sample.atMs >= start && sample.atMs < end);
  if (inWindow.length < 4) return null;
  return inWindow.reduce((sum, sample) => sum + sample.meanMs, 0) / inWindow.length;
}

type RampLike = {
  atMs: number;
  peakMeanMs: number;
  boostFactor?: number;
  offshoreMeanMs?: number | null;
};

/**
 * Pattern meta cases: after a ramp, would full boost on the next offshore windows
 * overshoot the harbor mean in those windows?
 */
export function collectPatternMetaCases(
  harbor: HarborSample[],
  windows: WindowForecast[],
  mosLambda: number,
  mosStore: MosStore,
  nowMs: number,
  storedEvents: RampLike[] = [],
): MetaCase[] {
  const detected = detectRampEvents(harbor).map((event) => ({
    atMs: event.atMs,
    peakMeanMs: event.peakMeanMs,
  }));
  const events = [...storedEvents, ...detected];
  const cases: MetaCase[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const nextWindows = windows.filter(
      (window) =>
        window.available &&
        window.windMeanMs !== null &&
        Date.parse(window.end) <= nowMs &&
        Date.parse(window.start) >= event.atMs - WINDOW_MS &&
        Date.parse(window.start) < event.atMs + 9 * 60 * 60 * 1000,
    );
    let taken = 0;
    for (const next of nextWindows) {
      if (taken >= 2 || next.windMeanMs === null) continue;
      const actual = harborMeanInWindow(
        harbor,
        Date.parse(next.start),
        Date.parse(next.end),
      );
      if (actual === null) continue;

      const mos = correctionForWindow(mosStore, next);
      const rawMos = mos?.factor ?? 1;
      const baseMs = next.windMeanMs * dampenFactor(rawMos, mosLambda);
      const boost =
        event.boostFactor && event.boostFactor > 1
          ? clamp(event.boostFactor, 1.05, 1.7)
          : clamp(event.peakMeanMs / Math.max(next.windMeanMs, 0.5), 1.05, 1.7);
      if (Math.abs(boost - 1) < 0.02) continue;
      const key = `${Date.parse(next.start)}:${boost.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push({
        atMs: Date.parse(next.start),
        baseMs,
        rawFactor: boost,
        actualMs: actual,
        hourBucket: hourBucketOf(Date.parse(next.start)),
        speedBand: speedBandOf(next.windMeanMs),
      });
      taken += 1;
    }
  }
  return cases;
}

export function summarizeMetaCalib(store: MetaCalibStore): MetaCalibSummary {
  const mosReady = store.mosCases.length >= MIN_CASES;
  const patternReady = store.patternCases.length >= MIN_CASES;
  const parts: string[] = [];
  if (mosReady) {
    parts.push(
      `MOS減衰 λ=${store.mosLambda.toFixed(2)}（検証 ${store.mosCases.length}・局面 ${store.mosBins.length}）`,
    );
  } else {
    parts.push(`MOS減衰は検証 ${store.mosCases.length}/${MIN_CASES}`);
  }
  if (patternReady) {
    parts.push(`急上昇減衰 λ=${store.patternLambda.toFixed(2)}（検証 ${store.patternCases.length}）`);
  } else {
    parts.push(`急上昇減衰は検証 ${store.patternCases.length}/${MIN_CASES}`);
  }
  return {
    mosLambda: store.mosLambda,
    patternLambda: store.patternLambda,
    mosCases: store.mosCases.length,
    patternCases: store.patternCases.length,
    mosReady,
    patternReady,
    mosBins: store.mosBins.length,
    note: `補正の補正: ${parts.join(" · ")}`,
  };
}

export async function learnMetaCalibration(options: {
  harbor: HarborSample[];
  windows: WindowForecast[];
  mosStore: MosStore;
  nowMs: number;
}): Promise<MetaCalibStore> {
  const { harbor, windows, mosStore, nowMs } = options;
  const store = await loadMetaCalib();
  const mosIncoming = collectMosMetaCases(mosStore);
  const mosCases = mergeCases(store.mosCases, mosIncoming);
  const mosFit = fitLambda(mosCases);
  const mosBins = rebuildMosLambdaBins(mosCases);

  const patternStore = await loadPatternStore();
  const patternIncoming = collectPatternMetaCases(
    harbor,
    windows,
    mosFit.lambda,
    mosStore,
    nowMs,
    patternStore.events,
  );
  const patternCases = mergeCases(store.patternCases, patternIncoming);
  const patternFit = fitLambda(patternCases);

  const next: MetaCalibStore = {
    updatedAt: Date.now(),
    mosCases,
    patternCases,
    mosLambda: mosFit.lambda,
    patternLambda: patternFit.lambda,
    mosMae: mosFit.mae,
    patternMae: patternFit.mae,
    mosBins,
  };
  await saveMetaCalib(next);
  return next;
}
