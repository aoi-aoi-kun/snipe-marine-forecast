import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HourSample } from "./aggregate";
import { fetchArchiveHoursForMos } from "./ecmwf";
import { fetchHarborSamples, type HarborSample } from "./enowin";
import {
  buildMosPairs,
  ingestMosPairs,
  loadMosStore,
  saveMosStore,
  summarizeMos,
  type MosStore,
} from "./mos";
import { fetchOpenMeteoArchiveHours } from "./open-meteo-archive";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const ARCHIVE_HOURS = path.join(CACHE_DIR, "mos-offshore-hours.json");
/** Page visits with refreshHarbor also trigger backfill; keep cooldown short. */
const BACKFILL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MIN_PAIRS_BEFORE_SKIP_BACKFILL = 120;
/** Harbor history for MOS pairs — longer lookback is the cheapest way to thicken bins. */
const HARBOR_LOOKBACK_DAYS = 30;
/** Open-data cycles for MOS (keep small — each cycle downloads many GRIB steps). */
const ARCHIVE_CYCLES = 8;
/** Open-Meteo historical IFS fills the gap when open-data retention is short. */
const OPEN_METEO_PAST_DAYS = 31;

type ArchiveCache = {
  fetchedAt: number;
  hours: HourSample[];
};

let backfillPending: Promise<MosStore> | null = null;

async function loadArchiveHours(): Promise<HourSample[]> {
  try {
    const raw = JSON.parse(await readFile(ARCHIVE_HOURS, "utf8")) as ArchiveCache;
    return Array.isArray(raw.hours) ? raw.hours : [];
  } catch {
    return [];
  }
}

async function saveArchiveHours(hours: HourSample[]) {
  await mkdir(CACHE_DIR, { recursive: true });
  const byValid = new Map<number, HourSample>();
  for (const hour of hours) byValid.set(hour.validMs, hour);
  await writeFile(
    ARCHIVE_HOURS,
    JSON.stringify({
      fetchedAt: Date.now(),
      hours: [...byValid.values()].sort((a, b) => a.validMs - b.validMs),
    }),
  );
}

function mergeHours(a: HourSample[], b: HourSample[]): HourSample[] {
  const byValid = new Map<number, HourSample>();
  for (const hour of a) byValid.set(hour.validMs, hour);
  // Prefer later sources only when filling gaps; first writer wins for equal keys
  // so live ECMWF open-data (passed first after merge) stays authoritative.
  for (const hour of b) {
    if (!byValid.has(hour.validMs)) byValid.set(hour.validMs, hour);
  }
  return [...byValid.values()].sort((x, y) => x.validMs - y.validMs);
}

/**
 * Update MOS store from current IFS hours + harbor, and periodically backfill history.
 */
export async function learnMos(options: {
  nowMs: number;
  harbor: HarborSample[];
  ifsHours: HourSample[];
  refresh: boolean;
}): Promise<MosStore> {
  const { nowMs, harbor, ifsHours, refresh } = options;
  let store = await loadMosStore();
  const archived = await loadArchiveHours();
  let hours = mergeHours(ifsHours, archived);

  // Always absorb whatever we already have (cheap).
  store = ingestMosPairs(store, buildMosPairs(harbor, hours, nowMs));
  await saveMosStore(store);

  const needsBackfill =
    refresh ||
    store.pairs.length < MIN_PAIRS_BEFORE_SKIP_BACKFILL ||
    nowMs - store.lastBackfillAt > BACKFILL_COOLDOWN_MS ||
    archived.length < 48;

  if (!needsBackfill) return store;

  // Keep API / continuous ticks responsive: run archive backfill in the background.
  if (!backfillPending) {
    backfillPending = (async () => {
      try {
        console.info(
          "MOS backfill: harbor history + ECMWF open-data + Open-Meteo historical IFS",
        );
        const [historyHarbor, fetched, openMeteo] = await Promise.all([
          fetchHarborSamples(nowMs, HARBOR_LOOKBACK_DAYS),
          fetchArchiveHoursForMos(nowMs, ARCHIVE_CYCLES).catch((error) => {
            console.warn("MOS open-data archive failed", error);
            return [] as HourSample[];
          }),
          fetchOpenMeteoArchiveHours(nowMs, OPEN_METEO_PAST_DAYS).catch((error) => {
            console.warn("MOS Open-Meteo archive failed", error);
            return [] as HourSample[];
          }),
        ]);
        // Live/open-data first, then Open-Meteo fills missing valid times only.
        const combined = mergeHours(mergeHours(archived, fetched), openMeteo);
        await saveArchiveHours(combined);
        const mergedHours = mergeHours(hours, combined);
        let next = await loadMosStore();
        next = ingestMosPairs(next, buildMosPairs(historyHarbor, mergedHours, nowMs));
        next = { ...next, lastBackfillAt: Date.now() };
        await saveMosStore(next);
        console.info(
          `MOS backfill done: ${summarizeMos(next).note} (archive hours=${combined.length})`,
        );
        return next;
      } catch (error) {
        console.warn("MOS backfill failed", error);
        const fallback = await loadMosStore();
        return {
          ...fallback,
          lastBackfillAt: Date.now(),
        };
      } finally {
        backfillPending = null;
      }
    })();
    void backfillPending;
  }

  return store;
}
