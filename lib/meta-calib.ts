import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WindowForecast } from "./aggregate";
import type { HarborSample } from "./enowin";
import { correctionForWindow, type MosStore } from "./mos";
import { detectRampEvents } from "./nowcast";
import { WINDOW_MS } from "./time";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const STORE_PATH = path.join(CACHE_DIR, "meta-calib.json");
const MAX_CASES = 400;
const MIN_CASES = 12;
const DEFAULT_LAMBDA = 1;

export type MetaCase = {
  atMs: number;
  baseMs: number;
  rawFactor: number;
  actualMs: number;
};

export type MetaCalibStore = {
  updatedAt: number;
  mosCases: MetaCase[];
  patternCases: MetaCase[];
  mosLambda: number;
  patternLambda: number;
  mosMae: number;
  patternMae: number;
};

export type MetaCalibSummary = {
  mosLambda: number;
  patternLambda: number;
  mosCases: number;
  patternCases: number;
  mosReady: boolean;
  patternReady: boolean;
  note: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mae(errors: number[]): number {
  if (errors.length === 0) return 0;
  return errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
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
  };
}

/** Dampen a multiplicative correction: f' = 1 + λ(f − 1). */
export function dampenFactor(rawFactor: number, lambda: number): number {
  if (!Number.isFinite(rawFactor) || rawFactor <= 0) return 1;
  const gain = clamp(lambda, 0, 1);
  return 1 + gain * (rawFactor - 1);
}

export function fitLambda(cases: MetaCase[]): { lambda: number; mae: number } {
  if (cases.length < MIN_CASES) {
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

export async function loadMetaCalib(): Promise<MetaCalibStore> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as MetaCalibStore;
    if (!Array.isArray(raw.mosCases) || !Array.isArray(raw.patternCases)) {
      return emptyMetaCalib();
    }
    return {
      updatedAt: raw.updatedAt ?? 0,
      mosCases: raw.mosCases,
      patternCases: raw.patternCases,
      mosLambda: Number.isFinite(raw.mosLambda) ? clamp(raw.mosLambda, 0, 1) : DEFAULT_LAMBDA,
      patternLambda: Number.isFinite(raw.patternLambda)
        ? clamp(raw.patternLambda, 0, 1)
        : DEFAULT_LAMBDA,
      mosMae: Number.isFinite(raw.mosMae) ? raw.mosMae : 0,
      patternMae: Number.isFinite(raw.patternMae) ? raw.patternMae : 0,
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
    cases.push({
      atMs: pair.windowStart,
      baseMs: pair.offshoreMeanMs,
      rawFactor: correction.factor,
      actualMs: pair.harborMeanMs,
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

/**
 * Pattern meta cases: after a ramp, would full boost on the next offshore window
 * overshoot the harbor mean in that window?
 */
export function collectPatternMetaCases(
  harbor: HarborSample[],
  windows: WindowForecast[],
  mosLambda: number,
  mosStore: MosStore,
  nowMs: number,
): MetaCase[] {
  const events = detectRampEvents(harbor);
  const cases: MetaCase[] = [];
  for (const event of events) {
    const next = windows.find(
      (window) =>
        window.available &&
        window.windMeanMs !== null &&
        Date.parse(window.start) >= event.atMs &&
        Date.parse(window.start) < event.atMs + 6 * 60 * 60 * 1000 &&
        Date.parse(window.end) <= nowMs,
    );
    if (!next || next.windMeanMs === null) continue;
    const actual = harborMeanInWindow(
      harbor,
      Date.parse(next.start),
      Date.parse(next.end),
    );
    if (actual === null) continue;

    const mos = correctionForWindow(mosStore, next);
    const rawMos = mos?.factor ?? 1;
    const baseMs = next.windMeanMs * dampenFactor(rawMos, mosLambda);
    // Historical boost proxy from the event peak vs that window's raw offshore.
    const boost = clamp(event.peakMeanMs / Math.max(next.windMeanMs, 0.5), 1.05, 1.7);
    if (Math.abs(boost - 1) < 0.02) continue;
    cases.push({
      atMs: Date.parse(next.start),
      baseMs,
      rawFactor: boost,
      actualMs: actual,
    });
  }
  return cases;
}

export function summarizeMetaCalib(store: MetaCalibStore): MetaCalibSummary {
  const mosReady = store.mosCases.length >= MIN_CASES;
  const patternReady = store.patternCases.length >= MIN_CASES;
  const parts: string[] = [];
  if (mosReady) {
    parts.push(`MOS減衰 λ=${store.mosLambda.toFixed(2)}（検証 ${store.mosCases.length}）`);
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

  const patternIncoming = collectPatternMetaCases(
    harbor,
    windows,
    mosFit.lambda,
    mosStore,
    nowMs,
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
  };
  await saveMetaCalib(next);
  return next;
}
