import {
  MAX_PROJECTED_MS,
  type HarborAlert,
  type NowcastPoint,
} from "./nowcast";

export type PatternMatchBlendInput = {
  score: number;
  expectedPeakMs: number;
  horizonMinutes: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * How strongly to pull a nowcast horizon toward the analog peak path.
 * Stronger near the match horizon; capped so trend still carries weight.
 */
export function patternBlendWeight(
  minutesAhead: number,
  horizonMinutes: number,
  score: number,
): number {
  const scoreW = clamp((score - 0.5) / 0.45, 0, 1);
  const proximity = clamp(1 - Math.abs(minutesAhead - horizonMinutes) / 50, 0.15, 1);
  return scoreW * proximity * 0.7;
}

/** Linear rise to peak by horizonMinutes, then hold. */
export function analogMeanAt(
  currentMeanMs: number,
  expectedPeakMs: number,
  horizonMinutes: number,
  minutesAhead: number,
): number {
  const rise = expectedPeakMs - currentMeanMs;
  if (rise <= 0) return currentMeanMs;
  const frac = clamp(minutesAhead / Math.max(horizonMinutes, 1), 0, 1);
  return currentMeanMs + rise * frac;
}

/**
 * When a ramp match is active, pull 15/30/60 nowcast means toward the
 * analog peak path. No match → unchanged. Match with no rise → unchanged.
 */
export function blendNowcastWithPatternMatch(
  points: NowcastPoint[],
  currentMeanMs: number,
  match: PatternMatchBlendInput | null,
): { points: NowcastPoint[]; blended: boolean; note: string | null } {
  if (!match || points.length === 0) {
    return { points, blended: false, note: null };
  }
  if (!(match.expectedPeakMs > currentMeanMs + 0.15)) {
    return { points, blended: false, note: null };
  }

  let changed = false;
  const next = points.map((point) => {
    const weight = patternBlendWeight(
      point.minutesAhead,
      match.horizonMinutes,
      match.score,
    );
    if (weight < 0.05) return point;

    const analog = analogMeanAt(
      currentMeanMs,
      match.expectedPeakMs,
      match.horizonMinutes,
      point.minutesAhead,
    );
    const mixed = (1 - weight) * point.meanMs + weight * analog;
    const meanMs = Math.round(clamp(mixed, 0, MAX_PROJECTED_MS) * 10) / 10;
    if (Math.abs(meanMs - point.meanMs) < 0.05) return point;

    changed = true;
    return {
      ...point,
      rawMeanMs: point.rawMeanMs ?? point.meanMs,
      meanMs,
    };
  });

  if (!changed) {
    return { points, blended: false, note: null };
  }

  return {
    points: next,
    blended: true,
    note:
      `急上昇マッチ（一致 ${Math.round(match.score * 100)}% · 約${match.horizonMinutes}分で` +
      `ピーク目安 ${match.expectedPeakMs.toFixed(1)} m/s）を短時間予測に織り込みました。`,
  };
}

/** Rebuild the 「ナウキャストが 10 m/s 超」 alert after fusion. */
export function withNowcastThresholdAlerts(
  alerts: HarborAlert[],
  points: NowcastPoint[],
): HarborAlert[] {
  const filtered = alerts.filter(
    (alert) => !(alert.kind === "threshold" && alert.message.includes("ナウキャスト")),
  );
  const over = points.filter((point) => point.meanMs > 10);
  if (over.length === 0) return filtered;
  const parts = over
    .map((point) => `${point.minutesAhead}分後 ${point.meanMs.toFixed(1)}`)
    .join("、");
  return [
    ...filtered,
    {
      kind: "threshold",
      level: "watch",
      message: `ナウキャストが 10 m/s 超（${parts}）。出艇の目安を上回ります。`,
    },
  ];
}
