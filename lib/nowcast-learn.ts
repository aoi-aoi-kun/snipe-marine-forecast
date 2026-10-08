import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";
import type { HarborSample } from "./enowin";
import {
  HORIZONS,
  RISING_REGIME_MS_PER_HOUR,
  TREND_MS,
  circularDeltaDeg,
  estimateDirectionAt,
  estimateTrendAt,
  sampleNear,
  type NowcastHorizon,
} from "./nowcast";
import { recencyWeights, weightedMae, weightedMean } from "./recency";

const CACHE_DIR = getCacheDir();
const STORE_PATH = path.join(CACHE_DIR, "nowcast-calib.json");
const MAX_CASES = 4000;
const MIN_CASES = 24;
/** Rising-regime fits can start with fewer cases (ramps are rare). */
const MIN_RISING_CASES = 16;
/** Floor so rising-regime search cannot collapse to pure persistence. */
const RISING_DAMPEN_FLOOR = 0.35;
const SAMPLE_STRIDE_MS = 15 * 60 * 1000;
const ACTUAL_TOLERANCE_MS = 4 * 60 * 1000;

export type NowcastCase = {
  atMs: number;
  minutesAhead: NowcastHorizon;
  currentMs: number;
  trendDeltaMs: number;
  actualMs: number;
  riseRateMsPerHour: number;
  currentFromDeg: number | null;
  trendDeltaDeg: number | null;
  actualFromDeg: number | null;
};

export type NowcastHorizonCalib = {
  minutesAhead: NowcastHorizon;
  count: number;
  dampen: number;
  biasMs: number;
  maeRaw: number;
  maeCalibrated: number;
  skillVsPersistence: number;
  dirDampen: number;
  dirMaeRaw: number;
  dirMaeCalibrated: number;
};

export type NowcastCalibStore = {
  updatedAt: number;
  lastDeepLearnAt: number;
  cases: NowcastCase[];
  /** Default / calm-dominated fit (all cases). */
  horizons: NowcastHorizonCalib[];
  /** Fit on rising cases only; empty until enough ramp-like samples exist. */
  risingHorizons: NowcastHorizonCalib[];
};

/** Visit-triggered deep relearn cadence (shorter = learns while the app is used). */
const DEEP_LEARN_MS = 2 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyStore(): NowcastCalibStore {
  return {
    updatedAt: 0,
    lastDeepLearnAt: 0,
    cases: [],
    horizons: [],
    risingHorizons: [],
  };
}

export function isRisingNowcastCase(item: NowcastCase): boolean {
  return (
    item.riseRateMsPerHour >= RISING_REGIME_MS_PER_HOUR || item.trendDeltaMs >= 0.4
  );
}

function normalizeHorizon(item: Partial<NowcastHorizonCalib>): NowcastHorizonCalib | null {
  if (
    item.minutesAhead === undefined ||
    item.count === undefined ||
    item.dampen === undefined ||
    item.biasMs === undefined ||
    item.maeRaw === undefined ||
    item.maeCalibrated === undefined ||
    item.skillVsPersistence === undefined
  ) {
    return null;
  }
  return {
    minutesAhead: item.minutesAhead,
    count: item.count,
    dampen: item.dampen,
    biasMs: item.biasMs,
    maeRaw: item.maeRaw,
    maeCalibrated: item.maeCalibrated,
    skillVsPersistence: item.skillVsPersistence,
    dirDampen: Number.isFinite(item.dirDampen) ? (item.dirDampen as number) : 0.45,
    dirMaeRaw: Number.isFinite(item.dirMaeRaw) ? (item.dirMaeRaw as number) : 0,
    dirMaeCalibrated: Number.isFinite(item.dirMaeCalibrated)
      ? (item.dirMaeCalibrated as number)
      : 0,
  };
}

function hasFiniteDirMae(item: Partial<NowcastHorizonCalib>): boolean {
  return Number.isFinite(item.dirMaeCalibrated);
}

export async function loadNowcastCalib(): Promise<NowcastCalibStore> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as NowcastCalibStore;
    if (!Array.isArray(raw.cases)) return emptyStore();
    const cases = raw.cases;
    const rawHorizons = Array.isArray(raw.horizons) ? raw.horizons : [];
    const needsDirRefit =
      rawHorizons.length > 0 && rawHorizons.some((item) => !hasFiniteDirMae(item));
    let horizons = rawHorizons
      .map((item) => normalizeHorizon(item))
      .filter((item): item is NowcastHorizonCalib => item !== null);
    let risingHorizons = (Array.isArray(raw.risingHorizons) ? raw.risingHorizons : [])
      .map((item) => normalizeHorizon(item))
      .filter((item): item is NowcastHorizonCalib => item !== null);
    if (horizons.length < HORIZONS.length || needsDirRefit || risingHorizons.length === 0) {
      const rebuilt = rebuildCalib(cases);
      horizons = rebuilt.horizons;
      risingHorizons = rebuilt.risingHorizons;
    }
    return {
      updatedAt: raw.updatedAt ?? 0,
      lastDeepLearnAt: raw.lastDeepLearnAt ?? 0,
      cases,
      horizons,
      risingHorizons,
    };
  } catch {
    return emptyStore();
  }
}

