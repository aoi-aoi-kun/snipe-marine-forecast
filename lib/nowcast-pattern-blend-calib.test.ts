import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fitBlendCalib,
  fitBlendHorizon,
  verifyPendingBlendCases,
  type BlendCalibCase,
} from "./nowcast-pattern-blend-calib";
import type { HarborSample } from "./enowin";

function caseAt(
  minutesAhead: 15 | 30 | 60,
  overrides: Partial<BlendCalibCase> = {},
): BlendCalibCase {
  return {
    atMs: 1_700_000_000_000,
    minutesAhead,
    currentMeanMs: 4,
    nowcastMeanMs: 4.5,
    analogMeanMs: 8,
    baseWeight: 0.5,
    score: 0.85,
    expectedPeakMs: 8,
    matchHorizonMinutes: 30,
    actualMeanMs: 6.5,
    verifiedAtMs: 1_700_000_000_000 + 60 * 60_000,
    source: "retrospective",
    ...overrides,
  };
}

describe("fitBlendHorizon", () => {
  it("pulls gain toward the ideal mix when blend overshoots", () => {
    // Ideal mix ≈ 6.5 = 0.5*nowcast + 0.5*analog at weight 0.5 → gain≈1
    // Overshoot actual closer to nowcast → lower gain
    const cases = Array.from({ length: 10 }, (_, index) =>
      caseAt(30, {
        atMs: 1_700_000_000_000 + index * 86_400_000,
        verifiedAtMs: 1_700_000_000_000 + index * 86_400_000 + 3600_000,
        actualMeanMs: 5.0,
      }),
    );
    const fit = fitBlendHorizon(cases, 30, Date.now());
    assert.ok(fit);
    assert.ok(fit.gain < 1);
    assert.ok(fit.maeCalibrated <= fit.maeNaiveBlend + 0.05);
  });
});

describe("fitBlendCalib", () => {
  it("stays uncalibrated until enough cases exist", () => {
    const fit = fitBlendCalib([caseAt(15), caseAt(30)], Date.now());
    assert.equal(fit.calibrated, false);
    assert.equal(fit.globalGain, 1);
  });

  it("calibrates when enough verified cases are present", () => {
    const cases: BlendCalibCase[] = [];
    for (let index = 0; index < 8; index++) {
      cases.push(
        caseAt(15, {
          atMs: 1_700_000_000_000 + index * 86_400_000,
          verifiedAtMs: 1_700_000_000_000 + index * 86_400_000 + 3600_000,
          actualMeanMs: 5.2,
        }),
      );
      cases.push(
        caseAt(30, {
          atMs: 1_700_000_000_000 + index * 86_400_000,
          verifiedAtMs: 1_700_000_000_000 + index * 86_400_000 + 3600_000,
          actualMeanMs: 6.0,
        }),
      );
    }
    const fit = fitBlendCalib(cases, Date.now());
    assert.equal(fit.calibrated, true);
    assert.ok(fit.horizons.length >= 1);
    assert.ok(fit.globalGain >= 0.35 && fit.globalGain <= 1.35);
  });
});

describe("verifyPendingBlendCases", () => {
  it("verifies when a sample appears near the target time", () => {
    const atMs = Date.parse("2024-06-01T00:00:00Z");
    const pending: BlendCalibCase[] = [
      caseAt(15, {
        atMs,
        actualMeanMs: null,
        verifiedAtMs: null,
        source: "live",
      }),
    ];
    const samples: HarborSample[] = [
      {
        atMs: atMs + 15 * 60_000,
        meanMs: 6.2,
        maxMs: 7.1,
        fromDeg: 180,
        fromLabel: "南",
      },
    ];
    const out = verifyPendingBlendCases(pending, samples, atMs + 25 * 60_000);
    assert.equal(out.newlyVerified.length, 1);
    assert.equal(out.newlyVerified[0].actualMeanMs, 6.2);
    assert.equal(out.stillPending.length, 0);
  });
});
