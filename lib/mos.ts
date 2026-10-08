import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HourSample, WindowForecast } from "./aggregate";
import { departureBlocked } from "./aggregate";
import type { HarborSample } from "./enowin";
import { recencyWeights, weightedMean } from "./recency";
import { HOUR_MS, WINDOW_MS, floorBlockStart, jstParts } from "./time";
import { windFromDegrees, windSector8 } from "./wind";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const MOS_CACHE = path.join(CACHE_DIR, "mos.json");
const MAX_PAIRS = 1200;
const MIN_HARBOR_SAMPLES = 4;
const MIN_BIN_PAIRS = 3;
const MIN_HOUR_PAIRS = 4;
/** Combined count across neighboring hour buckets for fallback blend. */
const MIN_NEIGHBOR_PAIRS = 5;
const MIN_FACTOR = 0.65;
const MAX_FACTOR = 1.75;
const NEUTRAL_BAND = 0.04;
const HOUR_BUCKETS = 8;

export type MosPair = {
  windowStart: number;
  harborMeanMs: number;
  harborMaxMs: number;
  harborFromDeg: number | null;
  offshoreMeanMs: number;
  offshoreGustMs: number;
  offshoreFromDeg: number | null;
  ratio: number;
  /** Harbor 5-min max ÷ offshore gust, when gust is usable. */
  gustRatio: number | null;
  biasMs: number;
};

export type MosBin = {
  key: string;
  /** 0 = Oct–Mar, 1 = Apr–Sep (sea-breeze half). null on synthetic hour/global bins. */
  season: 0 | 1 | null;
  hourBucket: number;
  dirSector: number | null;
  count: number;
  meanRatio: number;
  meanGustRatio: number | null;
  meanBiasMs: number;
};

export type MosStore = {
  updatedAt: number;
  lastBackfillAt: number;
  pairs: MosPair[];
  bins: MosBin[];
};

export type MosSummary = {
  pairCount: number;
  binCount: number;
  lastBackfillAt: string | null;
  activeBins: number;
  note: string;
};

export type MosTier = "exact" | "hour" | "neighbor" | "global";

export type MosCorrection = {
  factor: number;
  gustFactor: number | null;
  binKey: string;
  count: number;
  meanBiasMs: number;
  tier: MosTier;
  note: string;
};

