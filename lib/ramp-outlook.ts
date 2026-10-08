import type { PatternForecastCase } from "./pattern-forecast-calib";

export type RampOutlook = {
  /** P(mean rise ≥ 2.5 m/s within the match horizon). */
  pRiseGe25: number | null;
  /** P(peak mean ≥ 10 m/s within the match horizon). */
  pPeakGe10: number | null;
  support: number;
  note: string;
};

const MIN_SUPPORT = 8;
const RISE_GE = 2.5;
const PEAK_GE = 10;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Score-weighted hit rates from verified analog forecasts.
 * Used when a live match is active so the UI can show classification odds.
 */
export function estimateRampOutlook(
  score: number,
  cases: PatternForecastCase[],
): RampOutlook {
  const verified = cases.filter(
    (item) => item.actualRiseMs != null && item.actualPeakMs != null,
  );
  if (verified.length < MIN_SUPPORT) {
    return {
      pRiseGe25: null,
      pPeakGe10: null,
      support: verified.length,
      note: `急上昇の分類精度は検証 ${verified.length}/${MIN_SUPPORT} 件。足りると確率を出します。`,
    };
  }

  let wRise = 0;
  let wPeak = 0;
  let wSum = 0;
  for (const item of verified) {
    const gap = Math.abs(item.score - score);
    const weight = Math.exp(-gap * 4);
    wSum += weight;
    if ((item.actualRiseMs as number) >= RISE_GE) wRise += weight;
    if ((item.actualPeakMs as number) >= PEAK_GE) wPeak += weight;
  }
  if (wSum <= 0) {
    return {
      pRiseGe25: null,
      pPeakGe10: null,
      support: verified.length,
      note: "急上昇の分類に使える検証がありません。",
    };
  }

  const pRiseGe25 = clamp01(wRise / wSum);
  const pPeakGe10 = clamp01(wPeak / wSum);
  return {
    pRiseGe25,
    pPeakGe10,
    support: verified.length,
    note:
      `過去の類似検証 ${verified.length} 件から、` +
      `+${RISE_GE} m/s 急上昇 ${Math.round(pRiseGe25 * 100)}% · ` +
      `ピーク平均 ${PEAK_GE} 超 ${Math.round(pPeakGe10 * 100)}%。`,
  };
}

export function formatRampOutlookLine(outlook: RampOutlook): string | null {
  if (outlook.pRiseGe25 == null || outlook.pPeakGe10 == null) return null;
  return (
    `急上昇見込み ${Math.round(outlook.pRiseGe25 * 100)}%` +
    ` · 平均10超 ${Math.round(outlook.pPeakGe10 * 100)}%`
  );
}
