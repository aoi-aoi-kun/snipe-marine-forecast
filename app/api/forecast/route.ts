import { startContinuousLearning } from "@/lib/continuous-learn";
import { getForecast } from "@/lib/forecast";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  startContinuousLearning();
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const refreshHarbor = url.searchParams.get("refreshHarbor") === "1";
  const forecast = await getForecast({ refresh, refreshHarbor });
  // Harbor-only or IFS-only is still a usable page; reserve 503 for total failure.
  const usable = Boolean(forecast.ifs || forecast.harbor || forecast.jma);
  return NextResponse.json(forecast, {
    status: usable ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
