import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarborSample } from "./enowin";
import {
  HORIZONS,
  TREND_MS,
  estimateTrendAt,
  sampleNear,
  type NowcastHorizon,
} from "./nowcast";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const STORE_PATH = path.join(CACHE_DIR, "nowcast-calib.json");
const MAX_CASES = 2500;
const MIN_CASES = 24;
const SAMPLE_STRIDE_MS = 15 * 60 * 1000;
const ACTUAL_TOLERANCE_MS = 4 * 60 * 1000;

export type NowcastCase = {
  atMs: number;
  minutesAhead: NowcastHorizon;
  currentMs: number;
  trendDeltaMs: number;
  actualMs: number;
  riseRateMsPerHour: number;
};

export type NowcastHorizonCalib = {
  minutesAhead: NowcastHorizon;
  count: number;
  dampen: number;
  biasMs: number;
  maeRaw: number;
  maeCalibrated: number;
  skillVsPersistence: number;
};

export type NowcastCalibStore = {
  updatedAt: number;
  cases: NowcastCase[];
  horizons: NowcastHorizonCalib[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyStore(): NowcastCalibStore {
  return { updatedAt: 0, cases: [], horizons: [] };
}

export async function loadNowcastCalib(): Promise<NowcastCalibStore> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as NowcastCalibStore;
    if (!Array.isArray(raw.cases)) return emptyStore();
    return {
      updatedAt: raw.updatedAt ?? 0,
      cases: raw.cases,
      horizons: Array.isArray(raw.horizons) ? raw.horizons : rebuildCalib(raw.cases),
    };
  } catch {
    return emptyStore();
  }
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
      cases.push({
        atMs,
        minutesAhead: minutes,
        currentMs: trend.currentMs,
        trendDeltaMs,
        actualMs: actual.meanMs,
        riseRateMsPerHour: trend.riseRateMsPerHour,
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

function mae(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
}

/** Fit actual ≈ current + dampen * trendDelta + bias via least squares on dampen, then bias. */
export function fitHorizon(cases: NowcastCase[]): NowcastHorizonCalib | null {
  if (cases.length < MIN_CASES) return null;
  const minutesAhead = cases[0].minutesAhead;

  // Grid-search dampen in [0, 1]; coastal trends usually overshoot so dampen < 1.
  let bestDampen = 0.55;
  let bestMae = Infinity;
  for (let step = 0; step <= 20; step++) {
    const dampen = step * 0.05;
    const errors = cases.map((item) => {
      const predicted = item.currentMs + dampen * item.trendDeltaMs;
      return item.actualMs - predicted;
    });
    // remove mean bias for fair dampen comparison
    const meanErr = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const centered = errors.map((value) => value - meanErr);
    const score = mae(centered);
    if (score < bestMae) {
      bestMae = score;
      bestDampen = dampen;
    }
  }

  const residuals = cases.map(
    (item) => item.actualMs - (item.currentMs + bestDampen * item.trendDeltaMs),
  );
  const biasMs = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;

  const rawErrors = cases.map(
    (item) => item.actualMs - (item.currentMs + item.trendDeltaMs),
  );
  const calibErrors = cases.map(
    (item) =>
      item.actualMs - (item.currentMs + bestDampen * item.trendDeltaMs + biasMs),
  );
  const persistErrors = cases.map((item) => item.actualMs - item.currentMs);
  const maeRaw = mae(rawErrors);
  const maeCalibrated = mae(calibErrors);
  const maePersist = mae(persistErrors);
  const skillVsPersistence =
    maePersist <= 1e-6 ? 0 : clamp(1 - maeCalibrated / maePersist, -1, 1);

  return {
    minutesAhead,
    count: cases.length,
    dampen: bestDampen,
    biasMs,
    maeRaw,
    maeCalibrated,
    skillVsPersistence,
  };
}

export function rebuildCalib(cases: NowcastCase[]): NowcastHorizonCalib[] {
  const horizons: NowcastHorizonCalib[] = [];
  for (const minutes of HORIZONS) {
    const subset = cases.filter((item) => item.minutesAhead === minutes);
    const fitted = fitHorizon(subset);
    if (fitted) horizons.push(fitted);
  }
  return horizons;
}

export async function learnNowcastCalibration(
  samples: HarborSample[],
): Promise<NowcastCalibStore> {
  const store = await loadNowcastCalib();
  const incoming = collectNowcastCases(samples);
  if (incoming.length === 0) return store;
  const cases = mergeNowcastCases(store.cases, incoming);
  const next: NowcastCalibStore = {
    updatedAt: Date.now(),
    cases,
    horizons: rebuildCalib(cases),
  };
  await saveNowcastCalib(next);
  return next;
}

export function summarizeNowcastCalib(store: NowcastCalibStore): {
  caseCount: number;
  horizons: NowcastHorizonCalib[];
  note: string;
} {
  if (store.horizons.length === 0) {
    return {
      caseCount: store.cases.length,
      horizons: [],
      note: "ナウキャスト校正のデータがまだ足りません。実況が貯まると自動で精度を合わせます。",
    };
  }
  const parts = store.horizons.map(
    (item) =>
      `${item.minutesAhead}分 MAE ${item.maeCalibrated.toFixed(2)}（減衰 ${item.dampen.toFixed(2)}）`,
  );
  return {
    caseCount: store.cases.length,
    horizons: store.horizons,
    note: `過去検証 ${store.cases.length} 件で校正。${parts.join(" · ")}`,
  };
}
