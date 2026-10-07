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

const CACHE_DIR = path.join(process.cwd(), ".cache");
const ARCHIVE_HOURS = path.join(CACHE_DIR, "mos-offshore-hours.json");
const BACKFILL_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const MIN_PAIRS_BEFORE_SKIP_BACKFILL = 48;
const HARBOR_LOOKBACK_DAYS = 14;
const ARCHIVE_CYCLES = 14;

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
  for (const hour of b) byValid.set(hour.validMs, hour);
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
    archived.length < 16;

  if (!needsBackfill) return store;

  if (!backfillPending) {
    backfillPending = (async () => {
      try {
        console.info("MOS backfill: fetching harbor history and ECMWF archive");
        const [historyHarbor, fetched] = await Promise.all([
          fetchHarborSamples(nowMs, HARBOR_LOOKBACK_DAYS),
          fetchArchiveHoursForMos(nowMs, ARCHIVE_CYCLES),
        ]);
        await saveArchiveHours(mergeHours(archived, fetched));
        const mergedHours = mergeHours(hours, fetched);
        let next = await loadMosStore();
        next = ingestMosPairs(next, buildMosPairs(historyHarbor, mergedHours, nowMs));
        next = { ...next, lastBackfillAt: Date.now() };
        await saveMosStore(next);
        console.info(`MOS backfill done: ${summarizeMos(next).note}`);
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
  }

  return backfillPending;
}
