import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { HourSample } from "./aggregate";
import { getBytes, HttpStatusError } from "./http";
import { forecastWindows, formatCycle, HOUR_MS } from "./time";

const execFileAsync = promisify(execFile);

export const POINT = { lat: 35.25, lon: 139.5, name: "七里ヶ浜沖" };
const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast)";
const STEP_HOURS = 3;
const STEP_MS = STEP_HOURS * HOUR_MS;
const MAX_STEP_HOURS = 144;
const REQUIRED = ["10u", "10v", "2t", "tcc", "tp"] as const;
const GUST_PARAMS = ["10fg3", "10fg"] as const;

export type IndexEntry = {
  param: string;
  step: number;
  levtype: string;
  offset: number;
  length: number;
};

export type PointValue = {
  param: string;
  step: number;
  value: number;
};

type IndexRow = {
  param?: string;
  step?: string | number;
  levtype?: string;
  _offset?: number;
  _length?: number;
};

type GribPointJson = {
  keys?: { shortName?: string; step?: number };
  neighbours?: { distance?: number; value?: number }[];
};

/**
 * 00 and 12 UTC runs. Open-data 3-hour steps reach 144 hours on every cycle;
 * these two cycles are published first and stay available longer.
 */
export function ifsCycleCandidates(nowMs: number): number[] {
  const step = 12 * HOUR_MS;
  const latest = Math.floor(nowMs / step) * step;
  return Array.from({ length: 4 }, (_, index) => latest - index * step);
}

export function neededSteps(initMs: number, nowMs: number): number[] {
  const horizonEnd = forecastWindows(nowMs).at(-1)?.end ?? nowMs;
  if (horizonEnd <= initMs) return [];
  const elapsedHours = Math.floor((nowMs - initMs) / HOUR_MS);
  const from = Math.max(0, Math.floor(elapsedHours / STEP_HOURS) * STEP_HOURS - STEP_HOURS);
  const to = Math.min(
    MAX_STEP_HOURS,
    Math.ceil((horizonEnd - initMs) / STEP_MS) * STEP_HOURS,
  );
  if (to < from) return [];
  const steps: number[] = [];
  for (let step = from; step <= to; step += STEP_HOURS) steps.push(step);
  return steps;
}

export function gribUrl(initMs: number, step: number): string {
  return `${productBase(initMs, step)}.grib2`;
}

export function indexUrl(initMs: number, step: number): string {
  return `${productBase(initMs, step)}.index`;
}

function productBase(initMs: number, step: number): string {
  const { ymd, hh } = formatCycle(initMs);
  const stamp = `${ymd}${hh}0000`;
  return `https://data.ecmwf.int/forecasts/${ymd}/${hh}z/ifs/0p25/oper/${stamp}-${step}h-oper-fc`;
}

export function parseIndex(text: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as IndexRow;
    if (!row.param || row._offset == null || row._length == null) continue;
    entries.push({
      param: row.param,
      step: Number(row.step),
      levtype: row.levtype ?? "",
      offset: row._offset,
      length: row._length,
    });
  }
  return entries;
}

export function selectFields(entries: IndexEntry[], step: number): IndexEntry[] {
  const found = new Map<string, IndexEntry>();
  for (const entry of entries) {
    if (entry.step !== step || entry.levtype !== "sfc" || entry.length <= 0) continue;
    if (
      (REQUIRED as readonly string[]).includes(entry.param) ||
      (GUST_PARAMS as readonly string[]).includes(entry.param)
    ) {
      found.set(entry.param, entry);
    }
  }
  const gust = GUST_PARAMS.map((param) => found.get(param)).find((entry) => entry);
  if (REQUIRED.some((param) => !found.has(param)) || !gust) return [];
  return [...REQUIRED.map((param) => found.get(param)!), gust];
}

export function parsePointValues(json: string): PointValue[] {
  const start = json.indexOf("[");
  if (start < 0) throw new Error("GRIB の読み取り結果が不正です");
  const parsed = JSON.parse(json.slice(start)) as GribPointJson[];
  if (!Array.isArray(parsed)) throw new Error("GRIB の読み取り結果が不正です");
  const values: PointValue[] = [];
  for (const message of parsed) {
    const param = message.keys?.shortName;
    const step = message.keys?.step;
    const neighbour = message.neighbours?.[0];
    const value = neighbour?.value;
    if (!param || step == null || value == null || Number.isNaN(Number(value))) continue;
    if (typeof neighbour?.distance === "number" && neighbour.distance > 1) {
      throw new Error("格子点が 35.25N 139.5E と一致しません");
    }
    values.push({ param, step: Number(step), value: Number(value) });
  }
  return values;
}

export function samplesFromValues(initMs: number, values: PointValue[]): HourSample[] {
  const byStep = new Map<number, Partial<Record<string, number>>>();
  for (const item of values) {
    const bag = byStep.get(item.step) ?? {};
    bag[item.param] = item.value;
    byStep.set(item.step, bag);
  }

  const samples: HourSample[] = [];
  for (const [step, bag] of byStep) {
    if (
      bag["10u"] == null ||
      bag["10v"] == null ||
      bag["2t"] == null ||
      bag.tcc == null ||
      bag.tp == null ||
      (bag["10fg"] == null && bag["10fg3"] == null)
    ) {
      continue;
    }
    samples.push({
      validMs: initMs + step * HOUR_MS,
      tempC: bag["2t"] - 273.15,
      u: bag["10u"],
      v: bag["10v"],
      cloudPct: Math.min(100, Math.max(0, bag.tcc * 100)),
      precipRunMm: Math.max(0, bag.tp * 1000),
      gustMs: Math.max(0, bag["10fg"] ?? bag["10fg3"] ?? 0),
    });
  }
  samples.sort((a, b) => a.validMs - b.validMs);
  return samples;
}

