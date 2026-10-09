import { startContinuousLearning } from "@/lib/continuous-learn";
import { getLearnStatus } from "@/lib/learn-status";
import { touchOps } from "@/lib/ops-uptime";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every Nth warm also refreshes IFS. Kept sparse so free-tier RAM stays stable. */
const FULL_REFRESH_EVERY = 12;
let processWarmCount = 0;

/** Liveness + learning health. Use ?warm=1 from an external cron to wake and train. */
export async function GET(request: Request) {
  startContinuousLearning();
  const url = new URL(request.url);
  const warm = url.searchParams.get("warm") === "1";
  const full = url.searchParams.get("full") === "1";

  let ops = null;
  if (warm || full) {
    processWarmCount += 1;
    ops = await touchOps("warm");
    const refresh = full || processWarmCount % FULL_REFRESH_EVERY === 0;
    // Fire-and-forget harbor (or rare full) refresh — never block the health response.
    void import("@/lib/forecast").then(({ getForecast }) =>
      getForecast(
        refresh
          ? { refresh: true, learn: true }
          : { refreshHarbor: true, learn: true },
      ),
    );
  }

  const status = await getLearnStatus();
  return NextResponse.json(
    {
      ...status,
      warm: {
        processCount: processWarmCount,
        persistedCount: ops?.warmCount ?? status.ops.warmCount,
        lastRequestedFull: Boolean(
          full || (warm && processWarmCount % FULL_REFRESH_EVERY === 0),
        ),
      },
    },
    {
      status: status.cache.writable ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
