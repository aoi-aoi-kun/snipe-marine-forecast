import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPatternMatchNote, shortenLearningNote } from "./ui-copy";

describe("ui-copy", () => {
  it("shortens learning note to first segment", () => {
    assert.equal(
      shortenLearningNote("ナウキャスト 100 件 · MOS 50 枠 · 急上昇 10 件 · 自動更新"),
      "ナウキャスト 100 件",
    );
  });

  it("formats pattern match with quantitative metrics", () => {
    const out = formatPatternMatchNote({
      note: "10月8日 12時台の急上昇に似た流れです。",
      boostFactor: 1.25,
      score: 0.82,
      expectedRiseMs: 3.2,
      expectedPeakMs: 7.1,
      expectedMaxMs: 8.2,
      horizonMinutes: 30,
    });
    assert.match(out.headline, /一致 82%/);
    assert.equal(out.metrics.length, 3);
    assert.match(out.metrics[0].value, /\+3\.2/);
    assert.match(out.metrics[1].value, /7\.1/);
  });
});
