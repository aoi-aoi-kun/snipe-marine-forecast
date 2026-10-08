import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectMosMetaCases,
  dampenFactor,
  fitLambda,
  lambdaForMosWindow,
  rebuildMosLambdaBins,
  speedBandOf,
  type MetaCase,
  type MetaCalibStore,
} from "./meta-calib";
import { ingestMosPairs, type MosStore } from "./mos";
import type { WindowForecast } from "./aggregate";

describe("meta calibration", () => {
  it("dampenFactor shrinks the gain toward 1", () => {
    assert.equal(dampenFactor(1.4, 1), 1.4);
    assert.equal(dampenFactor(1.4, 0.5), 1.2);
    assert.equal(dampenFactor(1.4, 0), 1);
    assert.ok(Math.abs(dampenFactor(0.8, 0.5) - 0.9) < 1e-9);
  });

  it("fitLambda prefers partial gain when full factor overshoots", () => {
    const cases: MetaCase[] = Array.from({ length: 16 }, (_, index) => ({
      atMs: 1_000_000 + index * 3 * 3600_000,
      baseMs: 4,
      rawFactor: 1.5,
      actualMs: 5,
      hourBucket: 0,
      speedBand: "mod" as const,
    }));
    const fit = fitLambda(cases);
    assert.ok(fit.lambda > 0.3 && fit.lambda < 0.7);
    assert.ok(fit.mae < 0.2);
  });

  it("fitLambda prefers lower λ when MAE is nearly tied", () => {
    // actual ≈ base (no gain needed): many λ values fit similarly → pick the smaller one.
    const cases: MetaCase[] = Array.from({ length: 20 }, (_, index) => ({
      atMs: 1_000_000 + index * 3 * 3600_000,
      baseMs: 5,
      rawFactor: 1.4,
      actualMs: 5,
      hourBucket: 0,
      speedBand: "mod" as const,
    }));
    const fit = fitLambda(cases);
    assert.ok(fit.lambda <= 0.15);
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
      gustRatio: 1.2,
      biasMs: 1,
    }));
    const store: MosStore = ingestMosPairs(
      { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] },
      pairs,
    );
    const cases = collectMosMetaCases(store);
    assert.ok(cases.length >= 4);
    assert.ok(cases.every((item) => item.rawFactor > 1));
    assert.ok(cases.every((item) => item.speedBand === speedBandOf(4)));
  });

  it("resolves scenario lambda bins by hour and speed band", () => {
    const cases: MetaCase[] = Array.from({ length: 10 }, (_, index) => ({
      atMs: Date.parse("2026-10-06T00:00:00+09:00") + index * 24 * 3600_000,
      baseMs: 9,
      rawFactor: 1.5,
      actualMs: 10.5,
      hourBucket: 0,
      speedBand: "strong" as const,
    }));
    const bins = rebuildMosLambdaBins(cases);
    assert.ok(bins.some((bin) => bin.key === "h0:sstrong"));
    const store: MetaCalibStore = {
      updatedAt: 0,
      mosCases: cases,
      patternCases: [],
      mosLambda: 1,
      patternLambda: 1,
      mosMae: 0,
      patternMae: 0,
      mosBins: bins,
    };
    const window: WindowForecast = {
      start: new Date(Date.parse("2026-10-06T00:00:00+09:00")).toISOString(),
      end: new Date(Date.parse("2026-10-06T03:00:00+09:00")).toISOString(),
      partialFrom: null,
      available: true,
      weather: "晴れ",
      precipMm: 0,
      tempMinC: 20,
      tempMaxC: 21,
      windFromDeg: 180,
      windFromLabel: "南",
      windMeanMs: 9,
      windMaxMs: 9,
      windGustMs: 11,
      noDeparture: false,
    };
    const lambda = lambdaForMosWindow(store, window);
    assert.ok(lambda < 1);
  });
});
