import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leadTimeGain } from "./lead-gain";
import { HOUR_MS } from "./time";

describe("lead time gain", () => {
  it("keeps full gain near-term and fades with lead time", () => {
    const now = Date.parse("2026-10-08T00:00:00.000Z");
    assert.equal(leadTimeGain(now + 6 * HOUR_MS, now), 1);
    assert.equal(leadTimeGain(now + 24 * HOUR_MS, now), 0.7);
    assert.equal(leadTimeGain(now + 48 * HOUR_MS, now), 0.4);
    assert.equal(leadTimeGain(now + 96 * HOUR_MS, now), 0.2);
  });
});
