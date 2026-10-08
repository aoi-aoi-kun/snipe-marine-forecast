import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";

const CACHE_DIR = getCacheDir();
const OPS_PATH = path.join(CACHE_DIR, "ops.json");

export type OpsUptime = {
  /** First time this `.cache` volume saw the app (ISO). */
  firstSeenAt: string;
  /** Last successful warm / learn tick (ISO). */
  lastActiveAt: string;
  warmCount: number;
  learnTickCount: number;
};

async function loadRaw(): Promise<OpsUptime | null> {
  try {
    const raw = JSON.parse(await readFile(OPS_PATH, "utf8")) as OpsUptime;
    if (!raw.firstSeenAt) return null;
    return {
      firstSeenAt: raw.firstSeenAt,
      lastActiveAt: raw.lastActiveAt ?? raw.firstSeenAt,
      warmCount: Number(raw.warmCount) || 0,
      learnTickCount: Number(raw.learnTickCount) || 0,
    };
  } catch {
    return null;
  }
}

async function save(ops: OpsUptime): Promise<void> {
  const { writeProtectedJson } = await import("./learning-persist");
  await writeProtectedJson(OPS_PATH, JSON.stringify(ops), { label: "ops.json" });
}

export async function touchOps(kind: "boot" | "warm" | "learn"): Promise<OpsUptime> {
  const now = new Date().toISOString();
  const existing = await loadRaw();
  const next: OpsUptime = existing ?? {
    firstSeenAt: now,
    lastActiveAt: now,
    warmCount: 0,
    learnTickCount: 0,
  };
  next.lastActiveAt = now;
  if (kind === "warm") next.warmCount += 1;
  if (kind === "learn") next.learnTickCount += 1;
  await save(next);
  return next;
}

export async function getOpsUptime(): Promise<OpsUptime & { learningDays: number }> {
  const ops = (await loadRaw()) ?? {
    firstSeenAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    warmCount: 0,
    learnTickCount: 0,
  };
  const learningDays = Math.max(
    0,
    (Date.parse(ops.lastActiveAt) - Date.parse(ops.firstSeenAt)) / (24 * 60 * 60_000),
  );
  return { ...ops, learningDays };
}
