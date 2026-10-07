"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, HarborBundle, WindowForecast } from "@/lib/types";
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
        shortLabel: `${start.day}日（${WEEKDAYS[start.weekday]}）`,
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
      <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeOpacity="0.18" />
      <path
        d="M24 5.5v4.2M24 38.3V43M5.5 24h4.2M38.3 24H43"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <g
        transform={`rotate(${degrees + 180} 24 24)`}
        style={{ transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
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
    <div className="relative h-1.5 w-full max-w-[7.5rem] overflow-hidden rounded-sm bg-sand">
      <div
        className={cn("absolute inset-y-0 left-0 rounded-sm", blocked ? "bg-warn/35" : "bg-sea/25")}
        style={{ width: `${gustPct}%` }}
      />
      <div
        className={cn("absolute inset-y-0 left-0 rounded-sm", blocked ? "bg-warn" : "bg-sea")}
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

function ChartWindArrow({
  degrees,
  blocked,
}: {
  degrees: number | null;
  blocked: boolean;
}) {
  if (degrees === null) {
    return (
      <span
        className="mx-auto block size-1 rounded-full bg-muted/45"
        title="風向なし"
      />
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn("mx-auto block size-3", blocked ? "text-warn" : "text-sea")}
    >
      <g
        style={{
          transform: `rotate(${degrees + 180}deg)`,
          transformOrigin: "6px 6px",
          transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <path
          d="M6 1.6v7.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M6 1.5 3.6 4M6 1.5 8.4 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function daySectionId(key: string): string {
  return `day-${key}`;
}

function scrollToDay(key: string) {
  const target = document.getElementById(daySectionId(key));
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("day-flash");
  window.setTimeout(() => target.classList.remove("day-flash"), 1200);
}

function WindOverview({
  groups,
  scale,
}: {
  groups: DayGroup[];
  scale: number;
}) {
  const barOffsets = groups.reduce<number[]>((offsets, group, index) => {
    const previous = index === 0 ? 0 : offsets[index - 1] + groups[index - 1].windows.length;
    offsets.push(previous);
    return offsets;
  }, []);
  return (
    <div className="anim-rise anim-rise-delay-2 mt-5 rounded-xl border border-line/70 bg-paper/55 p-4 backdrop-blur-sm sm:p-5">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <li className="font-medium text-ink/70">天気</li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-sun" />
          晴れ
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-muted" />
          くもり
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-sea" />
          雨
        </li>
        <li className="flex items-center gap-1.5 sm:ml-2">
          <span className="size-2.5 rounded-sm bg-warn" />
          出艇不可能
        </li>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 text-sea">
            <path
              d="M6 1.6v7.2M6 1.5 3.6 4M6 1.5 8.4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          矢印は向かう向き
        </li>
        <li>棒を押すとその日へ</li>
      </ul>
      <div className="mt-4 flex gap-2">
        <div className="flex w-7 shrink-0 flex-col" aria-hidden="true">
          <div className="h-1.5" />
          <div className="mt-1.5 h-4" />
          <div className="mt-1.5 flex h-28 flex-col justify-between text-[10px] tabular-nums leading-none text-muted">
            <span>{scale}</span>
            <span>0</span>
          </div>
        </div>
        <div className="-mx-1 min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-1 pb-1 [-webkit-overflow-scrolling:touch]">
          <div
            className="flex gap-px"
            style={{ minWidth: `max(100%, ${Math.max(groups.length, 1) * 4.5}rem)` }}
          >
          {groups.map((group, groupIndex) => (
            <button
              key={group.key}
              type="button"
              onClick={() => scrollToDay(group.key)}
              className="group/day min-w-0 rounded-md px-px py-1 text-left transition-colors hover:bg-sea/8 focus-visible:bg-sea/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea/40 active:bg-sea/12"
              style={{ flex: groupHours(group), minWidth: `${Math.max(groupHours(group) * 0.7, 3.25)}rem` }}
              aria-label={`${group.label}の詳細へ`}
            >
              <div className="flex h-1.5 gap-px overflow-hidden rounded-sm" aria-hidden="true">
                {group.windows.map((window) => (
                  <div key={window.start} className="min-w-0 px-px" style={{ flex: durationHours(window) }}>
                    <div className={cn("h-1.5 rounded-[1px]", weatherBand(window.weather))} />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex h-4 items-center gap-px">
                {group.windows.map((window) => (
                  <div
                    key={window.start}
                    className="flex min-w-0 justify-center px-px"
                    style={{ flex: durationHours(window) }}
                    title={
                      window.windFromLabel
                        ? `${window.windFromLabel}（向かう向きの矢印）`
                        : "風向なし"
                    }
                  >
                    <ChartWindArrow
                      degrees={window.windFromDeg}
                      blocked={window.noDeparture}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex h-28 items-end gap-px" aria-hidden="true">
                {group.windows.map((window, windowIndex) => {
                  const mean = window.windMeanMs ?? 0;
                  const gust = window.windGustMs ?? 0;
                  const meanPct = window.available ? Math.min(100, (mean / scale) * 100) : 0;
                  const extraPct = window.available
                    ? Math.max(0, Math.min(100, (Math.max(mean, gust) / scale) * 100) - meanPct)
                    : 0;
                  const delay = `${Math.min(barOffsets[groupIndex] + windowIndex, 40) * 18}ms`;
                  return (
                    <div
                      key={window.start}
                      className="flex h-full min-w-0 items-end px-px"
                      style={{ flex: durationHours(window) }}
                    >
                      <div
                        className="wind-bar flex h-full w-full flex-col justify-end"
                        style={{ animationDelay: delay }}
                      >
                        <div
                          className={cn("w-full rounded-t-[1px]", window.noDeparture ? "bg-warn/35" : "bg-sea/20")}
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
              <div className="mt-2 hidden gap-px sm:flex" aria-hidden="true">
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
              <p className="mt-1 truncate border-t border-line/80 pt-1.5 text-center text-[10px] font-medium leading-tight text-ink/70 transition-colors group-hover/day:text-sea sm:text-[11px]">
                {group.shortLabel}
              </p>
            </button>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HarborPanel({ harbor }: { harbor: HarborBundle }) {
  const latest = harbor.latest;
  const rising =
    harbor.riseRateMsPerHour !== null && harbor.riseRateMsPerHour >= 1.5;
  const falling =
    harbor.riseRateMsPerHour !== null && harbor.riseRateMsPerHour <= -1.5;

  return (
    <section className="anim-rise space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl tracking-tight text-ink sm:text-2xl">
            江の島ハーバー実況
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted sm:text-sm sm:leading-6">
            {harbor.note}
          </p>
        </div>
        <p className="text-xs text-muted">出典：{harbor.source}</p>
      </div>

      {latest ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-muted">いま</p>
            <p className="mt-0.5 font-serif text-3xl tabular-nums leading-none text-ink sm:text-4xl">
              {latest.meanMs.toFixed(1)}
              <span className="ml-1 text-base font-sans text-muted">m/s</span>
            </p>
          </div>
          <div className="pb-0.5">
            <p className="font-serif text-xl text-ink">{latest.fromLabel ?? "—"}</p>
            <p className="text-xs tabular-nums text-muted">
              最大 {latest.maxMs.toFixed(1)} · {formatStamp(latest.at)}
            </p>
          </div>
          <div className="pb-0.5">
            <p
              className={cn(
                "font-serif text-xl tabular-nums",
                rising ? "text-warn" : falling ? "text-sea" : "text-ink",
              )}
            >
              {harbor.riseRateMsPerHour === null
                ? "—"
                : `${harbor.riseRateMsPerHour >= 0 ? "+" : ""}${harbor.riseRateMsPerHour.toFixed(1)}`}
              <span className="ml-1 text-xs font-sans text-muted">m/s毎時</span>
            </p>
            <p className="text-xs text-muted">
              風向変化{" "}
              {harbor.directionChangeDeg === null
                ? "—"
                : `${harbor.directionChangeDeg >= 0 ? "+" : ""}${Math.round(harbor.directionChangeDeg)}°`}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">実況はまだありません。</p>
      )}

      {harbor.nowcast.length > 0 ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-4 sm:px-5 sm:py-5",
            rising
              ? "border-warn/35 bg-warn-bg/50"
              : "border-sea/30 bg-[linear-gradient(165deg,#e7f3f4_0%,#edf3f4_55%,#e8eef0_100%)]",
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-medium tracking-[0.16em] text-sea">NOWCAST</p>
              <h3 className="mt-1 font-serif text-2xl tracking-tight text-ink sm:text-3xl">
                ナウキャスト
              </h3>
            </div>
            <p className="max-w-xs text-right text-xs leading-5 text-muted sm:text-sm">
              直近の傾きが続く場合の平均風速
            </p>
          </div>
          <ol className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            {harbor.nowcast.map((point, index) => {
              const delta =
                latest === null ? null : point.meanMs - latest.meanMs;
              return (
                <li
                  key={point.minutesAhead}
                  className={cn(
                    "rounded-lg bg-paper/80 px-2 py-3 text-center sm:px-3 sm:py-4",
                    index === harbor.nowcast.length - 1 && "ring-1 ring-sea/25",
                  )}
                  style={{ animationDelay: `${0.05 + index * 0.06}s` }}
                >
                  <p className="text-xs font-medium text-muted sm:text-sm">
                    {point.minutesAhead}分後
                  </p>
                  <p className="mt-2 font-serif text-3xl tabular-nums leading-none text-ink sm:text-4xl">
                    {point.meanMs.toFixed(1)}
                  </p>
                  <p className="mt-1 text-xs text-muted">m/s</p>
                  {delta !== null ? (
                    <p
                      className={cn(
                        "mt-2 text-xs tabular-nums font-medium",
                        delta > 0.15 ? "text-warn" : delta < -0.15 ? "text-sea" : "text-muted",
                      )}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(1)} いま比
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : latest ? (
        <div className="rounded-xl border border-line/70 bg-sand/40 px-4 py-3 text-sm text-muted">
          ナウキャストに必要な直近の傾きがまだ足りません。
        </div>
      ) : null}

      {harbor.alerts.length > 0 ? (
        <div className="space-y-2">
          {harbor.alerts.map((alert) => (
            <div
              key={`${alert.kind}-${alert.message}`}
              className={cn(
                "border-l-2 px-3 py-2 text-sm leading-6",
                alert.level === "watch"
                  ? "border-warn bg-warn-bg/80 text-warn"
                  : "border-sea/50 bg-sand/60 text-ink/80",
              )}
            >
              {alert.message}
            </div>
          ))}
        </div>
      ) : null}

      {harbor.pattern.match ? (
        <div className="border-l-2 border-sea bg-sand/70 px-3 py-2 text-sm leading-6 text-ink/85">
          <p className="font-medium tracking-wide text-sea">急上昇補正</p>
          <p className="mt-1">{harbor.pattern.match.note}</p>
        </div>
      ) : null}

      <details className="group border-t border-line/60 pt-3">
        <summary className="cursor-pointer list-none text-xs text-muted marker:content-none">
          <span className="underline decoration-line underline-offset-2 group-open:text-ink">
            学習の状態
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-5 text-muted">
          <p>急上昇パターン {harbor.pattern.storedEvents} 件</p>
          {harbor.mos ? (
            <>
              <p>{harbor.mos.note}</p>
              <p className="tabular-nums">
                ペア {harbor.mos.pairCount} · ビン {harbor.mos.binCount} · 適用可能{" "}
                {harbor.mos.activeBins}
              </p>
              <p>
                約 {harbor.mos.continuous.intervalMinutes} 分ごとに自動学習
                {harbor.mos.continuous.lastTickAt
                  ? `（前回 ${formatStamp(harbor.mos.continuous.lastTickAt)}）`
                  : ""}
                。
              </p>
            </>
          ) : null}
        </div>
      </details>

      {harbor.degraded ? (
        <p className="text-xs text-muted">取得に失敗したため、保存した実況を表示しています。</p>
      ) : null}
    </section>
  );
}

function WindowCard({ window, scale }: { window: WindowForecast; scale: number }) {
  const { hours, partial } = formatHours(window);
  return (
    <article
      className={cn(
        "flex flex-col border-t-2 px-2.5 py-3 transition-colors sm:px-3 sm:py-3.5",
        window.noDeparture
          ? "border-warn bg-warn-bg/70"
          : "border-sea/25 bg-paper/40 hover:bg-paper/70",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium tabular-nums text-ink">{hours}</h3>
        <div className="flex flex-col items-end gap-0.5">
          {window.noDeparture ? <p className="text-xs font-medium tracking-wide text-warn">出艇不可能</p> : null}
          {window.mosAdjusted ? (
            <p className="text-[10px] font-medium tracking-wide text-sea">局地補正</p>
          ) : null}
          {window.harborAdjusted ? (
            <p className="text-[10px] font-medium tracking-wide text-sea">急上昇補正</p>
          ) : null}
        </div>
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
          <p className="mt-1.5 text-sm tabular-nums text-ink">
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
      if (!body.ifs && !body.harbor && !body.jma) {
        setData(null);
        setError(body.errors[0] ?? "予報を取得できませんでした。");
        return;
      }
      setData(body);
      if (!body.ifs && body.errors[0]) setError(body.errors[0]);
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
    <section className="anim-rise space-y-6 sm:space-y-8" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 text-sm leading-6 text-muted">
          {data?.ifs ? (
            <>
              <p className="font-medium text-ink/80">
                ECMWF 初期値 {formatStamp(data.ifs.initTime)}
                <span className="font-normal text-muted">（日本時間）</span>
              </p>
              {data.ifs.ageHours > 24 ? (
                <p className="mt-1">この初期値は24時間より古いです。</p>
              ) : null}
              {data.ifs.degraded ? (
                <p className="mt-1">新しい初期値を取りきれなかったため、保存した数値を含みます。</p>
              ) : null}
            </>
          ) : (
            <p>{loading ? "ECMWF の数値予報を取得しています。" : "数値予報はまだありません。"}</p>
          )}
          {loading && !data?.ifs ? (
            <p className="mt-1">最初の取得は数分かかることがあります。</p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full shrink-0 sm:w-auto"
          onClick={() => void load(true)}
          disabled={loading}
        >
          {loading ? "取得しています" : "再取得"}
        </Button>
      </div>

      {error ? <p className="text-sm text-warn">{error}</p> : null}

      {data?.jma && data.jma.warnings.length > 0 ? (
        <div className="border-l-2 border-warn bg-warn-bg/80 px-4 py-3 text-sm leading-6 text-warn">
          <p className="font-medium tracking-wide">鎌倉市に発表中</p>
          <ul className="mt-1.5 space-y-0.5">
            {data.jma.warnings.map((warning) => (
              <li key={warning.code} className={warning.severe ? "font-medium" : undefined}>
                {warning.name}（{warning.status}
                {warning.notes.length > 0 ? `・${warning.notes.join("・")}` : ""}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data?.harbor ? <HarborPanel harbor={data.harbor} /> : null}

      <div>
        <div>
          <h2 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">風と天気</h2>
          <p className="mt-1 text-sm text-muted">ECMWF · 3時間ごと · 144時間先まで</p>
          <details className="group mt-2 max-w-2xl">
            <summary className="cursor-pointer list-none text-xs text-sea marker:content-none">
              <span className="underline decoration-line underline-offset-2">図の見方</span>
            </summary>
            <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted">
              <li>棒は地上10mの平均風速、うすい部分は最大瞬間風速（目盛の上端は {scale} m/s）。</li>
              <li>矢印は風の向かう向き（上が北）。日付を押すとその日の詳細へ。</li>
              <li>平均 10 m/s 以上、または瞬間 13 m/s 以上は出艇不可能。</li>
              <li className="text-xs">
                瞬間は初期値から90時間先までが枠末の1時間、それ以降は3時間の最大。下の方位は吹いてくる向き。
              </li>
            </ul>
          </details>
        </div>
        {windows.some((window) => window.noDeparture) ? (
          <div className="mt-4 border-l-2 border-warn bg-warn-bg/80 px-4 py-3 text-sm leading-6 text-warn">
            <p className="font-medium tracking-wide">出艇不可能</p>
            <ul className="mt-1.5 columns-1 gap-x-8 sm:columns-2">
              {windows.filter((window) => window.noDeparture).map((window) => {
                const start = jstParts(Date.parse(window.start));
                const { hours, partial } = formatHours(window);
                return (
                  <li key={window.start} className="break-inside-avoid">
                    {start.month}月{start.day}日 {hours}
                    {partial ? `（${partial}）` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {loading && !data?.ifs ? (
          <div className="mt-5 space-y-3">
            <div className="skeleton-pulse h-36 rounded-xl bg-sand/80" />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton-pulse h-44 bg-sand/70" />
              ))}
            </div>
          </div>
        ) : null}
        {groups.length > 0 ? <WindOverview groups={groups} scale={scale} /> : null}
        <div className="mt-8 space-y-10">
          {groups.map((group, groupIndex) => (
            <section
              key={group.key}
              id={daySectionId(group.key)}
              className="anim-rise scroll-mt-[max(1.5rem,env(safe-area-inset-top))] rounded-lg"
              style={{ animationDelay: `${0.08 + groupIndex * 0.04}s` }}
            >
              <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2">
                <h3 className="font-serif text-xl tracking-tight text-ink">{group.label}</h3>
                <p className="text-xs tracking-wide text-muted">3時間ごと</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 md:grid-cols-4">
                {group.windows.map((window) => (
                  <WindowCard key={window.start} window={window} scale={scale} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