async function readPointValues(bytes: Uint8Array): Promise<PointValue[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "ifs-"));
  const file = path.join(dir, "fields.grib2");
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileAsync(
      "grib_ls",
      ["-j", "-l", `${POINT.lat},${POINT.lon},1`, "-p", "shortName,step", file],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return parsePointValues(stdout);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("eccodes の grib_ls が見つかりません");
    }
    if (error instanceof Error && error.message.includes("格子点")) throw error;
    console.warn("IFS decode failed", error);
    throw new Error("ECMWF の GRIB2 を読めませんでした");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function fetchIndex(initMs: number, step: number): Promise<IndexEntry[]> {
  const response = await getBytes(indexUrl(initMs, step), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeoutMs: 20_000,
  });
  if (response.status !== 200) throw new HttpStatusError(response.status);
  return parseIndex(new TextDecoder().decode(response.body));
}

async function downloadStep(initMs: number, step: number): Promise<HourSample | null> {
  try {
    const fields = selectFields(await fetchIndex(initMs, step), step);
    if (fields.length !== REQUIRED.length + 1) return null;
    const parts = await Promise.all(
      fields.map(async (field) => {
        const response = await getBytes(gribUrl(initMs, step), {
          headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
          timeoutMs: 60_000,
          range: { start: field.offset, end: field.offset + field.length - 1 },
        });
        if (response.status !== 206 || response.body.length !== field.length) {
          throw new Error(`範囲取得に失敗しました (${response.status}, ${response.body.length})`);
        }
        return response.body;
      }),
    );
    const samples = samplesFromValues(initMs, await readPointValues(concatBytes(parts)));
    return samples.find((sample) => sample.validMs === initMs + step * HOUR_MS) ?? null;
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) return null;
    console.warn("IFS step failed", new Date(initMs).toISOString(), step, error);
    return null;
  }
}

export async function probeCycle(initMs: number, steps: number[]): Promise<boolean> {
  // Probe a short lead so longer archive steps (e.g. 36h) do not hide an otherwise usable cycle.
  if (steps.length === 0) return false;
  const probeStep = steps.includes(STEP_HOURS) ? STEP_HOURS : steps[0];
  try {
    const fields = selectFields(await fetchIndex(initMs, probeStep), probeStep);
    return fields.length === REQUIRED.length + 1;
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) return false;
    console.warn("IFS probe failed", new Date(initMs).toISOString(), probeStep, error);
    return false;
  }
}

export async function fetchCycleSamples(
  initMs: number,
  steps: number[],
  already: Map<number, HourSample>,
): Promise<Map<number, HourSample>> {
  const missing = steps.filter((step) => !Number.isFinite(already.get(step)?.gustMs));
  const { ymd, hh } = formatCycle(initMs);
  console.info(`ECMWF IFS ${ymd} ${hh}z: ${missing.length} steps`);
  // Keep concurrency low for Render free (512MB) — grib_ls + buffers OOM easily at 6.
  const concurrency = Math.max(1, Number(process.env.ECMWF_CONCURRENCY || 2) || 2);
  const downloaded = await mapPool(missing, concurrency, (step) => downloadStep(initMs, step));
  const merged = new Map(already);
  for (const sample of downloaded) {
    if (!sample) continue;
    merged.set(Math.round((sample.validMs - initMs) / HOUR_MS), sample);
  }
  return merged;
}

/**
 * Fetch short-range ECMWF point hours for MOS backfill.
 * Uses the last `cycleCount` 00/12 UTC cycles with steps 3..36h.
 * When several cycles cover the same valid time, keep the shortest lead.
 */
export async function fetchArchiveHoursForMos(
  nowMs: number,
  cycleCount = 10,
): Promise<HourSample[]> {
  const cycleStep = 12 * HOUR_MS;
  const latest = Math.floor(nowMs / cycleStep) * cycleStep;
  const inits = Array.from({ length: cycleCount }, (_, index) => latest - index * cycleStep);
  const steps = Array.from({ length: 12 }, (_, index) => (index + 1) * STEP_HOURS); // 3..36h
  const byValid = new Map<number, HourSample>();
  const leadByValid = new Map<number, number>();

  for (const initMs of inits) {
    const available = await probeCycle(initMs, steps);
    if (!available) continue;
    const samples = await fetchCycleSamples(initMs, steps, new Map());
    for (const sample of samples.values()) {
      const lead = sample.validMs - initMs;
      const previousLead = leadByValid.get(sample.validMs);
      if (previousLead !== undefined && lead >= previousLead) continue;
      byValid.set(sample.validMs, sample);
      leadByValid.set(sample.validMs, lead);
    }
  }

  return [...byValid.values()].sort((a, b) => a.validMs - b.validMs);
}
