import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

describe("learning-persist", () => {
  let root = "";
  let cacheDir = "";
  let seedDir = "";
  let mirrorDir = "";
  let restoreLearningCache: typeof import("./learning-persist").restoreLearningCache;
  let mirrorLearningCache: typeof import("./learning-persist").mirrorLearningCache;
  let writeProtectedJson: typeof import("./learning-persist").writeProtectedJson;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "learn-persist-"));
    cacheDir = path.join(root, "cache");
    seedDir = path.join(root, "seed");
    mirrorDir = path.join(root, "mirror");
    process.env.CACHE_DIR = cacheDir;
    process.env.LEARNING_SEED_DIR = seedDir;
    process.env.LEARNING_MIRROR_DIR = mirrorDir;
    const mod = await import("./learning-persist");
    restoreLearningCache = mod.restoreLearningCache;
    mirrorLearningCache = mod.mirrorLearningCache;
    writeProtectedJson = mod.writeProtectedJson;
  });

  after(async () => {
    delete process.env.CACHE_DIR;
    delete process.env.LEARNING_SEED_DIR;
    delete process.env.LEARNING_MIRROR_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it("restores from seed, mirrors to disk, and refuses shrink", async () => {
    await mkdir(seedDir, { recursive: true });
    const rich = JSON.stringify({
      cases: new Array(50).fill({ atMs: 1 }),
      horizons: [1, 2, 3],
    });
    await writeFile(path.join(seedDir, "nowcast-calib.json"), rich);

    const restored = await restoreLearningCache();
    assert.ok(restored.fromSeed.includes("nowcast-calib.json"));
    assert.equal(await readFile(path.join(cacheDir, "nowcast-calib.json"), "utf8"), rich);

    const mirrored = await mirrorLearningCache();
    assert.ok(mirrored.mirrored.includes("nowcast-calib.json"));
    assert.equal(await readFile(path.join(mirrorDir, "nowcast-calib.json"), "utf8"), rich);

    const refused = await writeProtectedJson(path.join(cacheDir, "nowcast-calib.json"), "{}");
    assert.equal(refused, false);
    assert.equal(await readFile(path.join(cacheDir, "nowcast-calib.json"), "utf8"), rich);

    const ok = await writeProtectedJson(
      path.join(cacheDir, "nowcast-calib.json"),
      JSON.stringify({ cases: new Array(60).fill({ atMs: 2 }), horizons: [1, 2, 3] }),
    );
    assert.equal(ok, true);
  });
});
