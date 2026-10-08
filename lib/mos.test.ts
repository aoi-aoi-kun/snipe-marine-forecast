import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HourSample, WindowForecast } from "./aggregate";
import {
  applyMosCorrection,
  buildMosPairs,
  correctionForWindow,
  ingestMosPairs,
  rebuildMosBins,
  seasonHalf,
  type MosStore,
} from "./mos";
import type { HarborSample } from "./enowin";

function hour(validMs: number, speed: number, fromDeg = 180, gustMs?: number): HourSample {
  const rad = ((270 - fromDeg) * Math.PI) / 180;
  return {
    validMs,
    tempC: 20,
    u: speed * Math.cos(rad),
    v: speed * Math.sin(rad),
    cloudPct: 10,
    precipRunMm: 0,
    gustMs: gustMs ?? speed + 2,
  };
}

function pair(overrides: Partial<{
  windowStart: number;
  ratio: number;
  gustRatio: number | null;
  offshoreFromDeg: number | null;
}> = {}) {
  const windowStart = overrides.windowStart ?? Date.parse("2026-10-06T00:00:00+09:00");
  return {
    windowStart,
    harborMeanMs: 6,
    harborMaxMs: 9,
    harborFromDeg: 180,
    offshoreMeanMs: 4,
    offshoreGustMs: 6,
    offshoreFromDeg: overrides.offshoreFromDeg ?? 180,
    ratio: overrides.ratio ?? 1.5,
    gustRatio: overrides.gustRatio === undefined ? 1.5 : overrides.gustRatio,
    biasMs: 2,
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
        maxMs: 9,
        fromLabel: "南",
        fromDeg: 180,
      });
    }
    const hours = [hour(start, 4, 180, 6)];
    const nowMs = start + 3 * 3600_000;
    const pairs = buildMosPairs(harbor, hours, nowMs);
    assert.equal(pairs.length, 1);
    assert.ok(Math.abs(pairs[0].ratio - 1.5) < 0.01);
    assert.ok(Math.abs(pairs[0].biasMs - 2) < 0.01);
    assert.ok(pairs[0].gustRatio != null);
    assert.ok(Math.abs((pairs[0].gustRatio as number) - 1.5) < 0.01);
  });

  it("tags bins with season half-year", () => {
    assert.equal(seasonHalf(Date.parse("2026-10-06T00:00:00+09:00")), 0);
    assert.equal(seasonHalf(Date.parse("2026-07-06T00:00:00+09:00")), 1);
    const start = Date.parse("2026-10-06T00:00:00+09:00");
    const pairs = Array.from({ length: 6 }, (_, index) =>
      pair({ windowStart: start + index * 24 * 3600_000 }),
    );
    const bins = rebuildMosBins(pairs, start);
    assert.ok(bins.some((bin) => bin.key.startsWith("s0:h") && bin.count >= 3));
  });

  it("applies bin factor when enough pairs exist", () => {
    const start = Date.parse("2026-10-06T00:00:00+09:00");
    const pairs = Array.from({ length: 6 }, (_, index) =>
      pair({ windowStart: start + index * 24 * 3600_000 }),
    );
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
    assert.ok(correction.binKey.startsWith("s0:"));
    const adjusted = applyMosCorrection([window], store);
    assert.equal(adjusted[0].mosAdjusted, true);
    assert.ok((adjusted[0].windMeanMs ?? 0) > 4);
  });

  it("scales gust with a separate gust MOS factor when learned", () => {
    const start = Date.parse("2026-10-06T00:00:00+09:00");
    const pairs = Array.from({ length: 6 }, (_, index) =>
      pair({
        windowStart: start + index * 24 * 3600_000,
        ratio: 1.2,
        gustRatio: 1.6,
      }),
    );
    const store = ingestMosPairs(
      { updatedAt: 0, lastBackfillAt: 0, pairs: [], bins: [] },
      pairs,
    );
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
      windMeanMs: 5,
      windMaxMs: 5,
      windGustMs: 5,
      noDeparture: false,
    };
    const adjusted = applyMosCorrection([window], store, 1);
    assert.equal(adjusted[0].mosAdjusted, true);
    assert.ok((adjusted[0].windMeanMs ?? 0) > 5 && (adjusted[0].windMeanMs ?? 0) < 6.5);
    assert.ok((adjusted[0].windGustMs ?? 0) > (adjusted[0].windMeanMs ?? 0));
  });

  it("falls back to neighboring hour bins when the exact hour is thin", () => {
    const base = Date.parse("2026-10-01T00:00:00+09:00");
    const pairs = [
      ...Array.from({ length: 3 }, (_, index) =>
        pair({
          windowStart: base + index * 24 * 3600_000 + 21 * 3600_000,
          ratio: 1.4,
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        pair({
          windowStart: base + index * 24 * 3600_000 + 3 * 3600_000,
          ratio: 1.6,
        }),
      ),
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
    assert.equal(correction.binKey, "s0:h0:~");
    assert.ok(correction.factor > 1.3 && correction.factor < 1.7);
    assert.match(correction.note, /近傍時間帯/);
  });

  it("falls back to the global mean ratio when no hour bin is usable", () => {
    const start = Date.parse("2026-10-06T12:00:00+09:00");
    const pairs = Array.from({ length: 5 }, (_, index) =>
      pair({
        windowStart: Date.parse("2026-10-01T06:00:00+09:00") + index * 24 * 3600_000,
        ratio: 1.25,
        offshoreFromDeg: 0,
      }),
    );
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
    const correction = correctionForWindow(store, window);
    assert.ok(correction);
    assert.equal(correction.binKey, "h*:g");
    assert.equal(correction.tier, "global");
    assert.ok(Math.abs(correction.factor - 1.25) < 0.01);
    assert.match(correction.note, /全体平均/);
    const adjusted = applyMosCorrection([window], store, 1);
    assert.equal(adjusted[0].mosAdjusted, false);
    assert.equal(adjusted[0].windMeanMs, 4);
  });
});
