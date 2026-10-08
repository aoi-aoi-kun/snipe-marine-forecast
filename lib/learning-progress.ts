import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MetaCalibSummary } from "./meta-calib";
import type { MosSummary } from "./mos";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const STORE_PATH = path.join(CACHE_DIR, "skill-history.json");
const MAX_SNAPSHOTS = 90;

export type SkillSnapshot = {
  atMs: number;
  nowcastCases: number;
  nowcastMae15: number | null;
  mosPairs: number;
  mosActiveBins: number;
  metaMosCases: number;
  metaPatternCases: number;
  patternEvents: number;
};

export type LearningProgress = {
  snapshotCount: number;
  improving: boolean | null;
  nowcastCases: number;
  mosPairs: number;
  metaMosCases: number;
  metaPatternCases: number;
  patternEvents: number;
  nowcastMae15: number | null;
  earlierNowcastMae15: number | null;
  note: string;
};

type SkillHistory = {
  snapshots: SkillSnapshot[];
};

async function loadHistory(): Promise<SkillHistory> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as SkillHistory;
    if (!Array.isArray(raw.snapshots)) return { snapshots: [] };
    return { snapshots: raw.snapshots.slice(-MAX_SNAPSHOTS) };
  } catch {
    return { snapshots: [] };
  }
}

async function saveHistory(history: SkillHistory): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(history));
}

export async function recordSkillSnapshot(snapshot: SkillSnapshot): Promise<SkillHistory> {
  const history = await loadHistory();
  const last = history.snapshots.at(-1);
  // Avoid writing near-identical rows more than once every ~20 minutes.
  if (last && snapshot.atMs - last.atMs < 20 * 60_000) {
    history.snapshots[history.snapshots.length - 1] = snapshot;
  } else {
    history.snapshots.push(snapshot);
  }
  history.snapshots = history.snapshots.slice(-MAX_SNAPSHOTS);
  await saveHistory(history);
  return history;
}

export function summarizeLearningProgress(
  history: SkillHistory,
  current: SkillSnapshot,
): LearningProgress {
  const earlier =
    history.snapshots.length >= 4
      ? history.snapshots[Math.max(0, history.snapshots.length - 8)]
      : history.snapshots[0] ?? null;

  let improving: boolean | null = null;
  if (
    earlier?.nowcastMae15 != null &&
    current.nowcastMae15 != null &&
    current.nowcastCases >= 48
  ) {
    improving = current.nowcastMae15 + 0.02 < earlier.nowcastMae15;
  }

  const parts = [
    `検証 ナウキャスト ${current.nowcastCases}・MOS ${current.mosPairs}・補正の補正 ${current.metaMosCases}`,
    `急上昇 ${current.patternEvents} 件（減衰検証 ${current.metaPatternCases}）`,
  ];
  if (current.nowcastMae15 != null) {
    parts.push(`15分MAE ${current.nowcastMae15.toFixed(2)} m/s`);
  }
  if (improving === true) {
    parts.push("直近の誤差は以前より小さめです");
  } else if (improving === false && earlier?.nowcastMae15 != null) {
    parts.push("季節変化などで誤差が揺れることがあります");
  } else {
    parts.push("使うほど検証が増え、補正が自動更新されます");
  }

  return {
    snapshotCount: history.snapshots.length,
    improving,
    nowcastCases: current.nowcastCases,
    mosPairs: current.mosPairs,
    metaMosCases: current.metaMosCases,
    metaPatternCases: current.metaPatternCases,
    patternEvents: current.patternEvents,
    nowcastMae15: current.nowcastMae15,
    earlierNowcastMae15: earlier?.nowcastMae15 ?? null,
    note: parts.join(" · "),
  };
}

export async function captureLearningProgress(input: {
  nowMs: number;
  nowcastCases: number;
  nowcastMae15: number | null;
  mos: MosSummary;
  meta: MetaCalibSummary;
  patternEvents: number;
}): Promise<LearningProgress> {
  const current: SkillSnapshot = {
    atMs: input.nowMs,
    nowcastCases: input.nowcastCases,
    nowcastMae15: input.nowcastMae15,
    mosPairs: input.mos.pairCount,
    mosActiveBins: input.mos.activeBins,
    metaMosCases: input.meta.mosCases,
    metaPatternCases: input.meta.patternCases,
    patternEvents: input.patternEvents,
  };
  const history = await recordSkillSnapshot(current);
  return summarizeLearningProgress(history, current);
}