export function needsDeepNowcastLearn(store: NowcastCalibStore, nowMs: number): boolean {
  return (
    store.cases.length < 120 ||
    nowMs - store.lastDeepLearnAt > DEEP_LEARN_MS ||
    store.horizons.length < HORIZONS.length ||
    store.horizons.some((item) => !hasFiniteDirMae(item))
  );
}

export async function saveNowcastCalib(store: NowcastCalibStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store));
}

/** Build verification cases: at time t, raw trend nowcast vs actual at t+h. */
export function collectNowcastCases(samples: HarborSample[]): NowcastCase[] {
  if (samples.length < 20) return [];
  const first = samples[0].atMs + TREND_MS;
  const last = samples[samples.length - 1].atMs - 60 * 60 * 1000;
  if (last <= first) return [];

  const cases: NowcastCase[] = [];
  for (let atMs = first; atMs <= last; atMs += SAMPLE_STRIDE_MS) {
    const trend = estimateTrendAt(samples, atMs);
    if (!trend) continue;
    for (const minutes of HORIZONS) {
      const actual = sampleNear(samples, atMs + minutes * 60_000, ACTUAL_TOLERANCE_MS);
      if (!actual) continue;
      const trendDeltaMs = (trend.riseRateMsPerHour * minutes) / 60;
      const direction = estimateDirectionAt(samples, atMs);
      const trendDeltaDeg =
        direction === null ? null : (direction.rateDegPerHour * minutes) / 60;
      cases.push({
        atMs,
        minutesAhead: minutes,
        currentMs: trend.currentMs,
        trendDeltaMs,
        actualMs: actual.meanMs,
        riseRateMsPerHour: trend.riseRateMsPerHour,
        currentFromDeg: direction?.currentDeg ?? null,
        trendDeltaDeg,
        actualFromDeg: actual.fromDeg,
      });
    }
  }
  return cases;
}

export function mergeNowcastCases(
  existing: NowcastCase[],
  incoming: NowcastCase[],
): NowcastCase[] {
  const key = (item: NowcastCase) => `${item.atMs}:${item.minutesAhead}`;
  const map = new Map<string, NowcastCase>();
  for (const item of existing) map.set(key(item), item);
  for (const item of incoming) map.set(key(item), item);
  return [...map.values()]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, MAX_CASES);
}

/** Fit actual ≈ current + dampen * trendDelta + bias; recent cases weigh more. */
export function fitHorizon(
  cases: NowcastCase[],
  nowMs = Date.now(),
  options: { minCases?: number; minDampen?: number } = {},
): NowcastHorizonCalib | null {
  const minCases = options.minCases ?? MIN_CASES;
  const minDampen = options.minDampen ?? 0;
  if (cases.length < minCases) return null;
  const minutesAhead = cases[0].minutesAhead;
  const weights = recencyWeights(
    cases.map((item) => item.atMs),
    nowMs,
  );

  // Grid-search dampen in [minDampen, 1]; coastal trends usually overshoot so dampen < 1.
  let bestDampen = Math.max(0.55, minDampen);
  let bestMae = Infinity;
  const startStep = Math.round(minDampen / 0.05);
  for (let step = startStep; step <= 20; step++) {
    const dampen = step * 0.05;
    const errors = cases.map((item) => {
      const predicted = item.currentMs + dampen * item.trendDeltaMs;
      return item.actualMs - predicted;
    });
    // remove mean bias for fair dampen comparison
    const meanErr = weightedMean(errors, weights);
    const centered = errors.map((value) => value - meanErr);
    const score = weightedMae(centered, weights);
    if (score < bestMae) {
      bestMae = score;
      bestDampen = dampen;
    }
  }

  const residuals = cases.map(
    (item) => item.actualMs - (item.currentMs + bestDampen * item.trendDeltaMs),
  );
  const biasMs = weightedMean(residuals, weights);

  const rawErrors = cases.map(
    (item) => item.actualMs - (item.currentMs + item.trendDeltaMs),
  );
  const calibErrors = cases.map(
    (item) =>
      item.actualMs - (item.currentMs + bestDampen * item.trendDeltaMs + biasMs),
  );
  const persistErrors = cases.map((item) => item.actualMs - item.currentMs);
  const maeRaw = weightedMae(rawErrors, weights);
  const maeCalibrated = weightedMae(calibErrors, weights);
  const maePersist = weightedMae(persistErrors, weights);
  const skillVsPersistence =
    maePersist <= 1e-6 ? 0 : clamp(1 - maeCalibrated / maePersist, -1, 1);

  const dirCases = cases.filter(
    (item) =>
      item.currentFromDeg !== null &&
      item.trendDeltaDeg !== null &&
      item.actualFromDeg !== null,
  );
  let dirDampen = 0.45;
  let dirMaeRaw = 0;
  let dirMaeCalibrated = 0;
  if (dirCases.length >= MIN_CASES) {
    const dirWeights = recencyWeights(
      dirCases.map((item) => item.atMs),
      nowMs,
    );
    let bestDir = 0.45;
    let bestDirMae = Infinity;
    for (let step = 0; step <= 20; step++) {
      const dampen = step * 0.05;
      const errors = dirCases.map((item) =>
        Math.abs(
          circularDeltaDeg(
            (item.currentFromDeg as number) + dampen * (item.trendDeltaDeg as number),
            item.actualFromDeg as number,
          ),
        ),
      );
      const score = weightedMae(errors, dirWeights);
      if (score < bestDirMae) {
        bestDirMae = score;
        bestDir = dampen;
      }
    }
    dirDampen = bestDir;
    dirMaeRaw = weightedMae(
      dirCases.map((item) =>
        Math.abs(
          circularDeltaDeg(
            (item.currentFromDeg as number) + (item.trendDeltaDeg as number),
            item.actualFromDeg as number,
          ),
        ),
      ),
      dirWeights,
    );
    dirMaeCalibrated = weightedMae(
      dirCases.map((item) =>
        Math.abs(
          circularDeltaDeg(
            (item.currentFromDeg as number) + dirDampen * (item.trendDeltaDeg as number),
            item.actualFromDeg as number,
          ),
        ),
      ),
      dirWeights,
    );
  }

  return {
    minutesAhead,
    count: cases.length,
    dampen: bestDampen,
    biasMs,
    maeRaw,
    maeCalibrated,
    skillVsPersistence,
    dirDampen,
    dirMaeRaw,
    dirMaeCalibrated,
  };
}

