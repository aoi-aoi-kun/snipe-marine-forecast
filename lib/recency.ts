const DAY_MS = 86_400_000;

/** Exponential recency weight (default half-life 14 days). */
export function recencyWeight(
  atMs: number,
  nowMs: number,
  halfLifeDays = 14,
): number {
  const ageDays = Math.max(0, (nowMs - atMs) / DAY_MS);
  return Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
}

/**
 * Weights for a batch of timestamps. If everything is ancient vs wall-clock
 * `nowMs`, fall back to weighting relative to the newest sample so fits
 * still prefer the later end of the training span.
 */
export function recencyWeights(
  atMsList: number[],
  nowMs = Date.now(),
  halfLifeDays = 14,
): number[] {
  if (atMsList.length === 0) return [];
  const againstNow = atMsList.map((atMs) =>
    recencyWeight(atMs, nowMs, halfLifeDays),
  );
  const total = againstNow.reduce((sum, weight) => sum + weight, 0);
  if (total > 1e-9) return againstNow;
  const latest = Math.max(...atMsList);
  return atMsList.map((atMs) => recencyWeight(atMs, latest, halfLifeDays));
}

export function weightedMean(values: number[], weights: number[]): number {
  let sum = 0;
  let weight = 0;
  for (let index = 0; index < values.length; index++) {
    const w = weights[index] ?? 0;
    if (w <= 0) continue;
    sum += values[index] * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

export function weightedMae(errors: number[], weights: number[]): number {
  return weightedMean(
    errors.map((value) => Math.abs(value)),
    weights,
  );
}
