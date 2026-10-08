import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recencyWeight,
  recencyWeights,
  weightedMae,
  weightedMean,
} from "./recency";

describe("recency weighting", () => {
  it("halves weight after the half-life", () => {
    const now = Date.parse("2026-10-08T00:00:00Z");
    const halfLifeMs = 14 * 86_400_000;
    assert.ok(Math.abs(recencyWeight(now, now) - 1) < 1e-9);
    assert.ok(Math.abs(recencyWeight(now - halfLifeMs, now) - 0.5) < 1e-6);
    assert.ok(recencyWeight(now - 2 * halfLifeMs, now) < 0.26);
  });

  it("weightedMean favors recent values", () => {
    const now = Date.parse("2026-10-08T00:00:00Z");
    const old = now - 28 * 86_400_000;
    const values = [2, 10];
    const weights = [recencyWeight(old, now), recencyWeight(now, now)];
    const mean = weightedMean(values, weights);
    assert.ok(mean > 7);
    assert.equal(weightedMae([-1, 3], [1, 1]), 2);
  });

  it("falls back to sample-relative weights when all timestamps are ancient", () => {
    const old = 1_000_000;
    const newer = old + 14 * 86_400_000;
    const weights = recencyWeights([old, newer], Date.now());
    assert.ok(weights[1]! > weights[0]!);
    assert.ok(weights[1]! > 0.9);
  });
});
