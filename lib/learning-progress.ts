import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "./cache-dir";
import type { MetaCalibSummary } from "./meta-calib";
import type { MosSummary } from "./mos";

const CACHE_DIR = getCacheDir();
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
  const { writeProtectedJson } = await import("./learning-persist");
  await writeProtectedJson(STORE_PATH, JSON.stringify(history), {
    label: "skill-history.json",
  });
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
      : history.snapshots.length >= 2
        ? history.snapshots[0]
        : null;
  const comparable =
    earlier != null &&
    earlier.atMs !== current.atMs &&
    earlier.nowcastMae15 != null &&
    current.nowcastMae15 != null &&
    current.nowcastCases >= 48;

  let improving: boolean | null = null;
  if (comparable) {
    improving = (current.nowcastMae15 as number) + 0.02 < (earlier!.nowcastMae15 as number);
  }

  const parts = [
    `ナウキャスト ${current.nowcastCases} 件 · MOS ${current.mosPairs} 枠 · 急上昇 ${current.patternEvents} 件`,
  ];
  if (current.nowcastMae15 != null) {
    parts.push(`15分先の平均誤差 ${current.nowcastMae15.toFixed(2)} m/s`);
  }
  if (improving === true) {
    parts.push("直近は誤差が縮む方向");
  } else if (improving === false && earlier?.nowcastMae15 != null) {
    parts.push("誤差は季節などで揺れます");
  } else {
    parts.push("実況が増えるほど自動更新");
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
