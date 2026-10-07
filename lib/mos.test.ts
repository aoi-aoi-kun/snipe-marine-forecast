import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HourSample, WindowForecast } from "./aggregate";
import {
  applyMosCorrection,
  buildMosPairs,
  correctionForWindow,
  ingestMosPairs,
  rebuildMosBins,
  type MosStore,
} from "./mos";
import type { HarborSample } from "./enowin";

function hour(validMs: number, speed: number, fromDeg = 180): HourSample {
  const rad = ((270 - fromDeg) * Math.PI) / 180;
  return {
    validMs,
    tempC: 20,
    u: speed * Math.cos(rad),
    v: speed * Math.sin(rad),
    cloudPct: 10,
    precipRunMm: 0,
    gustMs: speed + 2,
  };
}

describe("MOS pairing", () => {
  it("pairs completed 3-hour windows of harbor vs offshore", () => {
    const start = Date.parse("2026-10-06T00:00:00+09:00");
    const harbor: HarborSample[] = [];
    for (let i = 0; i < 12; i++) {
      harbor.push({
        atMs: start + i * 5 * 60_000,
        meanMs: 6,
        maxMs: 8,
        fromLabel: "南",
        fromDeg: 180,
      });
    }
    const hours = [hour(start, 4, 180)];
    const nowMs = start + 3 * 3600_000;
    const pairs = buildMosPairs(harbor, hours, nowMs);
    assert.equal(pairs.length, 1);
    assert.ok(Math.abs(pairs[0].ratio - 1.5) < 0.01);
    assert.ok(Math.abs(pairs[0].biasMs - 2) < 0.01);
  });

  it("applies bin factor when enough pairs exist", () => {
    const start = Date.parse("2026-10-06T00:00:00+09:00");
    const pairs = Array.from({ length: 6 }, (_, index) => ({
      windowStart: start + index * 24 * 3600_000,
      harborMeanMs: 6,
      harborMaxMs: 8,
      harborFromDeg: 180,
      offshoreMeanMs: 4,
      offshoreGustMs: 6,
      offshoreFromDeg: 180,
      ratio: 1.5,
      biasMs: 2,
    }));
    const store: MosStore = ingestMosPairs(
      { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] },
      pairs,
    );
    assert.ok(rebuildMosBins(store.pairs).some((bin) => bin.count >= 3));

    const window: WindowForecast = {
      start: new Date(start + 6 * 24 * 3600_000).toISOString(),
      end: new Date(start + 6 * 24 * 3600_000 + 3 * 3600_000).toISOString(),
      partialFrom: null,
      available: true,
      weather: "晴れ",
      precipMm: 0,
      tempMinC: 20,
      tempMaxC: 21,
      windFromDeg: 180,
      windFromLabel: "南",
      windMeanMs: 4,
      windMaxMs: 4,
      windGustMs: 6,
      noDeparture: false,
    };
    const correction = correctionForWindow(store, window);
    assert.ok(correction);
    assert.ok(correction.factor > 1.2);
    const adjusted = applyMosCorrection([window], store);
    assert.equal(adjusted[0].mosAdjusted, true);
    assert.ok((adjusted[0].windMeanMs ?? 0) > 4);
  });

  it("falls back to neighboring hour bins when the exact hour is thin", () => {
    // Pairs only in 21–24 JST (hourBucket 7) and 3–6 JST (hourBucket 1),
    // none in 0–3 JST (hourBucket 0). A 0–3 window should blend neighbors.
    const base = Date.parse("2026-10-01T00:00:00+09:00");
    const pairs = [
      ...Array.from({ length: 3 }, (_, index) => ({
        windowStart: base + index * 24 * 3600_000 + 21 * 3600_000,
        harborMeanMs: 6,
        harborMaxMs: 8,
        harborFromDeg: 180,
        offshoreMeanMs: 4,
        offshoreGustMs: 6,
        offshoreFromDeg: 180,
        ratio: 1.4,
        biasMs: 2,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        windowStart: base + index * 24 * 3600_000 + 3 * 3600_000,
        harborMeanMs: 6.4,
        harborMaxMs: 8,
        harborFromDeg: 180,
        offshoreMeanMs: 4,
        offshoreGustMs: 6,
        offshoreFromDeg: 180,
        ratio: 1.6,
        biasMs: 2.4,
      })),
    ];
    const store: MosStore = ingestMosPairs(
      { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] },
      pairs,
    );
    const window: WindowForecast = {
      start: new Date(base + 6 * 24 * 3600_000).toISOString(),
      end: new Date(base + 6 * 24 * 3600_000 + 3 * 3600_000).toISOString(),
      partialFrom: null,
      available: true,
      weather: "晴れ",
      precipMm: 0,
      tempMinC: 20,
      tempMaxC: 21,
      windFromDeg: 90,
      windFromLabel: "東",
      windMeanMs: 4,
      windMaxMs: 4,
      windGustMs: 6,
      noDeparture: false,
    };
    const correction = correctionForWindow(store, window);
    assert.ok(correction);
    assert.equal(correction.binKey, "h0:~");
    assert.ok(correction.factor > 1.3 && correction.factor < 1.7);
    assert.match(correction.note, /近傍時間帯/);
  });

  it("falls back to the global mean ratio when no hour bin is usable", () => {
    const start = Date.parse("2026-10-06T12:00:00+09:00");
    // Five pairs in one far hour bucket; query a different hour with a mismatched sector.
    const pairs = Array.from({ length: 5 }, (_, index) => ({
      windowStart: Date.parse("2026-10-01T06:00:00+09:00") + index * 24 * 3600_000,
      harborMeanMs: 5,
      harborMaxMs: 7,
      harborFromDeg: 0,
      offshoreMeanMs: 4,
      offshoreGustMs: 5,
      offshoreFromDeg: 0,
      ratio: 1.25,
      biasMs: 1,
    }));
    const store: MosStore = ingestMosPairs(
      { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] },
      pairs,
    );
    const window: WindowForecast = {
      start: new Date(start).toISOString(),
      end: new Date(start + 3 * 3600_000).toISOString(),
      partialFrom: null,
      available: true,
      weather: "晴れ",
      precipMm: 0,
      tempMinC: 20,
      tempMaxC: 21,
      windFromDeg: 90,
      windFromLabel: "東",
      windMeanMs: 4,
      windMaxMs: 4,
      windGustMs: 5,
      noDeparture: false,
    };
    // hourBucket(12 JST)=4; pairs are at 06 JST (bucket 2). Neighbors of 4 are 3,4,5 — empty.
    // Global fallback should apply.
    const correction = correctionForWindow(store, window);
    assert.ok(correction);
    assert.equal(correction.binKey, "h*:g");
    assert.ok(Math.abs(correction.factor - 1.25) < 0.01);
    assert.match(correction.note, /全体平均/);
  });
});
