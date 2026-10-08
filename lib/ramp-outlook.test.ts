import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PatternForecastCase } from "./pattern-forecast-calib";
import { estimateRampOutlook, formatRampOutlookLine } from "./ramp-outlook";

function caseAt(
  score: number,
  actualRiseMs: number,
  actualPeakMs: number,
  atMs: number,
): PatternForecastCase {
  return {
    atMs,
    horizonMinutes: 30,
    currentMeanMs: 4,
    score,
    rawRiseMs: 3,
    rawPeakMs: 7,
    rawMaxMs: 8,
    expectedRiseMs: 3,
    expectedPeakMs: 7,
    expectedMaxMs: 8,
    actualRiseMs,
    actualPeakMs,
    actualMaxMs: actualPeakMs + 0.5,
    verifiedAtMs: atMs,
    source: "retrospective",
  };
}

describe("estimateRampOutlook", () => {
  it("returns null probs until enough support", () => {
    const out = estimateRampOutlook(0.8, [caseAt(0.8, 3, 8, 1)]);
    assert.equal(out.pRiseGe25, null);
    assert.ok(out.support < 8);
  });

  it("estimates higher rise probability when similar cases rose", () => {
    const cases = Array.from({ length: 12 }, (_, i) =>
      caseAt(0.85, i < 9 ? 3.5 : 0.5, i < 3 ? 11 : 7, 1000 + i),
    );
    const out = estimateRampOutlook(0.85, cases);
    assert.ok(out.pRiseGe25 != null && out.pRiseGe25 > 0.6);
    assert.ok(out.pPeakGe10 != null && out.pPeakGe10 < 0.5);
    assert.ok(formatRampOutlookLine(out));
  });
});
