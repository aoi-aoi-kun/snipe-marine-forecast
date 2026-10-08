#!/usr/bin/env node
/**
 * Copy runtime learning files from .cache (or CACHE_DIR) into data/learning-seed
 * so the next Docker image / git commit keeps them across redeploys.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const FILES = [
  "nowcast-calib.json",
  "harbor-patterns.json",
  "pattern-forecast-calib.json",
  "nowcast-pattern-blend-calib.json",
  "mos.json",
  "mos-offshore-hours.json",
  "meta-calib.json",
  "skill-history.json",
  "ops.json",
];

const cacheDir = process.env.CACHE_DIR
  ? path.resolve(process.env.CACHE_DIR)
  : path.join(process.cwd(), ".cache");
const seedDir = process.env.LEARNING_SEED_DIR
  ? path.resolve(process.env.LEARNING_SEED_DIR)
  : path.join(process.cwd(), "data", "learning-seed");

await mkdir(seedDir, { recursive: true });
const copied = [];
for (const name of FILES) {
  const from = path.join(cacheDir, name);
  try {
    const size = (await stat(from)).size;
    if (size <= 0) continue;
    await copyFile(from, path.join(seedDir, name));
    copied.push(`${name} (${size} B)`);
  } catch {
    // skip missing
  }
}
console.log(`learning seed ← ${cacheDir}`);
console.log(`learning seed → ${seedDir}`);
console.log(copied.length ? copied.map((line) => `  ${line}`).join("\n") : "  (nothing copied)");
