import type { WindowForecast } from "./aggregate";
import { HOUR_MS } from "./time";

export type ConfidenceLevel = "high" | "mid" | "low";

export type WindowConfidence = {
  level: ConfidenceLevel;
  score: number;
  label: string;
};

function labelOf(level: ConfidenceLevel): string {
  if (level === "high") return "確度 高";
  if (level === "mid") return "確度 中";
  return "確度 低";
}

/** Combine lead time, cycle spread, and correction flags into a simple confidence band. */
export function assessWindowConfidence(
  window: WindowForecast,
  nowMs: number,
  options: { ifsDegraded?: boolean } = {},
): WindowConfidence {
  let score = 78;
  const hoursAhead = (Date.parse(window.start) - nowMs) / HOUR_MS;

  if (hoursAhead >= 96) score -= 28;
  else if (hoursAhead >= 72) score -= 20;
  else if (hoursAhead >= 36) score -= 12;
  else if (hoursAhead >= 18) score -= 6;

  const spread = window.cycleSpreadMs;
  if (spread != null) {
    if (spread >= 3) score -= 28;
    else if (spread >= 1.5) score -= 14;
    else if (spread >= 0.8) score -= 6;
  } else if (hoursAhead < 48) {
    // Missing previous-cycle compare is a mild unknown for near range.
    score -= 4;
  }

  if (options.ifsDegraded) score -= 12;

  if (window.harborAdjusted) score -= 10;
  if (window.mosAdjusted) {
    const note = window.mosAdjustNote ?? "";
    if (note.includes("(neighbor)")) score -= 8;
    else if (note.includes("(hour)")) score -= 3;
    // exact local correction is roughly neutral / slight plus for near term
    else if (note.includes("(exact)") && hoursAhead < 24) score += 3;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: ConfidenceLevel = score >= 68 ? "high" : score >= 48 ? "mid" : "low";
  return { level, score, label: labelOf(level) };
}

export function attachConfidence(
  windows: WindowForecast[],
  nowMs: number,
  options: { ifsDegraded?: boolean } = {},
): WindowForecast[] {
  return windows.map((window) => {
    const confidence = assessWindowConfidence(window, nowMs, options);
    return {
      ...window,
      confidence: confidence.level,
      confidenceLabel: confidence.label,
      confidenceScore: confidence.score,
    };
  });
}
