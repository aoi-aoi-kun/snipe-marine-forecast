import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WindowForecast } from "./aggregate";
import {
  blendNearWindowsTowardHarbor,
  nearHarborBlendWeight,
} from "./harbor-blend";

function window(startIso: string, mean: number, gust: number): WindowForecast {
  const start = Date.parse(startIso);
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 3 * 3600_000).toISOString(),
    partialFrom: null,
    available: true,
    weather: "晴れ",
    precipMm: 0,
    tempMinC: 20,
    tempMaxC: 21,
    windFromDeg: 180,
    windFromLabel: "南",
    windMeanMs: mean,
    windMaxMs: mean,
    windGustMs: gust,
    noDeparture: false,
  };
}

describe("harbor near blend", () => {
  it("decays weight with lead time", () => {
    const now = Date.parse("2026-10-08T12:00:00+09:00");
    assert.ok(nearHarborBlendWeight(now - 3600_000, now) > 0.3);
    assert.ok(nearHarborBlendWeight(now + 2 * 3600_000, now) > 0.2);
    assert.ok(nearHarborBlendWeight(now + 5 * 3600_000, now) > 0);
    assert.equal(nearHarborBlendWeight(now + 9 * 3600_000, now), 0);
  });

  it("pulls the current window toward harbor and skips far ones", () => {
    const now = Date.parse("2026-10-08T12:00:00+09:00");
    const windows = [
      window("2026-10-08T12:00:00+09:00", 4, 5),
      window("2026-10-08T21:00:00+09:00", 4, 5),
    ];
    const blended = blendNearWindowsTowardHarbor(
      windows,
      { meanMs: 8, maxMs: 10 },
      now,
      false,
    );
    assert.ok((blended[0].windMeanMs ?? 0) > 4.5);
    assert.match(blended[0].mosAdjustNote ?? "", /実況寄り/);
    assert.equal(blended[1].windMeanMs, 4);
  });

  it("skips blend when source is stale", () => {
    const now = Date.parse("2026-10-08T12:00:00+09:00");
    const windows = [window("2026-10-08T12:00:00+09:00", 4, 5)];
    const blended = blendNearWindowsTowardHarbor(
      windows,
      { meanMs: 8, maxMs: 10 },
      now,
      true,
    );
    assert.equal(blended[0].windMeanMs, 4);
  });
});
