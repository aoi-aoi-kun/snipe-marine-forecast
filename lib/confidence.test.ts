import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessWindowConfidence } from "./confidence";
import type { WindowForecast } from "./aggregate";
import { HOUR_MS } from "./time";

function window(partial: Partial<WindowForecast> & { start: string }): WindowForecast {
  return {
    end: new Date(Date.parse(partial.start) + 3 * HOUR_MS).toISOString(),
    partialFrom: null,
    available: true,
    weather: "晴れ",
    precipMm: 0,
    tempMinC: 20,
    tempMaxC: 21,
    windFromDeg: 180,
    windFromLabel: "南",
    windMeanMs: 5,
    windMaxMs: 5,
    windGustMs: 7,
    noDeparture: false,
    cycleSpreadMs: null,
    ...partial,
  };
}

describe("window confidence", () => {
  it("marks near quiet windows as higher confidence than far/spread ones", () => {
    const now = Date.parse("2026-10-08T00:00:00.000Z");
    const near = assessWindowConfidence(
      window({ start: new Date(now + 3 * HOUR_MS).toISOString(), cycleSpreadMs: 0.2 }),
      now,
    );
    const far = assessWindowConfidence(
      window({
        start: new Date(now + 100 * HOUR_MS).toISOString(),
        cycleSpreadMs: 3.2,
        harborAdjusted: true,
      }),
      now,
    );
    assert.equal(near.level, "high");
    assert.equal(far.level, "low");
    assert.ok(near.score > far.score);
  });
});
