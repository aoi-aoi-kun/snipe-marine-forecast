import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateFromMatchedEvent, type PatternEvent } from "./pattern";

function event(partial: Partial<PatternEvent> = {}): PatternEvent {
  return {
    atMs: Date.parse("2026-10-01T03:00:00Z"),
    hourBucket: 4,
    dirSector: 2,
    beforeMeanMs: 3,
    peakMeanMs: 7.5,
    riseMs: 4.5,
    riseMinutes: 28,
    offshoreMeanMs: 5,
    boostFactor: 1.3,
    ...partial,
  };
}

describe("estimateFromMatchedEvent", () => {
  it("projects rise and peak from the analog onto current mean", () => {
    const out = estimateFromMatchedEvent(4.0, event(), 0.9);
    assert.ok(out.expectedRiseMs >= 3);
    assert.ok(out.expectedRiseMs <= 4.5);
    assert.equal(out.expectedPeakMs, Math.round((4 + out.expectedRiseMs) * 10) / 10);
    assert.ok(out.expectedMaxMs >= out.expectedPeakMs);
    assert.equal(out.horizonMinutes, 28);
  });

  it("softens the rise when the match score is weaker", () => {
    const strong = estimateFromMatchedEvent(4.0, event(), 1);
    const weak = estimateFromMatchedEvent(4.0, event(), 0.5);
    assert.ok(weak.expectedRiseMs < strong.expectedRiseMs);
  });
});
