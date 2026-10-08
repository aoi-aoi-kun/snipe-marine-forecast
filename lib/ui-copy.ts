/** Shared URLs and user-facing copy (Japanese). */

export const WINDY_URL =
  "https://www.windy.com/35.309/139.482?35.250,139.500,11,i:pressure";

export const HARBOR_SOURCE_LABEL = "enowin（江の島ヨットハーバー）";

export function harborDataBlurb(stale: boolean): string {
  if (stale) {
    return "5分間隔の実況です。公開が止まっている間は、短時間予測を表示しません。";
  }
  return "5分間隔の実況です。いまから約1時間先までを、この画面で確認できます。";
}

export function windyBlurb(): string {
  return "数時間〜数日先の風は Windy で確認してください。";
}

export type LearnDisplayInput = {
  tip: string | null | undefined;
  intervalMinutes: number;
  continuousStarted: boolean;
  ticking: boolean;
  lastTickAt: string | null;
  cacheWritable: boolean | null | undefined;
  learningDays: number;
  warmCount: number;
  nowcastCases: number;
  nowcastCalibrated: boolean;
  mosPairs: number;
  mosActiveBins: number;
  patternEvents: number;
  metaMosReady: boolean;
  metaPatternReady: boolean;
  learningNote: string | null | undefined;
  improving: boolean | null | undefined;
};

export function formatLearnLead(input: LearnDisplayInput): string {
  if (input.tip?.trim()) return input.tip.trim();
  if (input.cacheWritable === false) {
    return "学習結果を保存できていません。サーバの .cache が書き込み可能か確認してください。";
  }
  return "実況を取り込みながら、ナウキャストと急上昇の型を更新しています。";
}

export function formatContinuousLine(input: LearnDisplayInput): string {
  const every = input.intervalMinutes;
  let status = "待機中";
  if (input.continuousStarted) {
    status = input.ticking ? "学習中" : "稼働中";
  }
  const last = input.lastTickAt ? ` · 前回 ${formatJstShort(input.lastTickAt)}` : "";
  const cache =
    input.cacheWritable === true
      ? "保存 OK"
      : input.cacheWritable === false
        ? "保存不可"
        : "保存 —";
  const uptime =
    input.learningDays > 0
      ? ` · 稼働 ${input.learningDays.toFixed(1)} 日（warm ${input.warmCount}）`
      : "";
  return `${every} 分ごとに更新 · ${status}${last} · ${cache}${uptime}`;
}

export function formatLearnMetrics(input: LearnDisplayInput): {
  label: string;
  value: string;
  hint?: string;
}[] {
  const nowcastHint = input.nowcastCalibrated ? "校正済み" : "蓄積中";
  const metaHint =
    input.metaMosReady && input.metaPatternReady
      ? "減衰校正あり"
      : input.metaMosReady || input.metaPatternReady
        ? "一部あり"
        : "蓄積中";
  return [
    { label: "ナウキャスト", value: `${input.nowcastCases} 件`, hint: nowcastHint },
    {
      label: "MOS 突合",
      value: `${input.mosPairs} 枠`,
      hint: input.mosActiveBins > 0 ? `型 ${input.mosActiveBins}` : undefined,
    },
    { label: "急上昇", value: `${input.patternEvents} 件`, hint: metaHint },
  ];
}

export function formatLearningTrend(improving: boolean | null | undefined): string | null {
  if (improving === true) return "直近は、以前より誤差が小さくなる方向です。";
  if (improving === false) return "季節や天候の変化で、誤差は揺れることがあります。";
  return null;
}

/** Strip technical tail from harbor.learning.note for the panel. */
export function shortenLearningNote(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return "";
  const first = trimmed.split(" · ")[0];
  return first.length > 72 ? `${first.slice(0, 70)}…` : first;
}

export function formatPatternMatchNote(raw: string, boostFactor: number, score: number): {
  headline: string;
  detail: string;
} {
  const pct = Math.round(score * 100);
  const headline = `過去の急上昇パターンに近い前兆です（一致 ${pct}%）`;
  const detail = raw.replace(/（学習用に保持）。?$/, "。").trim();
  const coeff = `想定倍率 ${boostFactor.toFixed(2)}（参考）`;
  return {
    headline,
    detail: detail.endsWith("。") ? `${detail} ${coeff}` : `${detail}。${coeff}`,
  };
}

function formatJstShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}時`;
}
