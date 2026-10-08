import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectMosMetaCases,
  dampenFactor,
  fitLambda,
  type MetaCase,
} from "./meta-calib";
import { ingestMosPairs, type MosStore } from "./mos";

describe("meta calibration", () => {
  it("dampenFactor shrinks the gain toward 1", () => {
    assert.equal(dampenFactor(1.4, 1), 1.4);
    assert.equal(dampenFactor(1.4, 0.5), 1.2);
    assert.equal(dampenFactor(1.4, 0), 1);
    assert.ok(Math.abs(dampenFactor(0.8, 0.5) - 0.9) < 1e-9);
  });

  it("fitLambda prefers partial gain when full factor overshoots", () => {
    // Offshore 4, full f=1.5 → 6, but harbor stayed near 5 → best λ around 0.5
    const cases: MetaCase[] = Array.from({ length: 16 }, (_, index) => ({
      atMs: 1_000_000 + index * 3 * 3600_000,
      baseMs: 4,
      rawFactor: 1.5,
      actualMs: 5,
    }));
    const fit = fitLambda(cases);
    assert.ok(fit.lambda > 0.3 && fit.lambda < 0.7);
    assert.ok(fit.mae < 0.2);
  });

  it("collectMosMetaCases builds cases from stored MOS pairs", () => {
    const start = Date.parse("2026-10-06T00:00:00+09:00");
    const pairs = Array.from({ length: 6 }, (_, index) => ({
      windowStart: start + index * 24 * 3600_000,
      harborMeanMs: 5,
      harborMaxMs: 7,
      harborFromDeg: 180,
      offshoreMeanMs: 4,
      offshoreGustMs: 6,
      offshoreFromDeg: 180,
      ratio: 1.25,
      biasMs: 1,
    }));
    const store: MosStore = ingestMosPairs(
      { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] },
      pairs,
    );
    const cases = collectMosMetaCases(store);
    assert.ok(cases.length >= 4);
    assert.ok(cases.every((item) => item.rawFactor > 1));
  });
});
