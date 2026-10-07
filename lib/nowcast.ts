import type { HarborSample } from "./enowin";
import { windFromLabel } from "./wind";

export type NowcastHorizon = 15 | 30 | 60;

/** Minimal calibration view used when projecting (avoids import cycles). */
export type NowcastCalibView = {
  horizons: {
    minutesAhead: NowcastHorizon;
    count: number;
    dampen: number;
    biasMs: number;
    dirDampen?: number;
  }[];
};

export type NowcastPoint = {
  minutesAhead: NowcastHorizon;
  meanMs: number;
  rawMeanMs?: number;
  fromDeg: number | null;
  fromLabel: string | null;
  rawFromDeg?: number | null;
};

export type HarborAlert = {
  kind: "ramp" | "threshold" | "rising";
  level: "info" | "watch";
  message: string;
};

export type NowcastResult = {
  riseRateMsPerHour: number | null;
  directionChangeDeg: number | null;
  nowcast: NowcastPoint[];
  alerts: HarborAlert[];
  calibrated: boolean;
};

export const TREND_MS = 30 * 60 * 1000;
export const HORIZONS: readonly NowcastHorizon[] = [15, 30, 60];
export const MAX_PROJECTED_MS = 22;

const MIN_POINTS = 4;
const RAMP_15_MS = 1.5;
const RAMP_30_MS = 2.5;
const THRESHOLD_MEAN_MS = 8;
const THRESHOLD_MAX_MS = 10;
const RISING_RATE_MS_PER_HOUR = 4;

function samplesInWindow(samples: HarborSample[], endMs: number, widthMs: number): HarborSample[] {
  const startMs = endMs - widthMs;
  return samples.filter((sample) => sample.atMs >= startMs && sample.atMs <= endMs);
}

function linearSlope(samples: HarborSample[]): number | null {
  if (samples.length < MIN_POINTS) return null;
  const xs = samples.map((sample) => sample.atMs);
  const ys = samples.map((sample) => sample.meanMs);
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den <= 0) return null;
  return num / den;
}

