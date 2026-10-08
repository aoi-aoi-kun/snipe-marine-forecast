import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeLearningProgress, type SkillSnapshot } from "./learning-progress";

function snap(partial: Partial<SkillSnapshot> & { atMs: number }): SkillSnapshot {
  return {
    nowcastCases: 100,
    nowcastMae15: 0.8,
    mosPairs: 20,
    mosActiveBins: 4,
    metaMosCases: 16,
    metaPatternCases: 4,
    patternEvents: 10,
    ...partial,
  };
}

describe("learning progress", () => {
  it("marks improving when recent MAE drops with enough cases", () => {
    const earlier = snap({ atMs: 1, nowcastMae15: 1.2, nowcastCases: 80 });
    const current = snap({ atMs: 2, nowcastMae15: 0.9, nowcastCases: 120 });
    const progress = summarizeLearningProgress(
      { snapshots: [earlier, earlier, earlier, earlier] },
      current,
    );
    assert.equal(progress.improving, true);
    assert.match(progress.note, /誤差は以前より小さめ/);
  });

  it("stays neutral until enough verification accumulates", () => {
    const current = snap({ atMs: 1, nowcastCases: 10, nowcastMae15: 1 });
    const progress = summarizeLearningProgress({ snapshots: [] }, current);
    assert.equal(progress.improving, null);
    assert.match(progress.note, /使うほど検証が増え/);
  });

  it("stays neutral with a single snapshot even when MAE is present", () => {
    const current = snap({ atMs: 1, nowcastCases: 100, nowcastMae15: 0.5 });
    const progress = summarizeLearningProgress({ snapshots: [current] }, current);
    assert.equal(progress.improving, null);
  });
});
