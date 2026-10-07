"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, WindowForecast } from "@/lib/types";
import { jstParts } from "@/lib/time";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const WIND_SCALE_FLOOR_MS = 13;

type DayGroup = {
  key: string;
  label: string;
  shortLabel: string;
  windows: WindowForecast[];
};

function formatStamp(iso: string): string {
  const parts = jstParts(Date.parse(iso));
  return `${parts.month}月${parts.day}日 ${parts.hour}時`;
}

function durationHours(window: WindowForecast): number {
  return (Date.parse(window.end) - Date.parse(window.start)) / (60 * 60 * 1000);
}

function formatHours(window: WindowForecast): { hours: string; partial: string | null } {
  const start = jstParts(Date.parse(window.start));
  const end = jstParts(Date.parse(window.end));
  const endHour = end.hour === 0 ? 24 : end.hour;
  const partial = window.partialFrom
    ? `${jstParts(Date.parse(window.partialFrom)).hour}時以降`
    : null;
  return { hours: `${start.hour}–${endHour}時`, partial };
}

function formatTemp(min: number, max: number): string {
  const low = Math.round(min);
  const high = Math.round(max);
  return low === high ? `${low}℃` : `${low}–${high}℃`;
}

function formatMs(value: number): string {
  return value.toFixed(1);
}

function formatKt(ms: number): string {
  return String(Math.round(ms * 1.943844));
}

function windScale(windows: WindowForecast[]): number {
  const peak = Math.max(
    0,
    ...windows.map((window) => Math.max(window.windMeanMs ?? 0, window.windGustMs ?? 0)),
  );
  return Math.max(WIND_SCALE_FLOOR_MS, Math.ceil(peak));
}

function groupWindows(windows: WindowForecast[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const window of windows) {
    const start = jstParts(Date.parse(window.start));
    const key = `${start.year}-${start.month}-${start.day}`;
    const last = groups.at(-1);
    if (!last || last.key !== key) {
      groups.push({
        key,
        label: `${start.month}月${start.day}日（${WEEKDAYS[start.weekday]}）`,
        shortLabel: `${start.day}日`,
        windows: [window],
      });
    } else {
      last.windows.push(window);
    }
  }
  return groups;
}

function groupHours(group: DayGroup): number {
  return group.windows.reduce((sum, window) => sum + durationHours(window), 0);
}

function WeatherIcon({
  weather,
  className,
}: {
  weather: WindowForecast["weather"];
  className?: string;
}) {
  if (weather === "晴れ") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("text-sun", className)}>
        <circle cx="12" cy="12" r="3.4" fill="currentColor" />
        <path
          d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.05 5.05l1.55 1.55M17.4 17.4l1.55 1.55M18.95 5.05l-1.55 1.55M6.6 17.4l-1.55 1.55"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (weather === "雨") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("text-sea", className)}>
        <path
          fill="currentColor"
          d="M7.2 14.2h8.6a3.1 3.1 0 0 0 .3-6.2 4.2 4.2 0 0 0-8.1-1.1 2.9 2.9 0 0 0-.8 7.3z"
        />
        <path
          d="M8.2 16.2 7.2 19M12 16.2 11 19M15.8 16.2 14.8 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (weather === "くもり") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("text-muted", className)}>
        <path
          fill="currentColor"
          d="M7.1 17.2h9.4a3.5 3.5 0 0 0 .4-7 4.7 4.7 0 0 0-9-1.3 3.3 3.3 0 0 0-.8 8.3z"
        />
      </svg>
    );
  }
  return <span className={className} />;
}

function WindCompass({ degrees }: { degrees: number }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-11 shrink-0 text-sea">
      <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeOpacity="0.22" />
      <path
        d="M24 5.5v4.2M24 38.3V43M5.5 24h4.2M38.3 24H43"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <g transform={`rotate(${degrees + 180} 24 24)`}>
        <path
          d="M24 13.5v15.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M24 13.2 19.4 19.4M24 13.2l4.6 6.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function WindTrack({
  mean,
  gust,
  scale,
  blocked,
}: {
  mean: number;
  gust: number;
  scale: number;
  blocked: boolean;
}) {
  const meanPct = Math.min(100, (mean / scale) * 100);
  const gustPct = Math.min(100, (Math.max(mean, gust) / scale) * 100);
  return (
    <div className="relative h-1.5 w-28 rounded-full bg-paper">
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", blocked ? "bg-warn/35" : "bg-sea/30")}
        style={{ width: `${gustPct}%` }}
      />
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", blocked ? "bg-warn" : "bg-sea")}
        style={{ width: `${meanPct}%` }}
      />
    </div>
  );
}

