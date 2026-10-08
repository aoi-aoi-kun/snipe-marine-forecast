import {
  MAX_PROJECTED_MS,
  type HarborAlert,
  type NowcastHorizon,
  type NowcastPoint,
} from "./nowcast";

export type PatternMatchBlendInput = {
  score: number;
  expectedPeakMs: number;
  horizonMinutes: number;
};

/** Learned pull strength / residual (filled by nowcast-pattern-blend-calib). */
export type BlendCalibView = {
  calibrated: boolean;
  globalGain: number;
  horizons: { minutesAhead: NowcastHorizon; gain: number; biasMs: number }[];
};

export type BlendPointTrace = {
  minutesAhead: NowcastHorizon;
  nowcastMeanMs: number;
  analogMeanMs: number;
  baseWeight: number;
  appliedWeight: number;
  biasMs: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calibratedBlendMean(
  nowcastMeanMs: number,
  analogMeanMs: number,
  weight: number,
  biasMs: number,
): number {
  const mixed = (1 - weight) * nowcastMeanMs + weight * analogMeanMs + biasMs;
  return Math.round(clamp(mixed, 0, MAX_PROJECTED_MS) * 10) / 10;
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

function resolveGainBias(
  minutesAhead: NowcastHorizon,
  calib: BlendCalibView | null | undefined,
): { gain: number; biasMs: number } {
  if (!calib?.calibrated) return { gain: 1, biasMs: 0 };
  const horizon = calib.horizons.find((item) => item.minutesAhead === minutesAhead);
  return {
    gain: clamp(horizon?.gain ?? calib.globalGain, 0.15, 1.55),
    biasMs: horizon?.biasMs ?? 0,
  };
}

/**
 * When a ramp match is active, pull 15/30/60 nowcast means toward the
 * analog peak path. Optional calib scales the pull and adds a residual bias.
 */
export function blendNowcastWithPatternMatch(
  points: NowcastPoint[],
  currentMeanMs: number,
  match: PatternMatchBlendInput | null,
  calib: BlendCalibView | null = null,
): {
  points: NowcastPoint[];
  blended: boolean;
  note: string | null;
  traces: BlendPointTrace[];
} {
  if (!match || points.length === 0) {
    return { points, blended: false, note: null, traces: [] };
  }
  if (!(match.expectedPeakMs > currentMeanMs + 0.15)) {
    return { points, blended: false, note: null, traces: [] };
  }

  let changed = false;
  const traces: BlendPointTrace[] = [];
  const next = points.map((point) => {
    const minutesAhead = point.minutesAhead as NowcastHorizon;
    const baseWeight = patternBlendWeight(
      minutesAhead,
      match.horizonMinutes,
      match.score,
    );
    const { gain, biasMs } = resolveGainBias(minutesAhead, calib);
    const appliedWeight = clamp(baseWeight * gain, 0, 0.85);
    const analog = analogMeanAt(
      currentMeanMs,
      match.expectedPeakMs,
      match.horizonMinutes,
      minutesAhead,
    );
    traces.push({
      minutesAhead,
      nowcastMeanMs: point.meanMs,
      analogMeanMs: Math.round(analog * 10) / 10,
      baseWeight: Math.round(baseWeight * 1000) / 1000,
      appliedWeight: Math.round(appliedWeight * 1000) / 1000,
      biasMs,
    });

    if (appliedWeight < 0.05) return point;

    const meanMs = calibratedBlendMean(point.meanMs, analog, appliedWeight, biasMs);
    const capped = Math.round(clamp(meanMs, 0, MAX_PROJECTED_MS) * 10) / 10;
    if (Math.abs(capped - point.meanMs) < 0.05) return point;

    changed = true;
    return {
      ...point,
      rawMeanMs: point.rawMeanMs ?? point.meanMs,
      meanMs: capped,
    };
  });

  if (!changed) {
    return { points, blended: false, note: null, traces };
  }

  const calibBit = calib?.calibrated
    ? ` · 融合校正×${calib.globalGain.toFixed(2)}`
    : "";

  return {
    points: next,
    blended: true,
    note:
      `急上昇マッチ（一致 ${Math.round(match.score * 100)}% · 約${match.horizonMinutes}分で` +
      `ピーク目安 ${match.expectedPeakMs.toFixed(1)} m/s）を短時間予測に織り込みました` +
      `${calibBit}。`,
    traces,
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
