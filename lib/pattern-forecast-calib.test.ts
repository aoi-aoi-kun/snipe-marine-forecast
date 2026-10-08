import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPatternForecastCalib,
  fitPatternForecastCalib,
  observedRampOutcome,
  verifyPendingForecasts,
  type PatternForecastCase,
} from "./pattern-forecast-calib";
import type { HarborSample } from "./enowin";

function sample(atMs: number, meanMs: number, maxMs = meanMs + 1): HarborSample {
  return { atMs, meanMs, maxMs, fromLabel: "南", fromDeg: 180 };
}

function pending(partial: Partial<PatternForecastCase> = {}): PatternForecastCase {
  return {
    atMs: 1_000_000,
    horizonMinutes: 30,
    currentMeanMs: 4,
    score: 0.8,
    rawRiseMs: 3,
    rawPeakMs: 7,
    rawMaxMs: 8,
    expectedRiseMs: 3,
    expectedPeakMs: 7,
    expectedMaxMs: 8,
    actualRiseMs: null,
    actualPeakMs: null,
    actualMaxMs: null,
    verifiedAtMs: null,
    source: "live",
    ...partial,
  };
}

describe("pattern forecast calib", () => {
  it("measures observed peak and rise inside the horizon", () => {
    const start = 1_000_000;
    const samples = [
      sample(start, 4),
      sample(start + 10 * 60_000, 5.5),
      sample(start + 20 * 60_000, 7.2),
      sample(start + 25 * 60_000, 6.8, 9),
    ];
    const out = observedRampOutcome(samples, start, start + 30 * 60_000, 4);
    assert.ok(out);
    assert.equal(out.actualPeakMs, 7.2);
    assert.ok(Math.abs(out.actualRiseMs - 3.2) < 1e-9);
    assert.equal(out.actualMaxMs, 9);
  });

  it("verifies pending forecasts after the horizon", () => {
    const item = pending();
    const end = item.atMs + item.horizonMinutes * 60_000;
    const samples = [
      sample(item.atMs, 4),
      sample(item.atMs + 15 * 60_000, 6),
      sample(end - 60_000, 7.5, 9),
    ];
    const { stillPending, newlyVerified } = verifyPendingForecasts(
      [item],
      samples,
      end + 6 * 60_000,
    );
    assert.equal(stillPending.length, 0);
    assert.equal(newlyVerified.length, 1);
    assert.equal(newlyVerified[0].actualPeakMs, 7.5);
  });

  it("fits a rise scale below 1 when analogs overshoot", () => {
    const cases = Array.from({ length: 12 }, (_, index) =>
      pending({
        atMs: 1_000_000 + index * 86_400_000,
        rawRiseMs: 4,
        actualRiseMs: 2,
        actualPeakMs: 6,
        actualMaxMs: 7,
        verifiedAtMs: 2_000_000 + index * 86_400_000,
        currentMeanMs: 4,
        source: "retrospective",
      }),
    );
    const fit = fitPatternForecastCalib(cases, 3_000_000 + 20 * 86_400_000);
    assert.equal(fit.calibrated, true);
    assert.ok(fit.riseScale < 0.9);
  });

  it("applies calibrated scale to a raw estimate", () => {
    const calibrated = applyPatternForecastCalib(
      { expectedRiseMs: 4, expectedPeakMs: 8, expectedMaxMs: 9, horizonMinutes: 30 },
      4,
      { riseScale: 0.5, peakBiasMs: 0, maxBiasMs: 0, calibrated: true },
    );
    assert.equal(calibrated.expectedRiseMs, 2);
    assert.equal(calibrated.expectedPeakMs, 6);
  });
});
