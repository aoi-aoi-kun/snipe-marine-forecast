import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HourSample, WindowForecast } from "./aggregate";
import { attachCycleSpread } from "./cycle-spread";

describe("cycle spread", () => {
  it("attaches absolute wind difference vs the previous cycle", () => {
    const start = Date.parse("2026-10-07T00:00:00.000Z");
    const current: HourSample[] = [
      {
        validMs: start,
        tempC: 20,
        u: 6,
        v: 0,
        cloudPct: 10,
        precipRunMm: 0,
        gustMs: 8,
      },
    ];
    const previous: HourSample[] = [
      {
        validMs: start,
        tempC: 20,
        u: 4,
        v: 0,
        cloudPct: 10,
        precipRunMm: 0,
        gustMs: 6,
      },
    ];
    const windows: WindowForecast[] = [
      {
        start: new Date(start).toISOString(),
        end: new Date(start + 3 * 3600_000).toISOString(),
        partialFrom: null,
        available: true,
        weather: "晴れ",
        precipMm: 0,
        tempMinC: 20,
        tempMaxC: 20,
        windFromDeg: 270,
        windFromLabel: "西",
        windMeanMs: 6,
        windMaxMs: 6,
        windGustMs: 8,
        noDeparture: false,
        cycleSpreadMs: null,
      },
    ];
    const out = attachCycleSpread(windows, current, previous);
    assert.ok(out[0].cycleSpreadMs !== null && out[0].cycleSpreadMs !== undefined);
    assert.ok(Math.abs((out[0].cycleSpreadMs as number) - 2) < 0.01);
  });
});
