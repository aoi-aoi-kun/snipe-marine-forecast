import { startContinuousLearning } from "@/lib/continuous-learn";
import { getLearnStatus } from "@/lib/learn-status";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every Nth warm also refreshes IFS so archive/MOS do not stall on free-tier cron. */
const FULL_REFRESH_EVERY = 6;
let warmCount = 0;

/** Liveness + learning health. Use ?warm=1 from an external cron to wake and train. */
export async function GET(request: Request) {
  startContinuousLearning();
  const url = new URL(request.url);
  const warm = url.searchParams.get("warm") === "1";
  const full = url.searchParams.get("full") === "1";

  if (warm || full) {
    warmCount += 1;
    const refresh = full || warmCount % FULL_REFRESH_EVERY === 0;
    // Fire-and-forget so cron stays fast but learning still moves.
    void import("@/lib/forecast").then(({ getForecast }) =>
      getForecast(refresh ? { refresh: true } : { refreshHarbor: true }),
    );
  }

  const status = await getLearnStatus();
  return NextResponse.json(
    {
      ...status,
      warm: {
        count: warmCount,
        lastRequestedFull: Boolean(full || (warm && warmCount % FULL_REFRESH_EVERY === 0)),
      },
    },
    {
      status: status.cache.writable ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