function weatherBand(weather: WindowForecast["weather"]): string {
  if (weather === "晴れ") return "bg-sun";
  if (weather === "雨") return "bg-sea";
  if (weather === "くもり") return "bg-muted";
  return "bg-line";
}

function startHour(window: WindowForecast): number {
  return jstParts(Date.parse(window.start)).hour;
}

function WindOverview({
  groups,
  scale,
}: {
  groups: DayGroup[];
  scale: number;
}) {
  return (
    <div className="mt-4">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <li>帯は天気</li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 bg-sun" />
          晴れ
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 bg-muted" />
          くもり
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 bg-sea" />
          雨
        </li>
      </ul>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <span className="size-2.5 bg-warn" />
        この色の棒は出艇不可能
      </p>
      <div className="mt-3 flex gap-2" aria-hidden="true">
        <div className="flex w-6 shrink-0 flex-col">
          <div className="h-2" />
          <div className="mt-1 flex h-20 flex-col justify-between text-[10px] tabular-nums leading-none text-muted">
            <span>{scale}</span>
            <span>0</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-2 gap-1">
            {groups.map((group) => (
              <div key={group.key} className="flex min-w-0" style={{ flex: groupHours(group) }}>
                {group.windows.map((window) => (
                  <div key={window.start} className="px-px" style={{ flex: durationHours(window) }}>
                    <div className={cn("h-2", weatherBand(window.weather))} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 flex h-20 items-end gap-1">
            {groups.map((group) => (
              <div key={group.key} className="flex h-full min-w-0 items-end" style={{ flex: groupHours(group) }}>
                {group.windows.map((window) => {
                  const mean = window.windMeanMs ?? 0;
                  const gust = window.windGustMs ?? 0;
                  const meanPct = window.available ? Math.min(100, (mean / scale) * 100) : 0;
                  const extraPct = window.available
                    ? Math.max(0, Math.min(100, (Math.max(mean, gust) / scale) * 100) - meanPct)
                    : 0;
                  return (
                    <div
                      key={window.start}
                      className="flex h-full min-w-0 items-end px-px"
                      style={{ flex: durationHours(window) }}
                    >
                      <div className="flex h-full w-full flex-col justify-end">
                        <div
                          className={cn("w-full", window.noDeparture ? "bg-warn/35" : "bg-sea/25")}
                          style={{ height: `${extraPct}%` }}
                        />
                        <div
                          className={cn("w-full", window.noDeparture ? "bg-warn" : "bg-sea")}
                          style={{ height: `${meanPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1 hidden gap-1 sm:flex">
            {groups.map((group) => (
              <div key={group.key} className="flex min-w-0" style={{ flex: groupHours(group) }}>
                {group.windows.map((window) => (
                    <p
                    key={window.start}
                    className="min-w-0 truncate text-center text-[10px] tabular-nums text-muted"
                    style={{ flex: durationHours(window) }}
                  >
                    {startHour(window) % 6 === 0 ? startHour(window) : ""}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-0.5 flex gap-1 border-t border-line pt-1">
            {groups.map((group) => (
              <p
                key={group.key}
                className="min-w-0 truncate text-center text-[11px] text-muted"
                style={{ flex: groupHours(group) }}
              >
                {group.shortLabel}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WindowCard({ window, scale }: { window: WindowForecast; scale: number }) {
  const { hours, partial } = formatHours(window);
  return (
    <article
      className={cn("flex flex-col px-3 py-3", window.noDeparture ? "bg-warn-bg" : "bg-sand/80")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm text-ink">{hours}</h3>
        {window.noDeparture ? <p className="text-sm font-medium text-warn">出艇不可能</p> : null}
      </div>
      <p className="text-xs text-muted">{partial ?? "\u00a0"}</p>
      <div className="mt-3 flex flex-1 flex-col gap-4">
        <div className="flex items-center gap-3">
          <WeatherIcon weather={window.weather} className="size-9 shrink-0" />
          <div>
            <p className="font-serif text-xl leading-none text-ink">{window.weather}</p>
            <p className={cn("mt-1 text-xs tabular-nums", (window.precipMm ?? 0) >= 1 ? "text-ink" : "text-muted")}>
              {window.precipMm?.toFixed(1)} mm
            </p>
            <p className="text-sm tabular-nums text-ink">
              {formatTemp(window.tempMinC ?? 0, window.tempMaxC ?? 0)}
            </p>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            {window.windFromDeg !== null ? (
              <WindCompass degrees={window.windFromDeg} />
            ) : (
              <span className="size-11 shrink-0" />
            )}
            <p className="font-serif text-lg leading-none text-ink">{window.windFromLabel}</p>
          </div>
          <div className="mt-2">
            <WindTrack
              mean={window.windMeanMs ?? 0}
              gust={window.windGustMs ?? 0}
              scale={scale}
              blocked={window.noDeparture}
            />
          </div>
          <p className="mt-1 text-sm tabular-nums text-ink">
            {formatMs(window.windMeanMs ?? 0)} m/s
            <span className="text-muted"> 瞬間 {formatMs(window.windGustMs ?? 0)}</span>
          </p>
          <p className="text-xs tabular-nums text-muted">
            {formatKt(window.windMeanMs ?? 0)} kt / 瞬間 {formatKt(window.windGustMs ?? 0)} kt
          </p>
        </div>
      </div>
    </article>
  );
}

export function ForecastBoard() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(refresh ? "/api/forecast?refresh=1" : "/api/forecast");
      const body = (await response.json()) as ForecastResponse;
      if (!body.ifs) {
        setData(body.jma ? body : null);
        setError(body.errors[0] ?? "数値予報を取得できませんでした。");
        return;
      }
      setData(body);
    } catch {
      setError("予報を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const windows = data?.ifs?.windows ?? [];
  const groups = groupWindows(windows);
  const scale = windScale(windows);

  return (
    <section className="pt-6" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm leading-6 text-muted">
          {data?.ifs ? (
            <>
              <p>ECMWF 初期値 {formatStamp(data.ifs.initTime)}（日本時間）</p>
              {data.ifs.ageHours > 24 ? (
                <p>この初期値は24時間より古いです。</p>
              ) : null}
              {data.ifs.degraded ? (
                <p>新しい初期値を取りきれなかったため、保存した数値を含みます。</p>
              ) : null}
            </>
          ) : (
            <p>{loading ? "ECMWF の数値予報を取得しています。" : "数値予報はまだありません。"}</p>
          )}
          {loading && !data?.ifs ? (
            <p>最初の取得は数分かかることがあります。</p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={loading}
        >
          {loading ? "取得しています" : "再取得"}
        </Button>
      </div>

      {error ? <p className="mt-4 text-sm text-warn">{error}</p> : null}

      {data?.jma && data.jma.warnings.length > 0 ? (
        <div className="mt-6 border border-warn/30 bg-warn-bg px-4 py-3 text-sm leading-6 text-warn">
          <p className="font-medium">鎌倉市に発表中</p>
          <ul className="mt-1">
            {data.jma.warnings.map((warning) => (
              <li key={warning.code} className={warning.severe ? "font-medium" : undefined}>
                {warning.name}（{warning.status}
                {warning.notes.length > 0 ? `・${warning.notes.join("・")}` : ""}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="font-serif text-2xl text-ink">風と天気</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          144時間先まで、3時間ごとです。高さは地上10mの風速、うすい部分は最大瞬間風速まで。上端は {scale} m/s です。平均 10 m/s 以上、または最大瞬間風速 13 m/s 以上の枠は出艇不可能です。最大瞬間風速は、初期時刻から90時間先までは枠の終わり直前1時間、それより先は直前3時間の値です。矢印は風の向かう向き、言葉は吹いてくる向き。方位の上は北です。
        </p>
        {windows.some((window) => window.noDeparture) ? (
          <div className="mt-4 border border-warn/30 bg-warn-bg px-4 py-3 text-sm leading-6 text-warn">
            <p className="font-medium">出艇不可能</p>
            <ul className="mt-1">
              {windows.filter((window) => window.noDeparture).map((window) => {
                const start = jstParts(Date.parse(window.start));
                const { hours, partial } = formatHours(window);
                return (
                  <li key={window.start}>
                    {start.month}月{start.day}日 {hours}
                    {partial ? `（${partial}）` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {loading && !data?.ifs ? (
          <div className="mt-4 space-y-3">
            <div className="h-20 animate-pulse bg-sand/60" />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-40 animate-pulse bg-sand/60" />
              ))}
            </div>
          </div>
        ) : null}
        {groups.length > 0 ? <WindOverview groups={groups} scale={scale} /> : null}
        <div className="mt-6 space-y-8">
          {groups.map((group) => {
            return (
              <section key={group.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-xl text-ink">{group.label}</h3>
                  <p className="text-xs text-muted">3時間ごと</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {group.windows.map((window) => (
                    <WindowCard key={window.start} window={window} scale={scale} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
