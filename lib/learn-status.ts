import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getContinuousLearnStatus } from "./continuous-learn-state";
import { loadMetaCalib, summarizeMetaCalib } from "./meta-calib";
import { loadMosStore, summarizeMos } from "./mos";
import { loadNowcastCalib, summarizeNowcastCalib } from "./nowcast-learn";
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
    return "キャッシュに書き込めません。.cache ボリューム（Render Disk / Docker volume）を確認してください。";
  }
  if (!status.continuous.started) {
    return "継続学習が止まっています。サーバを常時起動し、DISABLE_CONTINUOUS_LEARN が無いことを確認してください。";
  }
  if (status.continuous.lastTickError) {
    return `直近の学習でエラーがありました: ${status.continuous.lastTickError}`;
  }
  if (status.mos.pairCount < 48 || !status.meta.patternReady) {
    return "常時起動を続けると MOS・補正の補正・急上昇の検証が厚くなります。無料枠は外部から約8〜10分ごとに /api/health?warm=1 へアクセスするとスリープしにくいです。";
  }
  return "学習は蓄積中です。サーバを止めず .cache を消さなければ、使い続けるほど局地補正が安定します。";
}

export async function getLearnStatus(): Promise<LearnStatus> {
  const [cache, mosStore, nowcastStore, patternStore, metaStore] = await Promise.all([
    probeCache(),
    loadMosStore(),
    loadNowcastCalib(),
    loadPatternStore(),
    loadMetaCalib(),
  ]);
  const mos = summarizeMos(mosStore);
  const nowcast = summarizeNowcastCalib(nowcastStore);
  const meta = summarizeMetaCalib(metaStore);
  const continuous = getContinuousLearnStatus();
  const body = {
    continuous,
    cache,
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