export function rebuildCalib(
  cases: NowcastCase[],
  nowMs = Date.now(),
): { horizons: NowcastHorizonCalib[]; risingHorizons: NowcastHorizonCalib[] } {
  const horizons: NowcastHorizonCalib[] = [];
  const risingHorizons: NowcastHorizonCalib[] = [];
  for (const minutes of HORIZONS) {
    const subset = cases.filter((item) => item.minutesAhead === minutes);
    const fitted = fitHorizon(subset, nowMs);
    if (fitted) horizons.push(fitted);

    const risingSubset = subset.filter(isRisingNowcastCase);
    const risingFitted = fitHorizon(risingSubset, nowMs, {
      minCases: MIN_RISING_CASES,
      minDampen: RISING_DAMPEN_FLOOR,
    });
    if (risingFitted) risingHorizons.push(risingFitted);
  }
  return { horizons, risingHorizons };
}

export async function learnNowcastCalibration(
  samples: HarborSample[],
  options: { deep?: boolean } = {},
): Promise<NowcastCalibStore> {
  const store = await loadNowcastCalib();
  const incoming = collectNowcastCases(samples);
  if (incoming.length === 0 && !options.deep) return store;
  const cases = mergeNowcastCases(store.cases, incoming);
  const nowMs = Date.now();
  const rebuilt = rebuildCalib(cases, nowMs);
  const next: NowcastCalibStore = {
    updatedAt: nowMs,
    lastDeepLearnAt: options.deep ? nowMs : store.lastDeepLearnAt,
    cases,
    horizons: rebuilt.horizons,
    risingHorizons: rebuilt.risingHorizons,
  };
  await saveNowcastCalib(next);
  return next;
}

export function summarizeNowcastCalib(store: NowcastCalibStore): {
  caseCount: number;
  horizons: NowcastHorizonCalib[];
  risingHorizons: NowcastHorizonCalib[];
  note: string;
} {
  if (store.horizons.length === 0) {
    return {
      caseCount: store.cases.length,
      horizons: [],
      risingHorizons: [],
      note: "検証データが少ないため、傾きの延長をそのまま使っています。実況が増えると自動で校正されます。",
    };
  }
  const parts = store.horizons.map((item) => {
    const speed = Number.isFinite(item.maeCalibrated)
      ? item.maeCalibrated.toFixed(2)
      : "—";
    const dir = Number.isFinite(item.dirMaeCalibrated)
      ? `${Math.round(item.dirMaeCalibrated)}°`
      : "学習中";
    return `${item.minutesAhead}分 風速±${speed} / 風向±${dir}`;
  });
  const risingCount = store.cases.filter(isRisingNowcastCase).length;
  const risingNote =
    store.risingHorizons.length >= HORIZONS.length
      ? ` 立ち上がり時は別校正（${risingCount} 件 · 傾き残存）。`
      : risingCount > 0
        ? ` 立ち上がり事例 ${risingCount} 件を蓄積中。`
        : "";
  return {
    caseCount: store.cases.length,
    horizons: store.horizons,
    risingHorizons: store.risingHorizons ?? [],
    note: `${store.cases.length} 件の過去実況で校正。${parts.join(" · ")}${risingNote}`,
  };
}