/** How much of the learned λ to keep for offshore display (harbor≠offshore). */
export function mosTierGain(tier: MosTier): number {
  switch (tier) {
    case "exact":
      return 1;
    case "hour":
      return 0.55;
    case "neighbor":
      return 0.3;
    case "global":
      return 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hourBucket(atMs: number): number {
  return Math.floor(jstParts(atMs).hour / 3);
}

/** Apr–Sep sea-breeze season vs Oct–Mar winter monsoon half. */
export function seasonHalf(atMs: number): 0 | 1 {
  const month = jstParts(atMs).month;
  return month >= 4 && month <= 9 ? 1 : 0;
}

function binKey(season: 0 | 1, hour: number, dirSector: number | null): string {
  return dirSector === null
    ? `s${season}:h${hour}:x`
    : `s${season}:h${hour}:d${dirSector}`;
}

function circularMeanDeg(degrees: number[]): number | null {
  if (degrees.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const deg of degrees) {
    const rad = (deg * Math.PI) / 180;
    x += Math.sin(rad);
    y += Math.cos(rad);
  }
  if (x === 0 && y === 0) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function harborWindowStats(
  samples: HarborSample[],
  start: number,
  end: number,
): { meanMs: number; maxMs: number; fromDeg: number | null; count: number } | null {
  const inWindow = samples.filter((sample) => sample.atMs >= start && sample.atMs < end);
  if (inWindow.length < MIN_HARBOR_SAMPLES) return null;
  const meanMs = inWindow.reduce((sum, sample) => sum + sample.meanMs, 0) / inWindow.length;
  const maxMs = Math.max(...inWindow.map((sample) => sample.maxMs));
  const fromDeg = circularMeanDeg(
    inWindow.map((sample) => sample.fromDeg).filter((value): value is number => value !== null),
  );
  return { meanMs, maxMs, fromDeg, count: inWindow.length };
}

function offshoreAt(
  hours: HourSample[],
  start: number,
  end: number,
): { meanMs: number; gustMs: number; fromDeg: number | null } | null {
  const sample =
    hours.find((hour) => hour.validMs === start) ??
    hours.find((hour) => hour.validMs > start && hour.validMs <= end) ??
    null;
  if (!sample) return null;
  const meanMs = Math.hypot(sample.u, sample.v);
  if (!Number.isFinite(meanMs) || meanMs < 0.15) return null;
  const fromDeg = meanMs < 0.3 ? null : windFromDegrees(sample.u, sample.v);
  return { meanMs, gustMs: sample.gustMs, fromDeg };
}

function normalizePair(pair: MosPair): MosPair {
  return {
    ...pair,
    gustRatio:
      pair.gustRatio === undefined
        ? null
        : pair.gustRatio,
  };
}

/** Build completed 3-hour pairs from harbor samples and ECMWF point hours. */
export function buildMosPairs(
  harbor: HarborSample[],
  hours: HourSample[],
  nowMs: number,
): MosPair[] {
  if (harbor.length === 0 || hours.length === 0) return [];
  const earliest = Math.min(harbor[0].atMs, hours[0].validMs);
  let cursor = floorBlockStart(earliest, 3);
  const pairs: MosPair[] = [];

  while (cursor + WINDOW_MS <= nowMs) {
    const start = cursor;
    const end = cursor + WINDOW_MS;
    cursor += WINDOW_MS;
    const local = harborWindowStats(harbor, start, end);
    const model = offshoreAt(hours, start, end);
    if (!local || !model) continue;
    const ratio = clamp(local.meanMs / model.meanMs, MIN_FACTOR, MAX_FACTOR);
    const gustRatio =
      Number.isFinite(model.gustMs) && model.gustMs >= 0.5
        ? clamp(local.maxMs / model.gustMs, MIN_FACTOR, MAX_FACTOR)
        : null;
    pairs.push({
      windowStart: start,
      harborMeanMs: local.meanMs,
      harborMaxMs: local.maxMs,
      harborFromDeg: local.fromDeg,
      offshoreMeanMs: model.meanMs,
      offshoreGustMs: model.gustMs,
      offshoreFromDeg: model.fromDeg,
      ratio,
      gustRatio,
      biasMs: local.meanMs - model.meanMs,
    });
  }
  return pairs;
}

export function mergeMosPairs(existing: MosPair[], incoming: MosPair[]): MosPair[] {
  const byStart = new Map<number, MosPair>();
  for (const pair of existing) byStart.set(pair.windowStart, normalizePair(pair));
  for (const pair of incoming) byStart.set(pair.windowStart, normalizePair(pair));
  return [...byStart.values()]
    .sort((a, b) => b.windowStart - a.windowStart)
    .slice(0, MAX_PAIRS);
}

function meanGustRatioOf(list: MosPair[], weights: number[]): number | null {
  const ratios: number[] = [];
  const used: number[] = [];
  list.forEach((pair, index) => {
    if (pair.gustRatio == null) return;
    ratios.push(pair.gustRatio);
    used.push(weights[index] ?? 1);
  });
  if (ratios.length < MIN_BIN_PAIRS) return null;
  return clamp(weightedMean(ratios, used), MIN_FACTOR, MAX_FACTOR);
}

export function rebuildMosBins(
  pairs: MosPair[],
  nowMs = Date.now(),
): MosBin[] {
  const groups = new Map<string, MosPair[]>();
  for (const pair of pairs) {
    const sector =
      pair.offshoreFromDeg === null ? null : windSector8(pair.offshoreFromDeg);
    const key = binKey(seasonHalf(pair.windowStart), hourBucket(pair.windowStart), sector);
    const list = groups.get(key) ?? [];
    list.push(pair);
    groups.set(key, list);
  }

  const bins: MosBin[] = [];
  for (const [key, list] of groups) {
    const weights = recencyWeights(
      list.map((pair) => pair.windowStart),
      nowMs,
    );
    const meanRatio = weightedMean(
      list.map((pair) => pair.ratio),
      weights,
    );
    const meanBiasMs = weightedMean(
      list.map((pair) => pair.biasMs),
      weights,
    );
    const parts = key.split(":");
    const season = Number(parts[0].slice(1)) as 0 | 1;
    const hourPart = parts[1];
    const dirPart = parts[2];
    bins.push({
      key,
      season,
      hourBucket: Number(hourPart.slice(1)),
      dirSector: dirPart === "x" ? null : Number(dirPart.slice(1)),
      count: list.length,
      meanRatio: clamp(meanRatio, MIN_FACTOR, MAX_FACTOR),
      meanGustRatio: meanGustRatioOf(list, weights),
      meanBiasMs,
    });
  }
  return bins.sort((a, b) => b.count - a.count);
}

export function emptyMosStore(): MosStore {
  return { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] };
}

export async function loadMosStore(): Promise<MosStore> {
  try {
    const raw = JSON.parse(await readFile(MOS_CACHE, "utf8")) as MosStore;
    if (!Array.isArray(raw.pairs)) return emptyMosStore();
    const pairs = raw.pairs.map((pair) => normalizePair(pair as MosPair));
    return {
      updatedAt: raw.updatedAt ?? 0,
      lastBackfillAt: raw.lastBackfillAt ?? 0,
      pairs,
      bins: rebuildMosBins(pairs),
    };
  } catch {
    return emptyMosStore();
  }
}

export async function saveMosStore(store: MosStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(MOS_CACHE, JSON.stringify(store));
}

export function ingestMosPairs(store: MosStore, incoming: MosPair[]): MosStore {
  const pairs = mergeMosPairs(store.pairs, incoming);
  return {
    ...store,
    updatedAt: Date.now(),
    pairs,
    bins: rebuildMosBins(pairs),
  };
}

function hourOnlyBins(
  pairs: MosPair[],
  season: 0 | 1 | null,
  nowMs = Date.now(),
): Map<number, MosBin> {
  const groups = new Map<number, MosPair[]>();
  for (const pair of pairs) {
    if (season !== null && seasonHalf(pair.windowStart) !== season) continue;
    const hour = hourBucket(pair.windowStart);
    const list = groups.get(hour) ?? [];
    list.push(pair);
    groups.set(hour, list);
  }
  const map = new Map<number, MosBin>();
  for (const [hour, list] of groups) {
    const weights = recencyWeights(
      list.map((pair) => pair.windowStart),
      nowMs,
    );
    map.set(hour, {
      key: season === null ? `h${hour}:*` : `s${season}:h${hour}:*`,
      season,
      hourBucket: hour,
      dirSector: null,
      count: list.length,
      meanRatio: clamp(
        weightedMean(
          list.map((pair) => pair.ratio),
          weights,
        ),
        MIN_FACTOR,
        MAX_FACTOR,
      ),
      meanGustRatio: meanGustRatioOf(list, weights),
      meanBiasMs: weightedMean(
        list.map((pair) => pair.biasMs),
        weights,
      ),
    });
  }
  return map;
}

/** Count-weighted blend of hour-only bins in hour±1 (wraps 0–7). */
function neighborHourBlend(
  hourBins: Map<number, MosBin>,
  hour: number,
  season: 0 | 1 | null,
): MosBin | null {
  let total = 0;
  let ratioSum = 0;
  let biasSum = 0;
  let gustSum = 0;
  let gustWeight = 0;
  for (const delta of [-1, 0, 1]) {
    const bucket = (hour + delta + HOUR_BUCKETS) % HOUR_BUCKETS;
    const bin = hourBins.get(bucket);
    if (!bin || bin.count < MIN_BIN_PAIRS) continue;
    total += bin.count;
    ratioSum += bin.meanRatio * bin.count;
    biasSum += bin.meanBiasMs * bin.count;
    if (bin.meanGustRatio != null) {
      gustSum += bin.meanGustRatio * bin.count;
      gustWeight += bin.count;
    }
  }
  if (total < MIN_NEIGHBOR_PAIRS) return null;
  return {
    key: season === null ? `h${hour}:~` : `s${season}:h${hour}:~`,
    season,
    hourBucket: hour,
    dirSector: null,
    count: total,
    meanRatio: clamp(ratioSum / total, MIN_FACTOR, MAX_FACTOR),
    meanGustRatio:
      gustWeight >= MIN_BIN_PAIRS
        ? clamp(gustSum / gustWeight, MIN_FACTOR, MAX_FACTOR)
        : null,
    meanBiasMs: biasSum / total,
  };
}

/** Last-resort factor from all pairs — useful while ECMWF open-data history is short. */
function globalRatioBin(pairs: MosPair[], nowMs = Date.now()): MosBin | null {
  if (pairs.length < MIN_NEIGHBOR_PAIRS) return null;
  const weights = recencyWeights(
    pairs.map((pair) => pair.windowStart),
    nowMs,
  );
  const meanRatio = weightedMean(
    pairs.map((pair) => pair.ratio),
    weights,
  );
  const meanBiasMs = weightedMean(
    pairs.map((pair) => pair.biasMs),
    weights,
  );
  return {
    key: "h*:g",
    season: null,
    hourBucket: -1,
    dirSector: null,
    count: pairs.length,
    meanRatio: clamp(meanRatio, MIN_FACTOR, MAX_FACTOR),
    meanGustRatio: meanGustRatioOf(pairs, weights),
    meanBiasMs,
  };
}

function binLabel(bin: MosBin, targetHour: number): string {
  if (bin.key === "h*:g") return "全体平均";
  const seasonLabel =
    bin.season === 1 ? "暖候期" : bin.season === 0 ? "寒候期" : null;
  const prefix = seasonLabel ? `${seasonLabel}・` : "";
  if (bin.key.endsWith(":~")) {
    return `${prefix}${targetHour * 3}–${targetHour * 3 + 3}時台（近傍時間帯）`;
  }
  if (bin.dirSector === null) {
    return `${prefix}${bin.hourBucket * 3}–${bin.hourBucket * 3 + 3}時台`;
  }
  return `${prefix}${bin.hourBucket * 3}–${bin.hourBucket * 3 + 3}時台・方位帯${bin.dirSector}`;
}

function findExactBin(
  store: MosStore,
  season: 0 | 1,
  hour: number,
  sector: number | null,
): MosBin | undefined {
  return store.bins.find(
    (bin) =>
      bin.season === season &&
      bin.hourBucket === hour &&
      bin.dirSector === sector &&
      bin.count >= MIN_BIN_PAIRS,
  );
}

/** Look up a MOS factor for a forecast window. */
export function correctionForWindow(
  store: MosStore,
  window: WindowForecast,
): MosCorrection | null {
  if (!window.available || window.windMeanMs === null) return null;
  const start = Date.parse(window.start);
  const hour = hourBucket(start);
  const season = seasonHalf(start);
  const sector =
    window.windFromDeg === null ? null : windSector8(window.windFromDeg);
  const nowMs = Date.now();

  let chosen = findExactBin(store, season, hour, sector);
  let tier: MosTier = "exact";

  // Cross-season exact (same hour×dir) when this half-year is still thin.
  if (!chosen) {
    const other = findExactBin(store, season === 0 ? 1 : 0, hour, sector);
    if (other) {
      chosen = other;
      tier = "exact";
    }
  }

  if (!chosen) {
    const seasonHour = hourOnlyBins(store.pairs, season, nowMs).get(hour);
    if (seasonHour && seasonHour.count >= MIN_HOUR_PAIRS) {
      chosen = seasonHour;
      tier = "hour";
    }
  }
  if (!chosen) {
    const anyHour = hourOnlyBins(store.pairs, null, nowMs).get(hour);
    if (anyHour && anyHour.count >= MIN_HOUR_PAIRS) {
      chosen = anyHour;
      tier = "hour";
    }
  }
  if (!chosen) {
    const neighbor = neighborHourBlend(
      hourOnlyBins(store.pairs, season, nowMs),
      hour,
      season,
    );
    if (neighbor) {
      chosen = neighbor;
      tier = "neighbor";
    }
  }
  if (!chosen) {
    const neighbor = neighborHourBlend(
      hourOnlyBins(store.pairs, null, nowMs),
      hour,
      null,
    );
    if (neighbor) {
      chosen = neighbor;
      tier = "neighbor";
    }
  }
  if (!chosen) {
    const global = globalRatioBin(store.pairs, nowMs);
    if (global) {
      chosen = global;
      tier = "global";
    }
  }
  if (!chosen) return null;
  if (Math.abs(chosen.meanRatio - 1) < NEUTRAL_BAND) return null;

  const gustNote =
    chosen.meanGustRatio != null &&
    Math.abs(chosen.meanGustRatio - chosen.meanRatio) >= NEUTRAL_BAND
      ? ` 瞬間×${chosen.meanGustRatio.toFixed(2)}。`
      : "";

  return {
    factor: chosen.meanRatio,
    gustFactor: chosen.meanGustRatio,
    binKey: chosen.key,
    count: chosen.count,
    meanBiasMs: chosen.meanBiasMs,
    tier,
    note: `局地補正（MOS）: 過去 ${chosen.count} 枠のハーバー÷沖予報 = ${chosen.meanRatio.toFixed(2)}（${binLabel(chosen, hour)}、差 ${chosen.meanBiasMs >= 0 ? "+" : ""}${chosen.meanBiasMs.toFixed(1)} m/s）。${gustNote}`,
  };
}

export function applyMosCorrection(
  windows: WindowForecast[],
  store: MosStore,
  lambdaForWindow: number | ((window: WindowForecast, correction: MosCorrection) => number) = 1,
): WindowForecast[] {
  return windows.map((window) => {
    const correction = correctionForWindow(store, window);
    if (!correction || window.windMeanMs === null) {
      return {
        ...window,
        mosAdjusted: false,
        mosAdjustNote: null,
      };
    }
    // Global mean is for learning fallback only — do not drag every offshore window toward the harbor.
    const tierGain = mosTierGain(correction.tier);
    if (tierGain <= 0) {
      return {
        ...window,
        mosAdjusted: false,
        mosAdjustNote: null,
      };
    }
    const baseLambda =
      typeof lambdaForWindow === "function"
        ? lambdaForWindow(window, correction)
        : lambdaForWindow;
    const gain = Math.max(0, Math.min(1, baseLambda)) * tierGain;
    const factor = 1 + gain * (correction.factor - 1);
    if (Math.abs(factor - 1) < NEUTRAL_BAND) {
      return {
        ...window,
        mosAdjusted: false,
        mosAdjustNote: null,
      };
    }
    const gustBase =
      correction.gustFactor != null
        ? 1 + gain * (correction.gustFactor - 1)
        : factor;
    const mean = window.windMeanMs * factor;
    const gust =
      window.windGustMs === null ? null : window.windGustMs * gustBase;
    const max =
      window.windMaxMs === null ? null : window.windMaxMs * factor;
    const note =
      gain < 0.999
        ? `${correction.note} 補正の補正 λ=${gain.toFixed(2)}（${correction.tier}）→ ×${factor.toFixed(2)}。`
        : correction.note;
    return {
      ...window,
      windMeanMs: mean,
      windGustMs: gust,
      windMaxMs: max,
      noDeparture: departureBlocked(mean, gust ?? 0),
      mosAdjusted: true,
      mosAdjustNote: note,
      harborAdjusted: window.harborAdjusted,
      harborAdjustNote: window.harborAdjustNote,
    };
  });
}

export function summarizeMos(store: MosStore): MosSummary {
  const activeBins = store.bins.filter((bin) => bin.count >= MIN_BIN_PAIRS).length;
  const spanHours =
    store.pairs.length >= 2
      ? (store.pairs[0].windowStart - store.pairs[store.pairs.length - 1].windowStart) /
        HOUR_MS
      : 0;
  return {
    pairCount: store.pairs.length,
    binCount: store.bins.length,
    lastBackfillAt: store.lastBackfillAt
      ? new Date(store.lastBackfillAt).toISOString()
      : null,
    activeBins,
    note:
      store.pairs.length === 0
        ? "突合データはまだありません。実況と ECMWF が揃い次第、学習を始めます。"
        : `突合 ${store.pairs.length} 枠（約 ${Math.max(1, Math.round(spanHours / 24))} 日分）。使える時間帯・風向の型は ${activeBins} 個。`,
  };
}
