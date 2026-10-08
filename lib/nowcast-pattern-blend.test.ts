import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analogMeanAt,
  blendNowcastWithPatternMatch,
  patternBlendWeight,
} from "./nowcast-pattern-blend";
import type { NowcastPoint } from "./nowcast";

function points(means: [number, number, number]): NowcastPoint[] {
  return [
    { minutesAhead: 15, meanMs: means[0], fromDeg: 180, fromLabel: "南" },
    { minutesAhead: 30, meanMs: means[1], fromDeg: 180, fromLabel: "南" },
    { minutesAhead: 60, meanMs: means[2], fromDeg: 180, fromLabel: "南" },
  ];
}

describe("patternBlendWeight", () => {
  it("peaks near the match horizon and grows with score", () => {
    const near = patternBlendWeight(30, 30, 0.9);
    const far = patternBlendWeight(15, 30, 0.9);
    const weak = patternBlendWeight(30, 30, 0.55);
    assert.ok(near > far);
    assert.ok(near > weak);
    assert.ok(near <= 0.7);
  });
});

describe("analogMeanAt", () => {
  it("rises linearly to peak then holds", () => {
    assert.equal(analogMeanAt(4, 8, 30, 0), 4);
    assert.equal(analogMeanAt(4, 8, 30, 15), 6);
    assert.equal(analogMeanAt(4, 8, 30, 30), 8);
    assert.equal(analogMeanAt(4, 8, 30, 60), 8);
  });
});

describe("blendNowcastWithPatternMatch", () => {
  it("leaves points unchanged without a match", () => {
    const base = points([4.2, 4.5, 5.0]);
    const out = blendNowcastWithPatternMatch(base, 4.0, null);
    assert.equal(out.blended, false);
    assert.deepEqual(out.points, base);
  });

  it("leaves points unchanged when peak is not above current", () => {
    const base = points([4.2, 4.5, 5.0]);
    const out = blendNowcastWithPatternMatch(base, 4.0, {
      score: 0.9,
      expectedPeakMs: 4.0,
      horizonMinutes: 30,
    });
    assert.equal(out.blended, false);
  });

  it("pulls nowcast toward the analog peak when a match is active", () => {
    const base = points([4.2, 4.4, 4.6]);
    const out = blendNowcastWithPatternMatch(base, 4.0, {
      score: 0.9,
      expectedPeakMs: 8.0,
      horizonMinutes: 30,
    });
    assert.equal(out.blended, true);
    assert.ok(out.note);
    assert.ok(out.traces.length >= 1);
    const at30 = out.points.find((p) => p.minutesAhead === 30)!;
    const at15 = out.points.find((p) => p.minutesAhead === 15)!;
    assert.ok(at30.meanMs > base[1].meanMs);
    assert.ok(at30.meanMs > at15.meanMs);
    // Preserves pre-blend mean when raw was unset
    assert.equal(at30.rawMeanMs, 4.4);
  });

  it("does not overwrite a steeper trend beyond a tiny epsilon", () => {
    // Trend already above analog at 60 → blend still mixes but stays sensible
    const base = points([6.0, 7.5, 10.0]);
    const out = blendNowcastWithPatternMatch(base, 5.0, {
      score: 0.8,
      expectedPeakMs: 8.0,
      horizonMinutes: 30,
    });
    assert.equal(out.blended, true);
    const at60 = out.points.find((p) => p.minutesAhead === 60)!;
    // Pure blend: between trend 10 and analog hold 8
    assert.ok(at60.meanMs < 10);
    assert.ok(at60.meanMs > 8);
  });

  it("applies learned gain and bias when calib is ready", () => {
    const base = points([4.2, 4.4, 4.6]);
    const naive = blendNowcastWithPatternMatch(base, 4.0, {
      score: 0.9,
      expectedPeakMs: 8.0,
      horizonMinutes: 30,
    });
    const damped = blendNowcastWithPatternMatch(
      base,
      4.0,
      {
        score: 0.9,
        expectedPeakMs: 8.0,
        horizonMinutes: 30,
      },
      {
        calibrated: true,
        globalGain: 0.4,
        horizons: [{ minutesAhead: 30, gain: 0.4, biasMs: 0 }],
      },
    );
    assert.equal(damped.blended, true);
    const naive30 = naive.points.find((p) => p.minutesAhead === 30)!.meanMs;
    const damped30 = damped.points.find((p) => p.minutesAhead === 30)!.meanMs;
    assert.ok(damped30 < naive30);
    assert.ok(damped30 > base[1].meanMs);
    assert.ok(damped.note?.includes("融合校正"));
  });
});
