import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";

/** Learning artifacts that must survive redeploys / empty-cache boots. */
export const LEARNING_FILE_NAMES = [
  "nowcast-calib.json",
  "harbor-patterns.json",
  "pattern-forecast-calib.json",
  "nowcast-pattern-blend-calib.json",
  "mos.json",
  "mos-offshore-hours.json",
  "meta-calib.json",
  "skill-history.json",
  "ops.json",
] as const;

export type LearningFileName = (typeof LEARNING_FILE_NAMES)[number];

export function getLearningSeedDir(): string {
  const fromEnv = process.env.LEARNING_SEED_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), "data", "learning-seed");
}

/** Extra durable mirror (e.g. under a Render Disk). Defaults to CACHE_DIR/learning-mirror. */
export function getLearningMirrorDir(): string {
  const fromEnv = process.env.LEARNING_MIRROR_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(getCacheDir(), "learning-mirror");
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

/**
 * Refuse to replace a substantial learning file with a tiny / empty payload.
 * Returns false when the write was skipped.
 */
export async function writeProtectedJson(
  filePath: string,
  body: string,
  options: { label?: string } = {},
): Promise<boolean> {
  const label = options.label ?? path.basename(filePath);
  const existingSize = await fileSize(filePath);
  const nextSize = Buffer.byteLength(body, "utf8");
  if (existingSize >= 400 && nextSize < Math.max(80, existingSize * 0.2)) {
    console.warn(
      `learning-persist: refuse shrink ${label} (${existingSize}→${nextSize} bytes)`,
    );
    return false;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  const { rename } = await import("node:fs/promises");
  await rename(tmp, filePath);
  return true;
}

async function copyIfNewerOrMissing(
  fromPath: string,
  toPath: string,
): Promise<"copied" | "skipped" | "missing"> {
  const fromSize = await fileSize(fromPath);
  if (fromSize <= 0) return "missing";
  const toSize = await fileSize(toPath);
  // Restore when missing, or when seed/mirror is meaningfully richer.
  if (toSize > 0 && toSize >= fromSize * 0.9) return "skipped";
  await mkdir(path.dirname(toPath), { recursive: true });
  await copyFile(fromPath, toPath);
  return "copied";
}

/**
 * On boot: fill CACHE_DIR from seed (image/git) and Disk mirror when cache is empty/thin.
 */
export async function restoreLearningCache(): Promise<{
  fromSeed: string[];
  fromMirror: string[];
}> {
  const cacheDir = getCacheDir();
  const seedDir = getLearningSeedDir();
  const mirrorDir = getLearningMirrorDir();
  await mkdir(cacheDir, { recursive: true });

  const fromMirror: string[] = [];
  const fromSeed: string[] = [];

  for (const name of LEARNING_FILE_NAMES) {
    const cachePath = path.join(cacheDir, name);
    const mirrorPath = path.join(mirrorDir, name);
    const seedPath = path.join(seedDir, name);

    const mirrored = await copyIfNewerOrMissing(mirrorPath, cachePath);
    if (mirrored === "copied") {
      fromMirror.push(name);
      continue;
    }
    const seeded = await copyIfNewerOrMissing(seedPath, cachePath);
    if (seeded === "copied") fromSeed.push(name);
  }

  if (fromMirror.length || fromSeed.length) {
    console.info(
      `learning-persist: restored cache` +
        (fromMirror.length ? ` mirror=[${fromMirror.join(",")}]` : "") +
        (fromSeed.length ? ` seed=[${fromSeed.join(",")}]` : ""),
    );
  }
  return { fromSeed, fromMirror };
}

/**
 * After learning: mirror CACHE_DIR → Disk mirror and seed dir (when writable).
 * Seed updates persist across redeploys only when committed/baked into the image,
 * or when LEARNING_SEED_DIR points at durable storage.
 */
export async function mirrorLearningCache(): Promise<{
  mirrored: string[];
  seeded: string[];
}> {
  const cacheDir = getCacheDir();
  const seedDir = getLearningSeedDir();
  const mirrorDir = getLearningMirrorDir();
  const mirrored: string[] = [];
  const seeded: string[] = [];

  await mkdir(mirrorDir, { recursive: true });

  for (const name of LEARNING_FILE_NAMES) {
    const cachePath = path.join(cacheDir, name);
    const cacheSize = await fileSize(cachePath);
    if (cacheSize <= 0) continue;

    const mirrorPath = path.join(mirrorDir, name);
    const mirrorSize = await fileSize(mirrorPath);
    if (cacheSize > mirrorSize) {
      await copyFile(cachePath, mirrorPath);
      mirrored.push(name);
    }

    try {
      await mkdir(seedDir, { recursive: true });
      const seedPath = path.join(seedDir, name);
      const seedSize = await fileSize(seedPath);
      if (cacheSize > seedSize) {
        await copyFile(cachePath, seedPath);
        seeded.push(name);
      }
    } catch (error) {
      // Image layers may be read-only; Disk mirror still keeps a copy.
      if (seeded.length === 0 && name === LEARNING_FILE_NAMES[0]) {
        console.warn(
          "learning-persist: seed dir not writable",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (mirrored.length || seeded.length) {
    console.info(
      `learning-persist: mirrored` +
        (mirrored.length ? ` disk=[${mirrored.join(",")}]` : "") +
        (seeded.length ? ` seed=[${seeded.join(",")}]` : ""),
    );
  }
  return { mirrored, seeded };
}

/** Snapshot CACHE_DIR learning files into the repo seed directory (CLI / deploy prep). */
export async function snapshotLearningToSeed(): Promise<string[]> {
  const cacheDir = getCacheDir();
  const seedDir = getLearningSeedDir();
  await mkdir(seedDir, { recursive: true });
  const copied: string[] = [];
  for (const name of LEARNING_FILE_NAMES) {
    const cachePath = path.join(cacheDir, name);
    if ((await fileSize(cachePath)) <= 0) continue;
    await copyFile(cachePath, path.join(seedDir, name));
    copied.push(name);
  }
  return copied;
}

export async function readLearningFile(name: LearningFileName): Promise<string | null> {
  try {
    return await readFile(path.join(getCacheDir(), name), "utf8");
  } catch {
    return null;
  }
}
