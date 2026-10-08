import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getContinuousLearnStatus } from "./continuous-learn-state";
import { loadMetaCalib, summarizeMetaCalib } from "./meta-calib";
import { loadMosStore, summarizeMos } from "./mos";
import { loadNowcastCalib, summarizeNowcastCalib } from "./nowcast-learn";
import { getOpsUptime } from "./ops-uptime";
import { loadPatternStore } from "./pattern";

const CACHE_DIR = path.join(process.cwd(), ".cache");

export type LearnStatus = {
  generatedAt: string;
  continuous: {
    started: boolean;
    ticking: boolean;
    /** Wall-clock interval between continuous-learn ticks. */
    intervalMinutes: number;
    lastTickAt: string | null;
    lastTickError: string | null;
  };
  cache: {
    dir: string;
    writable: boolean;
    error: string | null;
  };
  ops: {
    firstSeenAt: string;
    lastActiveAt: string;
    learningDays: number;
    warmCount: number;
    learnTickCount: number;
  };
  mos: {
    pairCount: number;
    activeBins: number;
    note: string;
  };
  nowcast: {
    caseCount: number;
    calibrated: boolean;
    note: string;
  };
  pattern: {
    storedEvents: number;
  };
  meta: {
    mosLambda: number;
    patternLambda: number;
    mosCases: number;
    patternCases: number;
    mosReady: boolean;
    patternReady: boolean;
    mosBins: number;
    note: string;
  };
  tip: string;
};

async function probeCache(): Promise<LearnStatus["cache"]> {
  const probe = path.join(CACHE_DIR, ".write-probe");
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(probe, `${Date.now()}\n`, "utf8");
    return { dir: CACHE_DIR, writable: true, error: null };
  } catch (error) {
    return {
      dir: CACHE_DIR,
      writable: false,
      error: error instanceof Error ? error.message : "書き込みに失敗しました",
    };
  }
}

/** Pure tip for ops UI / tests (cache + continuous + MOS readiness). */
export function buildLearnTip(status: Omit<LearnStatus, "tip" | "generatedAt">): string {
  if (!status.cache.writable) {
    return "学習結果をディスクに保存できていません。Render では Disk、ローカルでは .cache の権限を確認してください。";
  }
  if (!status.continuous.started) {
    return "バックグラウンド学習が起動していません。サーバを常時稼働させ、DISABLE_CONTINUOUS_LEARN が無効か確認してください。";
  }
  if (status.continuous.lastTickError) {
    return `直近の学習に失敗しました（${status.continuous.lastTickError}）。しばらくすると自動で再試行します。`;
  }
  const days = status.ops?.learningDays ?? 0;
  if (status.mos.pairCount < 48 || !status.meta.patternReady) {
    return (
      "データが増えるほど、ナウキャストと急上昇マッチの精度が上がります。" +
      (days < 1
        ? "無料ホストでは、8〜10分ごとに /api/health?warm=1 へアクセスするとスリープしにくくなります。"
        : `稼働 ${days.toFixed(1)} 日目。warm の定期アクセスを続けると学習が途切れにくいです。`)
    );
  }
  if (days < 7) {
    return `約 ${days.toFixed(1)} 日分の検証を蓄積中です。サーバと .cache を維持すると、季節をまたいだ型が安定します。`;
  }
  return `約 ${Math.round(days)} 日分の検証を蓄積しています。.cache を消さなければ、暖候期・寒候期それぞれの型が厚くなります。`;
}

export async function getLearnStatus(): Promise<LearnStatus> {
  const [cache, mosStore, nowcastStore, patternStore, metaStore, ops] = await Promise.all([
    probeCache(),
    loadMosStore(),
    loadNowcastCalib(),
    loadPatternStore(),
    loadMetaCalib(),
    getOpsUptime(),
  ]);
  const mos = summarizeMos(mosStore);
  const nowcast = summarizeNowcastCalib(nowcastStore);
  const meta = summarizeMetaCalib(metaStore);
  const continuous = getContinuousLearnStatus();
  const body = {
    continuous,
    cache,
    ops: {
      firstSeenAt: ops.firstSeenAt,
      lastActiveAt: ops.lastActiveAt,
      learningDays: ops.learningDays,
      warmCount: ops.warmCount,
      learnTickCount: ops.learnTickCount,
    },
    mos: {
      pairCount: mos.pairCount,
      activeBins: mos.activeBins,
      note: mos.note,
    },
    nowcast: {
      caseCount: nowcast.caseCount,
      calibrated: Boolean(
        nowcast.horizons.length >= 3 &&
          nowcast.horizons.every((item) => item.count >= 24),
      ),
      note: nowcast.note,
    },
    pattern: {
      storedEvents: patternStore.events.length,
    },
    meta: {
      mosLambda: meta.mosLambda,
      patternLambda: meta.patternLambda,
      mosCases: meta.mosCases,
      patternCases: meta.patternCases,
      mosReady: meta.mosReady,
      patternReady: meta.patternReady,
      mosBins: meta.mosBins,
      note: meta.note,
    },
  };
  return {
    generatedAt: new Date().toISOString(),
    ...body,
    tip: buildLearnTip(body),
  };
}
