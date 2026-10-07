import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HourSample, WindowForecast } from "./aggregate";
import { departureBlocked } from "./aggregate";
import type { HarborSample } from "./enowin";
import { HOUR_MS, WINDOW_MS, floorBlockStart, jstParts } from "./time";
import { windFromDegrees, windSector8 } from "./wind";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const MOS_CACHE = path.join(CACHE_DIR, "mos.json");
const MAX_PAIRS = 800;
const MIN_HARBOR_SAMPLES = 4;
const MIN_BIN_PAIRS = 3;
const MIN_HOUR_PAIRS = 5;
const MIN_FACTOR = 0.65;
const MAX_FACTOR = 1.75;
const NEUTRAL_BAND = 0.04;

export type MosPair = {
  windowStart: number;
  harborMeanMs: number;
  harborMaxMs: number;
  harborFromDeg: number | null;
  offshoreMeanMs: number;
  offshoreGustMs: number;
  offshoreFromDeg: number | null;
  ratio: number;
  biasMs: number;
};

export type MosBin = {
  key: string;
  hourBucket: number;
  dirSector: number | null;
  count: number;
  meanRatio: number;
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

export type MosCorrection = {
  factor: number;
  binKey: string;
  count: number;
  meanBiasMs: number;
  note: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hourBucket(atMs: number): number {
  return Math.floor(jstParts(atMs).hour / 3);
}

function binKey(hour: number, dirSector: number | null): string {
  return dirSector === null ? `h${hour}:x` : `h${hour}:d${dirSector}`;
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
    pairs.push({
      windowStart: start,
      harborMeanMs: local.meanMs,
      harborMaxMs: local.maxMs,
      harborFromDeg: local.fromDeg,
      offshoreMeanMs: model.meanMs,
      offshoreGustMs: model.gustMs,
      offshoreFromDeg: model.fromDeg,
      ratio,
      biasMs: local.meanMs - model.meanMs,
    });
  }
  return pairs;
}

export function mergeMosPairs(existing: MosPair[], incoming: MosPair[]): MosPair[] {
  const byStart = new Map<number, MosPair>();
  for (const pair of existing) byStart.set(pair.windowStart, pair);
  for (const pair of incoming) byStart.set(pair.windowStart, pair);
  return [...byStart.values()]
    .sort((a, b) => b.windowStart - a.windowStart)
    .slice(0, MAX_PAIRS);
}

export function rebuildMosBins(pairs: MosPair[]): MosBin[] {
  const groups = new Map<string, MosPair[]>();
  for (const pair of pairs) {
    const sector =
      pair.offshoreFromDeg === null ? null : windSector8(pair.offshoreFromDeg);
    const key = binKey(hourBucket(pair.windowStart), sector);
    const list = groups.get(key) ?? [];
    list.push(pair);
    groups.set(key, list);
  }

  const bins: MosBin[] = [];
  for (const [key, list] of groups) {
    const meanRatio =
      list.reduce((sum, pair) => sum + pair.ratio, 0) / list.length;
    const meanBiasMs =
      list.reduce((sum, pair) => sum + pair.biasMs, 0) / list.length;
    const [hourPart, dirPart] = key.split(":");
    bins.push({
      key,
      hourBucket: Number(hourPart.slice(1)),
      dirSector: dirPart === "x" ? null : Number(dirPart.slice(1)),
      count: list.length,
      meanRatio: clamp(meanRatio, MIN_FACTOR, MAX_FACTOR),
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
    return {
      updatedAt: raw.updatedAt ?? 0,
      lastBackfillAt: raw.lastBackfillAt ?? 0,
      pairs: raw.pairs,
      bins: Array.isArray(raw.bins) ? raw.bins : rebuildMosBins(raw.pairs),
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

function hourOnlyBins(pairs: MosPair[]): Map<number, MosBin> {
  const groups = new Map<number, MosPair[]>();
  for (const pair of pairs) {
    const hour = hourBucket(pair.windowStart);
    const list = groups.get(hour) ?? [];
    list.push(pair);
    groups.set(hour, list);
  }
  const map = new Map<number, MosBin>();
  for (const [hour, list] of groups) {
    map.set(hour, {
      key: `h${hour}:*`,
      hourBucket: hour,
      dirSector: null,
      count: list.length,
      meanRatio: clamp(
        list.reduce((sum, pair) => sum + pair.ratio, 0) / list.length,
        MIN_FACTOR,
        MAX_FACTOR,
      ),
      meanBiasMs: list.reduce((sum, pair) => sum + pair.biasMs, 0) / list.length,
    });
  }
  return map;
}

/** Look up a MOS factor for a forecast window. */
export function correctionForWindow(
  store: MosStore,
  window: WindowForecast,
): MosCorrection | null {
  if (!window.available || window.windMeanMs === null) return null;
  const start = Date.parse(window.start);
  const hour = hourBucket(start);
  const sector =
    window.windFromDeg === null ? null : windSector8(window.windFromDeg);
  const exact = store.bins.find(
    (bin) => bin.hourBucket === hour && bin.dirSector === sector && bin.count >= MIN_BIN_PAIRS,
  );
  const hourBins = hourOnlyBins(store.pairs);
  const hourBin = hourBins.get(hour);
  const chosen =
    exact ??
    (hourBin && hourBin.count >= MIN_HOUR_PAIRS ? hourBin : null);
  if (!chosen) return null;
  if (Math.abs(chosen.meanRatio - 1) < NEUTRAL_BAND) return null;

  const label =
    chosen.dirSector === null
      ? `${hour * 3}–${hour * 3 + 3}時台`
      : `${hour * 3}–${hour * 3 + 3}時台・方位帯${chosen.dirSector}`;
  return {
    factor: chosen.meanRatio,
    binKey: chosen.key,
    count: chosen.count,
    meanBiasMs: chosen.meanBiasMs,
    note: `局地補正（MOS）: 過去${chosen.count}枠の「ハーバー÷沖予報」平均 ${chosen.meanRatio.toFixed(2)}（${label}、平均差 ${chosen.meanBiasMs >= 0 ? "+" : ""}${chosen.meanBiasMs.toFixed(1)} m/s）。`,
  };
}

export function applyMosCorrection(
  windows: WindowForecast[],
  store: MosStore,
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
    const mean = window.windMeanMs * correction.factor;
    const gust =
      window.windGustMs === null ? null : window.windGustMs * correction.factor;
    const max =
      window.windMaxMs === null ? null : window.windMaxMs * correction.factor;
    return {
      ...window,
      windMeanMs: mean,
      windGustMs: gust,
      windMaxMs: max,
      noDeparture: departureBlocked(mean, gust ?? 0),
      mosAdjusted: true,
      mosAdjustNote: correction.note,
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
        ? "まだ突合データがありません。実況とECMWFが揃い次第、学習を始めます。"
        : `突合 ${store.pairs.length} 枠（約 ${Math.max(1, Math.round(spanHours / 24))} 日分）。補正に使える時間帯・風向の型は ${activeBins} 個。`,
  };
}
