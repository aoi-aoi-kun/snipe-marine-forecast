import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLearnTip, type LearnStatus } from "./learn-status";

type TipInput = Omit<LearnStatus, "tip" | "generatedAt">;

function base(overrides: Partial<TipInput> = {}): TipInput {
  return {
    continuous: {
      started: true,
      ticking: false,
      intervalMinutes: 10,
      lastTickAt: "2026-10-08T00:00:00.000Z",
      lastTickError: null,
    },
    cache: { dir: ".cache", writable: true, error: null },
    ops: {
      firstSeenAt: "2026-10-01T00:00:00.000Z",
      lastActiveAt: "2026-10-08T00:00:00.000Z",
      learningDays: 7,
      warmCount: 100,
      learnTickCount: 80,
    },
    mos: { pairCount: 12, activeBins: 2, note: "" },
    nowcast: { caseCount: 40, calibrated: false, note: "" },
    pattern: { storedEvents: 3 },
    meta: {
      mosLambda: 0.7,
      patternLambda: 0.6,
      mosCases: 10,
      patternCases: 2,
      mosReady: false,
      patternReady: false,
      mosBins: 0,
      note: "",
    },
    ...overrides,
  };
}

describe("buildLearnTip", () => {
  it("warns when cache is not writable", () => {
    const tip = buildLearnTip(
      base({ cache: { dir: ".cache", writable: false, error: "EACCES" } }),
    );
    assert.match(tip, /\.cache/);
  });

  it("warns when continuous learning is stopped", () => {
    const tip = buildLearnTip(
      base({
        continuous: {
          started: false,
          ticking: false,
          intervalMinutes: 15,
          lastTickAt: null,
          lastTickError: null,
        },
      }),
    );
    assert.match(tip, /継続学習/);
  });

  it("surfaces the last tick error", () => {
    const tip = buildLearnTip(
      base({
        continuous: {
          started: true,
          ticking: false,
          intervalMinutes: 15,
          lastTickAt: "2026-10-08T00:00:00.000Z",
          lastTickError: "timeout",
        },
      }),
    );
    assert.match(tip, /timeout/);
  });

  it("nudges warm cron while MOS is still thin", () => {
    const tip = buildLearnTip(base({ mos: { pairCount: 10, activeBins: 1, note: "" } }));
    assert.match(tip, /\/api\/health\?warm=1/);
  });

  it("reports healthy accumulation when MOS and pattern meta are ready", () => {
    const tip = buildLearnTip(
      base({
        mos: { pairCount: 80, activeBins: 8, note: "" },
        meta: {
          mosLambda: 0.8,
          patternLambda: 0.7,
          mosCases: 60,
          patternCases: 20,
          mosReady: true,
          patternReady: true,
          mosBins: 4,
          note: "",
        },
      }),
    );
    assert.match(tip, /蓄積中/);
    assert.match(tip, /日/);
  });
});
