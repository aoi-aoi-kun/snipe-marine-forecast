"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, HarborBundle, WindowForecast } from "@/lib/types";
import { JST_OFFSET_MS, jstParts } from "@/lib/time";
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

function formatHarborObsTime(iso: string): string {
  const shifted = new Date(Date.parse(iso) + JST_OFFSET_MS);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return `${month}月${day}日 ${hour}時${minute.toString().padStart(2, "0")}分`;
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
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label="晴れ"
        className={cn("text-sun", className)}
      >
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
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label="雨"
        className={cn("text-sea", className)}
      >
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
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label="くもり"
        className={cn("text-muted", className)}
      >
        <path
          fill="currentColor"
          d="M7.1 17.2h9.4a3.5 3.5 0 0 0 .4-7 4.7 4.7 0 0 0-9-1.3 3.3 3.3 0 0 0-.8 8.3z"
        />
      </svg>
    );
  }
  return <span className={className} aria-hidden="true" />;
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
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-sand/90">
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", blocked ? "bg-warn/35" : "bg-sea/25")}
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

/** Unified wind arrow: points to the direction the wind is going (fromDeg + 180). */
function WindArrow({
  degrees,
  blocked = false,
  label,
  size = "md",
}: {
  degrees: number | null;
  blocked?: boolean;
  label?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "sm" ? "size-5" : size === "lg" ? "size-10 sm:size-11" : "size-8 sm:size-9";
  if (degrees === null) {
    return (
      <span
        className={cn(
          "mx-auto block rounded-full bg-muted/45",
          size === "sm" ? "size-1.5" : "size-2",
        )}
        title="風向なし"
      />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      aria-label={label ?? undefined}
      role={label ? "img" : undefined}
      className={cn("mx-auto block shrink-0", sizeClass, blocked ? "text-warn" : "text-sea")}
    >
      <g
        style={{
          transform: `rotate(${degrees + 180}deg)`,
          transformOrigin: "12px 12px",
          transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <path
          d="M12 3.2v14.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M12 3.1 7.2 8.8M12 3.1l4.8 5.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
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
    <div className="anim-rise anim-rise-delay-2 surface p-3 sm:p-3.5">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
        <li className="font-medium tracking-wide text-ink/65">天気</li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-sun" />
          晴れ
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-muted" />
          くもり
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-sea" />
          雨
        </li>
        <li className="flex items-center gap-1.5 sm:ml-1">
          <span className="size-2 rounded-sm bg-warn" />
          出艇不可能
        </li>
      </ul>
      <div className="mt-3 flex min-h-0 flex-1 gap-2">
        <div className="flex w-6 shrink-0 flex-col" aria-hidden="true">
          <div className="h-1.5" />
          <div className="mt-1 h-5" />
          <div className="mt-1.5 flex min-h-0 flex-1 flex-col justify-between text-[10px] tabular-nums leading-none text-muted">
            <span>{scale}</span>
            <span>0</span>
          </div>
        </div>
        <div className="-mx-1 min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-1 pb-0.5 [-webkit-overflow-scrolling:touch]">
          <div
            className="flex h-full min-h-[14.5rem] gap-px sm:min-h-[16rem]"
            style={{ minWidth: `max(100%, ${Math.max(groups.length, 1) * 4.25}rem)` }}
          >
          {groups.map((group, groupIndex) => (
            <button
              key={group.key}
              type="button"
              onClick={() => scrollToDay(group.key)}
              className="group/day flex min-w-0 flex-col rounded-lg px-px py-1 text-left transition-colors hover:bg-sea/8 focus-visible:bg-sea/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea/35 active:bg-sea/12"
              style={{ flex: groupHours(group), minWidth: `${Math.max(groupHours(group) * 0.65, 3)}rem` }}
              aria-label={`${group.label}の詳細へ`}
            >
              <div className="flex h-1.5 gap-px overflow-hidden rounded-sm" aria-hidden="true">
                {group.windows.map((window) => (
                  <div key={window.start} className="min-w-0 px-px" style={{ flex: durationHours(window) }}>
                    <div className={cn("h-1.5 rounded-[1px]", weatherBand(window.weather))} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex h-5 items-center gap-px">
                {group.windows.map((window) => (
                  <div
                    key={window.start}
                    className="flex min-w-0 justify-center px-px"
                    style={{ flex: durationHours(window) }}
                    title={window.windFromLabel ?? "風向なし"}
                  >
                    <WindArrow
                      degrees={window.windFromDeg}
                      blocked={window.noDeparture}
                      label={window.windFromLabel}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex min-h-0 flex-1 items-end gap-px" aria-hidden="true">
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
              <div className="mt-1.5 hidden gap-px sm:flex" aria-hidden="true">
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
              <p className="mt-1 truncate border-t border-line/60 pt-1 text-center text-[10px] font-medium leading-tight text-ink/65 transition-colors group-hover/day:text-sea">
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

function harborWindCardClass(over10: boolean): string {
  return cn("tile px-1.5 py-1.5 text-center sm:px-2 sm:py-2", over10 && "tile-warn");
}

function HarborPanel({ harbor }: { harbor: HarborBundle }) {
  const latest = harbor.latest;
  const rising =
    harbor.riseRateMsPerHour !== null && harbor.riseRateMsPerHour >= 1.5;
  const nowcastOver10 = harbor.nowcast.some((point) => point.meanMs > 10);
  const lagMinutes =
    latest === null
      ? null
      : Math.max(0, Math.floor((Date.now() - Date.parse(latest.at)) / 60_000));
  const sourceStale = lagMinutes !== null && lagMinutes >= 20;
  const panelWarn = nowcastOver10 || rising;

  return (
    <section className="anim-rise space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="section-title">江の島ヨットハーバー</h2>
        <details className="group">
          <summary className="cursor-pointer list-none text-[11px] text-muted marker:content-none">
            <span className="soft-link">補足</span>
          </summary>
          <p className="mt-1 max-w-md text-[11px] leading-4 text-muted">
            {harbor.note} 出典：{harbor.source}
          </p>
        </details>
      </div>

      {latest || harbor.nowcast.length > 0 ? (
        <div
          className={cn(
            "px-2.5 py-2.5 sm:px-3 sm:py-3",
            panelWarn ? "surface-warn" : "surface",
          )}
        >
          {nowcastOver10 ? (
            <div className="callout mb-2 py-1.5 text-[11px] leading-4">
              <p className="font-medium tracking-wide">警告 · 10 m/s 超え</p>
              <p className="mt-0.5 text-warn/90">
                ナウキャストの平均が 10 m/s を超えます。出艇の目安を上回る見込みです。
              </p>
            </div>
          ) : null}
          {sourceStale ? (
            <div className="callout mb-2 py-1.5 text-[11px] leading-4">
              <p className="font-medium tracking-wide">実況の公開が停止中</p>
              <p className="mt-0.5 text-warn/90">
                enowin の最新が約 {lagMinutes} 分前のままです。公開側に新しい観測がありません。
              </p>
            </div>
          ) : null}

          <ol
            className={cn(
              "grid gap-1.5 sm:gap-2",
              latest && harbor.nowcast.length > 0
                ? "grid-cols-4"
                : latest || harbor.nowcast.length === 1
                  ? "grid-cols-1 sm:max-w-xs"
                  : "grid-cols-3",
            )}
          >
            {latest ? (
              <li className={cn(harborWindCardClass(sourceStale), "flex flex-col justify-center")}>
                <p className="text-[10px] font-medium text-muted">いま</p>
                <p
                  className={cn(
                    "mt-px text-[9px] leading-3",
                    sourceStale ? "font-medium text-warn" : "text-muted",
                  )}
                >
                  {formatHarborObsTime(latest.at)}
                  {lagMinutes !== null ? `（${lagMinutes}分前）` : ""}
                </p>
                <div className="mt-1 flex justify-center">
                  <WindArrow
                    degrees={latest.fromDeg}
                    label={latest.fromLabel}
                    size="sm"
                  />
                </div>
                <p className="mt-1 font-serif text-xl tabular-nums leading-none tracking-tight text-ink sm:text-2xl">
                  {latest.meanMs.toFixed(1)}
                  <span className="ml-0.5 text-[10px] font-sans text-muted">m/s</span>
                </p>
                <p className="mt-1 text-[9px] tabular-nums text-muted">
                  最大 {latest.maxMs.toFixed(1)}
                </p>
              </li>
            ) : null}

            {harbor.nowcast.map((point, index) => {
              const delta = latest === null ? null : point.meanMs - latest.meanMs;
              const over10 = point.meanMs > 10;
              return (
                <li
                  key={point.minutesAhead}
                  className={cn(harborWindCardClass(over10), "flex flex-col justify-center")}
                  style={{ animationDelay: `${0.05 + index * 0.06}s` }}
                >
                  <p className="text-[10px] font-medium text-muted">
                    {point.minutesAhead}分後
                  </p>
                  <p className="mt-px min-h-3 text-[9px] leading-3" aria-hidden="true" />
                  <div className="mt-1 flex justify-center">
                    <WindArrow
                      degrees={point.fromDeg}
                      blocked={over10}
                      label={point.fromLabel}
                      size="sm"
                    />
                  </div>
                  <p
                    className={cn(
                      "mt-1 font-serif text-xl tabular-nums leading-none tracking-tight sm:text-2xl",
                      over10 ? "text-warn" : "text-ink",
                    )}
                  >
                    {point.meanMs.toFixed(1)}
                    <span className="ml-0.5 text-[10px] font-sans text-muted">m/s</span>
                  </p>
                  {over10 ? (
                    <p className="mt-1 text-[9px] font-medium text-warn">10超え</p>
                  ) : delta !== null ? (
                    <p
                      className={cn(
                        "mt-1 text-[9px] tabular-nums font-medium",
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

          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line/40 pt-2">
            {harbor.nowcast.length > 0 ? (
              <details className="group">
                <summary className="cursor-pointer list-none text-[11px] marker:content-none">
                  <span className="soft-link group-open:text-ink">ナウキャストの説明</span>
                </summary>
                <div className="mt-1.5 space-y-1 text-[11px] leading-4 text-muted">
                  <p>
                    {harbor.nowcastSkill.calibrated
                      ? "過去実況で校正した、風速・風向の短時間予測です。"
                      : "直近の傾きが続くと仮定した、風速・風向の短時間予測です。"}
                  </p>
                  <p>{harbor.nowcastSkill.note}</p>
                </div>
              </details>
            ) : latest && sourceStale ? (
              <p className="text-[11px] text-muted">
                実況の公開停止中のため、短時間予測は出していません。
              </p>
            ) : latest ? (
              <p className="text-[11px] text-muted">直近の傾きが足りず、ナウキャストを出せません。</p>
            ) : null}
            <details className="group">
              <summary className="cursor-pointer list-none text-[11px] text-muted marker:content-none">
                <span className="soft-link group-open:text-ink">学習の状態</span>
              </summary>
              <div className="mt-1.5 space-y-1.5 text-[11px] leading-4 text-muted">
                <p>
                  サーバ起動中は約 {harbor.mos?.continuous.intervalMinutes ?? 15}{" "}
                  分ごとに学習を続けます
                  {harbor.mos?.continuous.started ? "（稼働中）" : "（次の取得で開始）"}
                  {harbor.mos?.continuous.lastTickAt
                    ? ` · 前回 ${formatStamp(harbor.mos.continuous.lastTickAt)}`
                    : ""}
                  。
                </p>
                <p>
                  ナウキャストは
                  {harbor.nowcastSkill.calibrated
                    ? `校正済み（検証 ${harbor.nowcastSkill.caseCount} 件）。`
                    : `検証 ${harbor.nowcastSkill.caseCount} 件を蓄積中。`}
                  沖予報のMOSと急上昇パターン（{harbor.pattern.storedEvents} 件）、補正の補正も更新中。
                  {harbor.mos ? ` ${harbor.mos.note}` : ""}
                </p>
              </div>
            </details>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">実況はまだありません。</p>
      )}

      {harbor.alerts.some((alert) => alert.kind !== "stale") ? (
        <div className="space-y-1.5">
          {harbor.alerts
            .filter((alert) => alert.kind !== "stale")
            .map((alert) => (
              <div
                key={`${alert.kind}-${alert.message}`}
                className={cn(
                  "py-1.5 text-[11px] leading-4",
                  alert.level === "watch" ? "callout" : "callout-sea",
                )}
              >
                {alert.message}
              </div>
            ))}
        </div>
      ) : null}

      {harbor.pattern.match ? (
        <div className="callout-sea py-1.5 text-[11px] leading-4">
          <p className="font-medium tracking-wide text-sea">急上昇補正</p>
          <p className="mt-0.5">{harbor.pattern.match.note}</p>
        </div>
      ) : null}

      {harbor.degraded ? (
        <p className="text-[11px] text-muted">取得に失敗したため、保存済みの実況を表示しています。</p>
      ) : null}
    </section>
  );
}

function WindowCard({ window, scale }: { window: WindowForecast; scale: number }) {
  const { hours, partial } = formatHours(window);
  return (
    <article
      className={cn(
        "tile flex flex-col px-2 py-2 sm:px-2.5 sm:py-2.5",
        window.noDeparture ? "tile-warn" : "hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-sea)_28%,transparent)]",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tabular-nums tracking-tight text-ink sm:text-sm">{hours}</h3>
        <div className="flex flex-col items-end gap-px">
          {window.noDeparture ? (
            <p className="text-[9px] font-medium tracking-wide text-warn">出艇不可能</p>
          ) : null}
          {window.mosAdjusted ? (
            <p className="text-[9px] font-medium tracking-wide text-sea">局地補正</p>
          ) : null}
          {window.harborAdjusted ? (
            <p className="text-[9px] font-medium tracking-wide text-sea">急上昇補正</p>
          ) : null}
          {window.cycleSpreadMs != null && window.cycleSpreadMs >= 1.5 ? (
            <p className="text-[9px] font-medium tracking-wide text-muted">
              初期値差 {window.cycleSpreadMs.toFixed(1)}
            </p>
          ) : null}
        </div>
      </div>
      {partial ? <p className="mt-px text-[10px] text-muted">{partial}</p> : null}
      <div className="mt-2 flex flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <WeatherIcon
            weather={window.weather}
            className="size-6 shrink-0"
          />
          <div className="min-w-0 text-[11px] tabular-nums leading-4">
            <p className={cn((window.precipMm ?? 0) >= 1 ? "text-ink" : "text-muted")}>
              {window.precipMm?.toFixed(1)} mm
            </p>
            <p className="text-ink">{formatTemp(window.tempMinC ?? 0, window.tempMaxC ?? 0)}</p>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <WindArrow
              degrees={window.windFromDeg}
              blocked={window.noDeparture}
              label={window.windFromLabel}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <p className="font-serif text-xl tabular-nums leading-none tracking-tight text-ink">
                {formatMs(window.windMeanMs ?? 0)}
                <span className="ml-0.5 text-[10px] font-sans text-muted">m/s</span>
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-muted">
                瞬間 {formatMs(window.windGustMs ?? 0)}
              </p>
            </div>
          </div>
          <div className="mt-2">
            <WindTrack
              mean={window.windMeanMs ?? 0}
              gust={window.windGustMs ?? 0}
              scale={scale}
              blocked={window.noDeparture}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export function ForecastBoard() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (mode: "page" | "full" | "harbor" = "page") => {
    const silent = mode === "harbor";
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const path =
        mode === "full"
          ? "/api/forecast?refresh=1"
          : "/api/forecast?refreshHarbor=1";
      const response = await fetch(path, { cache: "no-store" });
      const body = (await response.json()) as ForecastResponse;
      if (!body.ifs && !body.harbor && !body.jma) {
        if (!silent) {
          setData(null);
          setError(body.errors[0] ?? "予報を取得できませんでした。");
        }
        return;
      }
      setData(body);
      if (!silent && !body.ifs && body.errors[0]) setError(body.errors[0]);
    } catch {
      if (!silent) setError("予報を取得できませんでした。");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load("page");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // 公開側が止まったあと再開したときすぐ拾えるよう、実況だけ短間隔で取り直す。
  useEffect(() => {
    const HARBOR_POLL_MS = 60 * 1000;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load("harbor");
    }, HARBOR_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load("harbor");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const windows = data?.ifs?.windows ?? [];
  const groups = groupWindows(windows);
  const scale = windScale(windows);

  return (
    <section className="anim-rise space-y-4 sm:space-y-5" aria-live="polite">
      {error ? <p className="callout py-2 text-xs">{error}</p> : null}

      {data?.jma && data.jma.warnings.length > 0 ? (
        <div className="callout py-2 text-xs leading-5">
          <p className="font-medium tracking-wide">鎌倉市に発表中</p>
          <ul className="mt-1 space-y-0.5 text-warn/90">
            {data.jma.warnings.map((warning) => (
              <li key={warning.code} className={warning.severe ? "font-medium" : undefined}>
                {warning.name}（{warning.status}
                {warning.notes.length > 0 ? `・${warning.notes.join("・")}` : ""}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data?.harbor ? (
        <HarborPanel harbor={data.harbor} />
      ) : (
        <div className="space-y-2">
          <h2 className="section-title">江の島ヨットハーバー</h2>
          <div className="skeleton-pulse h-36 bg-sand/70" />
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="section-title">風と天気</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <details className="group">
              <summary className="cursor-pointer list-none text-[11px] marker:content-none">
                <span className="soft-link">図の見方</span>
              </summary>
              <ul className="mt-1.5 max-w-xl space-y-1 text-[11px] leading-4 text-muted">
                <li>
                  {data?.ifs
                    ? `ECMWF 初期値 ${formatStamp(data.ifs.initTime)}（日本時間）· 3時間ごと · 144時間先まで`
                    : "ECMWF · 3時間ごと · 144時間先まで"}
                </li>
                {data?.ifs?.ageHours && data.ifs.ageHours > 24 ? (
                  <li className="text-warn">この初期値は 24 時間より古いです。</li>
                ) : null}
                {data?.ifs?.degraded ? (
                  <li>新しい初期値を取れなかったため、保存済みの数値を含みます。</li>
                ) : null}
                {!data?.ifs ? (
                  <li>
                    {loading
                      ? "ECMWF を取得中です。初回は数分かかることがあります。"
                      : "数値予報はまだありません。"}
                  </li>
                ) : null}
                <li>棒は地上10mの平均、うすい部分は最大瞬間（目盛の上端は {scale} m/s）。沖の数値です。</li>
                <li>平均 10 m/s 以上、または瞬間 13 m/s 以上は出艇不可能。</li>
                <li>瞬間は初期値から90時間先までが枠末1時間、それ以降は3時間の最大。</li>
                <li>「初期値差」は前後のECMWF初期値で風速がどれだけ違うかの目安です。</li>
              </ul>
            </details>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2.5 text-[11px]"
              onClick={() => void load("full")}
              disabled={loading}
            >
              {loading ? "取得中" : "再取得"}
            </Button>
          </div>
        </div>

        {windows.some((window) => window.noDeparture) ? (
          <div className="callout mt-2 py-2 text-xs leading-5">
            <p className="font-medium tracking-wide">出艇不可能</p>
            <ul className="mt-1 columns-1 gap-x-8 text-warn/90 sm:columns-2">
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

        {groups.length > 0 ? (
          <div className="mt-2">
            <WindOverview groups={groups} scale={scale} />
          </div>
        ) : loading ? (
          <div className="skeleton-pulse mt-2 h-40 bg-sand/75" />
        ) : (
          <p className="mt-2 text-[11px] text-muted">数値予報はまだありません。</p>
        )}

        {groups.length > 0 ? (
          <div className="mt-7 space-y-7">
            {groups.map((group, groupIndex) => (
              <section
                key={group.key}
                id={daySectionId(group.key)}
                className="anim-rise scroll-mt-[max(1.5rem,env(safe-area-inset-top))]"
                style={{ animationDelay: `${0.08 + groupIndex * 0.04}s` }}
              >
                <div className="flex items-baseline justify-between gap-3 border-b border-line/45 pb-1.5">
                  <h3 className="font-serif text-base tracking-tight text-ink/90 sm:text-lg">
                    {group.label}
                  </h3>
                  <p className="text-[10px] tracking-wide text-muted">3時間ごと</p>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {group.windows.map((window) => (
                    <WindowCard key={window.start} window={window} scale={scale} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
