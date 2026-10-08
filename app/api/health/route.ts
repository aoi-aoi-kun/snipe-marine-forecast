import { startContinuousLearning } from "@/lib/continuous-learn";
import { getLearnStatus } from "@/lib/learn-status";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + learning health. Use ?warm=1 from an external cron to wake and train. */
export async function GET(request: Request) {
  startContinuousLearning();
  const url = new URL(request.url);
  const warm = url.searchParams.get("warm") === "1";

  if (warm) {
    // Fire-and-forget harbor refresh so cron stays fast but learning still moves.
    void import("@/lib/forecast").then(({ getForecast }) =>
      getForecast({ refreshHarbor: true }),
    );
  }

  const status = await getLearnStatus();
  return NextResponse.json(status, {
    status: status.cache.writable ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
