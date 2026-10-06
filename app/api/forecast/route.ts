import { getForecast } from "@/lib/forecast";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const forecast = await getForecast(refresh);
  return NextResponse.json(forecast, {
    status: forecast.ifs ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
