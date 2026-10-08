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

export type PatternDisplay = {
  headline: string;
  detail: string;
  metrics: { label: string; value: string; hint?: string }[];
};

export function formatPatternMatchNote(input: {
  note: string;
  boostFactor: number;
  score: number;
  expectedRiseMs: number;
  expectedPeakMs: number;
  expectedMaxMs: number;
  horizonMinutes: number;
  calib?: {
    caseCount: number;
    calibrated: boolean;
    note: string;
  };
}): PatternDisplay {
  const pct = Math.round(input.score * 100);
  const headline = input.calib?.calibrated
    ? `過去の急上昇に近い前兆です（一致 ${pct}% · 事後校正あり）`
    : `過去の急上昇に近い前兆です（一致 ${pct}%）`;
  const detail = [
    input.note.trim(),
    input.calib?.note?.trim() ||
      "類似イベントをいまの実況に当てはめた目安です。マッチ後の実測で校正が厚くなります。",
  ].join(" ");
  return {
    headline,
    detail,
    metrics: [
      {
        label: "上昇目安",
        value: `+${input.expectedRiseMs.toFixed(1)} m/s`,
        hint: `約 ${input.horizonMinutes} 分`,
      },
      {
        label: "ピーク目安",
        value: `${input.expectedPeakMs.toFixed(1)} m/s`,
        hint: "平均風速",
      },
      {
        label: "瞬間目安",
        value: `${input.expectedMaxMs.toFixed(1)} m/s`,
        hint: `倍率 ${input.boostFactor.toFixed(2)}`,
      },
    ],
  };
}

function formatJstShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}時`;
}
