import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HarborSample } from "./enowin";
import { buildNowcast } from "./nowcast";
import {
  collectNowcastCases,
  fitHorizon,
  rebuildCalib,
} from "./nowcast-learn";

function series(hours: number, startMs: number, base: number, slopePerHour: number): HarborSample[] {
  const samples: HarborSample[] = [];
  const points = hours * 12;
  for (let i = 0; i < points; i++) {
    const hour = i / 12;
    samples.push({
      atMs: startMs + i * 5 * 60_000,
      meanMs: Math.max(0, base + slopePerHour * hour),
      maxMs: Math.max(0, base + slopePerHour * hour + 1.5),
      fromLabel: "南",
      fromDeg: 180,
    });
  }
  return samples;
}

describe("nowcast learning", () => {
  it("collects verification cases and learns dampening under 1", () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    // Rising then flattening — pure linear extrapolation overshoots.
    const samples: HarborSample[] = [];
    for (let i = 0; i < 48 * 12; i++) {
      const t = i / 12;
      const mean = t < 24 ? 3 + 0.25 * t : 9 - 0.05 * (t - 24);
      samples.push({
        atMs: start + i * 5 * 60_000,
        meanMs: Math.max(0.5, mean),
        maxMs: Math.max(1, mean + 1),
        fromLabel: "南",
        fromDeg: 180,
      });
    }
    const cases = collectNowcastCases(samples);
    assert.ok(cases.length > 50);
    const calib = rebuildCalib(cases);
    assert.ok(calib.horizons.some((item) => item.minutesAhead === 60));
    const h60 = calib.horizons.find((item) => item.minutesAhead === 60);
    assert.ok(h60);
    assert.ok(h60.dampen >= 0 && h60.dampen <= 1);
    assert.ok(h60.count >= 24);
    assert.ok(h60.maeCalibrated <= h60.maeRaw + 0.05);
  });

  it("calibrated nowcast pulls extreme linear projection inward", () => {
    const start = Date.parse("2026-10-05T00:00:00Z");
    const samples = series(36, start, 4, 0.2);
    const cases = collectNowcastCases(samples);
    const rebuilt = rebuildCalib(cases);
    const store = {
      updatedAt: Date.now(),
      lastDeepLearnAt: Date.now(),
      cases,
      horizons: rebuilt.horizons,
      risingHorizons: rebuilt.risingHorizons,
    };
    // Force a strong recent rise
    const rising = Array.from({ length: 8 }, (_, index) => ({
      atMs: start + 35 * 3600_000 + index * 5 * 60_000,
      meanMs: 6 + index * 0.8,
      maxMs: 8 + index * 0.8,
      fromLabel: "南" as const,
      fromDeg: 180,
    }));
    const all = [...samples, ...rising];
    const raw = buildNowcast(rising, rising[rising.length - 1].atMs + 60_000, null);
    const cal = buildNowcast(rising, rising[rising.length - 1].atMs + 60_000, store);
    assert.equal(cal.calibrated, rebuilt.horizons.length === 3);
    if (raw.nowcast.length && cal.nowcast.length) {
      const raw60 = raw.nowcast.find((point) => point.minutesAhead === 60);
      const cal60 = cal.nowcast.find((point) => point.minutesAhead === 60);
      assert.ok(raw60 && cal60);
      // With dampen < 1, calibrated 60-min should be closer to current than raw when rising fast
      if (rebuilt.horizons.find((item) => item.minutesAhead === 60)!.dampen < 0.95) {
        assert.ok(cal60.meanMs <= raw60.meanMs + 0.05);
      }
    }
    void all;
    const fitted = fitHorizon(cases.filter((item) => item.minutesAhead === 30));
    assert.ok(fitted === null || fitted.count >= 24);
  });

  it("fits a rising regime that keeps some trend dampen", () => {
    const start = Date.parse("2026-09-01T00:00:00Z");
    const samples: HarborSample[] = [];
    // Alternating quiet and ramp days so rising subset is large enough.
    for (let day = 0; day < 10; day++) {
      for (let i = 0; i < 24 * 12; i++) {
        const hour = i / 12;
        const ramp = hour >= 10 && hour <= 14;
        const mean = ramp ? 3 + (hour - 10) * 1.4 : 2.5 + 0.05 * Math.sin(hour);
        samples.push({
          atMs: start + (day * 24 * 12 + i) * 5 * 60_000,
          meanMs: Math.max(0.5, mean),
          maxMs: Math.max(1, mean + 1),
          fromLabel: "南",
          fromDeg: 180,
        });
      }
    }
    const cases = collectNowcastCases(samples);
    const rebuilt = rebuildCalib(cases);
    assert.ok(rebuilt.risingHorizons.length >= 1);
    for (const row of rebuilt.risingHorizons) {
      assert.ok(row.dampen >= 0.35);
    }
  });
});