export function circularDeltaDeg(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function normalizeDeg(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function meanDirectionDeg(samples: HarborSample[]): number | null {
  const withDir = samples.filter((sample) => sample.fromDeg !== null);
  if (withDir.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const sample of withDir) {
    const rad = ((sample.fromDeg as number) * Math.PI) / 180;
    x += Math.sin(rad);
    y += Math.cos(rad);
  }
  if (x === 0 && y === 0) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function riseOver(samples: HarborSample[], endMs: number, widthMs: number): number | null {
  const window = samplesInWindow(samples, endMs, widthMs);
  if (window.length < 2) return null;
  return window[window.length - 1].meanMs - window[0].meanMs;
}

/** Nearest sample within tolerance of target time. */
export function sampleNear(
  samples: HarborSample[],
  targetMs: number,
  toleranceMs: number,
): HarborSample | null {
  let best: HarborSample | null = null;
  let bestDist = Infinity;
  for (const sample of samples) {
    const dist = Math.abs(sample.atMs - targetMs);
    if (dist <= toleranceMs && dist < bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
}

/** Trend estimate anchored at the sample nearest to atMs. */
export function estimateTrendAt(
  samples: HarborSample[],
  atMs: number,
): { currentMs: number; riseRateMsPerHour: number; atMs: number } | null {
  const anchor = sampleNear(samples, atMs, 3 * 60 * 1000);
  if (!anchor) return null;
  const trend = samplesInWindow(samples, anchor.atMs, TREND_MS);
  const slopePerMs = linearSlope(trend);
  if (slopePerMs === null) return null;
  return {
    currentMs: anchor.meanMs,
    riseRateMsPerHour: slopePerMs * 60 * 60 * 1000,
    atMs: anchor.atMs,
  };
}

/** Direction trend: circular turn rate (deg/hour, from-direction) over the lookback window. */
export function estimateDirectionAt(
  samples: HarborSample[],
  atMs: number,
): { currentDeg: number; rateDegPerHour: number; atMs: number } | null {
  const anchor = sampleNear(samples, atMs, 3 * 60 * 1000);
  if (!anchor || anchor.fromDeg === null) return null;
  const trend = samplesInWindow(samples, anchor.atMs, TREND_MS).filter(
    (sample) => sample.fromDeg !== null,
  );
  if (trend.length < 2) {
    return { currentDeg: anchor.fromDeg, rateDegPerHour: 0, atMs: anchor.atMs };
  }
  const first = trend[0];
  const last = trend[trend.length - 1];
  const dtHours = (last.atMs - first.atMs) / (60 * 60 * 1000);
  if (dtHours < 5 / 60) {
    return { currentDeg: anchor.fromDeg, rateDegPerHour: 0, atMs: anchor.atMs };
  }
  const delta = circularDeltaDeg(first.fromDeg as number, last.fromDeg as number);
  return {
    currentDeg: last.fromDeg as number,
    rateDegPerHour: delta / dtHours,
    atMs: last.atMs,
  };
}

function projectDirection(
  currentDeg: number,
  rateDegPerHour: number,
  minutesAhead: NowcastHorizon,
  calib: NowcastCalibView | null,
): { fromDeg: number; rawFromDeg: number } {
  const rawFromDeg = normalizeDeg(currentDeg + (rateDegPerHour * minutesAhead) / 60);
  const row = calib?.horizons.find(
    (item) => item.minutesAhead === minutesAhead && item.count >= 24,
  );
  const dampen = row?.dirDampen ?? 0.45;
  const fromDeg = normalizeDeg(currentDeg + dampen * ((rateDegPerHour * minutesAhead) / 60));
  return { fromDeg, rawFromDeg };
}

/** Build short-range nowcast and ramp alerts from harbor samples. */
function projectCalibrated(
  currentMs: number,
  riseRateMsPerHour: number,
  minutesAhead: NowcastHorizon,
  calib: NowcastCalibView | null,
): { meanMs: number; rawMeanMs: number } {
  const rawMeanMs = Math.max(
    0,
    Math.min(MAX_PROJECTED_MS, currentMs + (riseRateMsPerHour * minutesAhead) / 60),
  );
  const row = calib?.horizons.find(
    (item) => item.minutesAhead === minutesAhead && item.count >= 24,
  );
  if (!row) return { meanMs: rawMeanMs, rawMeanMs };
  const meanMs = Math.max(
    0,
    Math.min(
      MAX_PROJECTED_MS,
      currentMs + row.dampen * ((riseRateMsPerHour * minutesAhead) / 60) + row.biasMs,
    ),
  );
  return { meanMs, rawMeanMs };
}

export function buildNowcast(
  samples: HarborSample[],
  nowMs = Date.now(),
  calib: NowcastCalibView | null = null,
): NowcastResult {
  if (samples.length === 0) {
    return {
      riseRateMsPerHour: null,
      directionChangeDeg: null,
      nowcast: [],
      alerts: [],
      calibrated: false,
    };
  }

  const latest = samples[samples.length - 1];
  const trend = samplesInWindow(samples, latest.atMs, TREND_MS);
  const slopePerMs = linearSlope(trend);
  const riseRateMsPerHour =
    slopePerMs === null ? null : slopePerMs * 60 * 60 * 1000;

  const half = Math.floor(trend.length / 2);
  const earlyDir = meanDirectionDeg(trend.slice(0, Math.max(half, 1)));
  const lateDir = meanDirectionDeg(trend.slice(half));
  const directionChangeDeg =
    earlyDir !== null && lateDir !== null ? circularDeltaDeg(earlyDir, lateDir) : null;

  const calibrated =
    calib !== null &&
    HORIZONS.every((minutes) =>
      calib.horizons.some((item) => item.minutesAhead === minutes && item.count >= 24),
    );

  const direction = estimateDirectionAt(samples, latest.atMs);

  const nowcast: NowcastPoint[] = [];
  if (riseRateMsPerHour !== null) {
    for (const minutes of HORIZONS) {
      const projected = projectCalibrated(
        latest.meanMs,
        riseRateMsPerHour,
        minutes,
        calib,
      );
      const dir =
        direction === null
          ? { fromDeg: latest.fromDeg, rawFromDeg: latest.fromDeg }
          : projectDirection(
              direction.currentDeg,
              direction.rateDegPerHour,
              minutes,
              calib,
            );
      nowcast.push({
        minutesAhead: minutes,
        meanMs: projected.meanMs,
        rawMeanMs: projected.rawMeanMs,
        fromDeg: dir.fromDeg,
        fromLabel: dir.fromDeg === null ? null : windFromLabel(dir.fromDeg),
        rawFromDeg: dir.rawFromDeg,
      });
    }
  }

  const alerts: HarborAlert[] = [];
  const nowcastOver10 = nowcast.filter((point) => point.meanMs > 10);
  if (nowcastOver10.length > 0) {
    const parts = nowcastOver10
      .map((point) => `${point.minutesAhead}分後 ${point.meanMs.toFixed(1)}`)
      .join("、");
    alerts.push({
      kind: "threshold",
      level: "watch",
      message: `ナウキャストが 10 m/s を超えます（${parts}）。出艇の目安を上回る見込みです。`,
    });
  }

  const rise15 = riseOver(samples, latest.atMs, 15 * 60 * 1000);
  const rise30 = riseOver(samples, latest.atMs, 30 * 60 * 1000);

  if (rise15 !== null && rise15 >= RAMP_15_MS) {
    alerts.push({
      kind: "ramp",
      level: "watch",
      message: `直近15分で平均風速が ${rise15.toFixed(1)} m/s 上がっています（吹き上がり）。`,
    });
  } else if (rise30 !== null && rise30 >= RAMP_30_MS) {
    alerts.push({
      kind: "ramp",
      level: "watch",
      message: `直近30分で平均風速が ${rise30.toFixed(1)} m/s 上がっています（吹き上がり）。`,
    });
  }

  if (
    riseRateMsPerHour !== null &&
    riseRateMsPerHour >= RISING_RATE_MS_PER_HOUR &&
    !alerts.some((alert) => alert.kind === "ramp")
  ) {
    alerts.push({
      kind: "rising",
      level: "info",
      message: `風が強まる傾向です（およそ ${riseRateMsPerHour.toFixed(1)} m/s 毎時）。`,
    });
  }

  if (latest.meanMs >= THRESHOLD_MEAN_MS) {
    alerts.push({
      kind: "threshold",
      level: "watch",
      message: `ハーバーの平均風速が ${latest.meanMs.toFixed(1)} m/s です（閾値 ${THRESHOLD_MEAN_MS} m/s）。`,
    });
  } else if (latest.maxMs >= THRESHOLD_MAX_MS) {
    alerts.push({
      kind: "threshold",
      level: "info",
      message: `ハーバーの最大風速が ${latest.maxMs.toFixed(1)} m/s です（閾値 ${THRESHOLD_MAX_MS} m/s）。`,
    });
  }

  if (
    directionChangeDeg !== null &&
    Math.abs(directionChangeDeg) >= 45 &&
    (rise15 ?? 0) > 0.5
  ) {
    alerts.push({
      kind: "rising",
      level: "info",
      message: `風向が約 ${Math.round(directionChangeDeg)}° 変わりながら強まっています。`,
    });
  }

  if (nowMs - latest.atMs > 20 * 60 * 1000) {
    alerts.push({
      kind: "rising",
      level: "info",
      message: "ハーバー実況の最新時刻が20分以上前です。更新を確認してください。",
    });
  }

  return { riseRateMsPerHour, directionChangeDeg, nowcast, alerts, calibrated };
}

export type RampEvent = {
  atMs: number;
  beforeMeanMs: number;
  peakMeanMs: number;
  riseMs: number;
  riseMinutes: number;
  fromDeg: number | null;
};

/** Detect sharp rises in harbor mean wind (≥2.5 m/s within 30 minutes). */
export function detectRampEvents(samples: HarborSample[]): RampEvent[] {
  if (samples.length < 3) return [];
  const events: RampEvent[] = [];
  const window = 30 * 60 * 1000;
  let lastEventMs = -Infinity;

  for (let i = 1; i < samples.length; i++) {
    const end = samples[i];
    let startIndex = i;
    while (startIndex > 0 && end.atMs - samples[startIndex - 1].atMs <= window) {
      startIndex -= 1;
    }
    const start = samples[startIndex];
    const rise = end.meanMs - start.meanMs;
    if (rise < RAMP_30_MS) continue;
    if (end.atMs - lastEventMs < 45 * 60 * 1000) continue;

    let peak = end;
    for (let j = i; j < samples.length && samples[j].atMs - end.atMs <= 60 * 60 * 1000; j++) {
      if (samples[j].meanMs > peak.meanMs) peak = samples[j];
    }

    events.push({
      atMs: end.atMs,
      beforeMeanMs: start.meanMs,
      peakMeanMs: peak.meanMs,
      riseMs: rise,
      riseMinutes: Math.max(5, (end.atMs - start.atMs) / 60_000),
      fromDeg: end.fromDeg ?? start.fromDeg,
    });
    lastEventMs = end.atMs;
  }
  return events;
}
