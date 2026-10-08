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

  it("formats pattern match for display", () => {
    const out = formatPatternMatchNote("10月8日 12時台の急上昇に似た流れです。", 1.25, 0.82);
    assert.match(out.headline, /一致 82%/);
    assert.match(out.detail, /1\.25/);
  });
});
