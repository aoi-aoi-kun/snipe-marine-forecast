"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, HarborBundle } from "@/lib/types";
import {
  HARBOR_SOURCE_LABEL,
  WINDY_URL,
  formatContinuousLine,
  formatLearnLead,
  formatLearnMetrics,
  formatLearningTrend,
  formatPatternMatchNote,
  shortenLearningNote,
  windyBlurb,
} from "@/lib/ui-copy";
import { JST_OFFSET_MS, jstParts } from "@/lib/time";
import { cn } from "@/lib/utils";

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

function InfoDisclosure({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("info-disclosure group", className)}>
      <summary className="cursor-pointer list-none text-[11px] marker:content-none">
        <span className="soft-link group-open:text-ink">{title}</span>
      </summary>
      <div className="prose-muted mt-1.5 space-y-1.5">{children}</div>
    </details>
  );
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

function harborWindCardClass(over10: boolean): string {
  return cn("tile px-1.5 py-1.5 text-center sm:px-2 sm:py-2", over10 && "tile-warn");
}

function LearnStatusPanel({ harbor }: { harbor: HarborBundle }) {
  const input = {
    tip: harbor.learnOps?.tip,
    intervalMinutes: harbor.mos?.continuous.intervalMinutes ?? 10,
    continuousStarted: harbor.mos?.continuous.started ?? false,
    ticking: harbor.learnOps?.ticking ?? false,
    lastTickAt: harbor.mos?.continuous.lastTickAt ?? null,
    cacheWritable: harbor.learnOps?.cacheWritable,
    learningDays: harbor.learnOps?.learningDays ?? 0,
    warmCount: harbor.learnOps?.warmCount ?? 0,
    nowcastCases: harbor.learnOps?.nowcastCases ?? harbor.nowcastSkill.caseCount,
    nowcastCalibrated: harbor.nowcastSkill.calibrated,
    mosPairs: harbor.learnOps?.mosPairs ?? harbor.mos?.pairCount ?? 0,
    mosActiveBins: harbor.mos?.activeBins ?? 0,
    patternEvents: harbor.learnOps?.patternEvents ?? harbor.pattern.storedEvents,
    metaMosReady: Boolean(harbor.learnOps?.metaMosReady || harbor.mos?.meta?.mosReady),
    metaPatternReady: Boolean(
      harbor.learnOps?.metaPatternReady || harbor.mos?.meta?.patternReady,
    ),
    learningNote: harbor.learning?.note,
    improving: harbor.learning?.improving,
  };
  const metrics = formatLearnMetrics(input);
  const trend = formatLearningTrend(input.improving);

  return (
    <InfoDisclosure title="学習の状態">
      <p className="text-ink/80">{formatLearnLead(input)}</p>
      <p>{formatContinuousLine(input)}</p>
      <dl className="stat-row not-prose">
        {metrics.map((item) => (
          <div key={item.label} className="stat-pill">
            <dt>{item.label}</dt>
            <dd>
              {item.value}
              {item.hint ? <span className="stat-hint">{item.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {harbor.learning ? (
        <>
          <p>{shortenLearningNote(harbor.learning.note)}</p>
          {trend ? <p>{trend}</p> : null}
        </>
      ) : (
        <p>
          {harbor.nowcastSkill.calibrated
            ? "ナウキャストは過去実況で校正済みです。"
            : "ナウキャストは検証データを蓄積中です。"}
          {harbor.mos?.note ? ` ${harbor.mos.note}` : ""}
        </p>
      )}
      {harbor.mos?.meta?.note ? (
        <p className="text-[0.625rem] leading-relaxed opacity-90">{harbor.mos.meta.note}</p>
      ) : null}
    </InfoDisclosure>
  );
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
    <section className="anim-rise space-y-2.5">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div>
          <p className="eyebrow mb-0.5">Live</p>
          <h2 className="section-title">江の島ヨットハーバー</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-muted">{harbor.note}</p>
        </div>
        <InfoDisclosure title="データについて" className="shrink-0">
          <p>
            出典 {HARBOR_SOURCE_LABEL}。ハーバー周辺の風を5分ごとに更新します。沖の格子点とは地点が異なります。
          </p>
          <p>{windyBlurb()}</p>
        </InfoDisclosure>
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
              <p className="font-medium tracking-wide">風速注意</p>
              <p className="mt-0.5 text-warn/90">
                60分以内の見込みが平均 10 m/s を超えます。出艇の目安を上回る可能性があります。
              </p>
            </div>
          ) : null}
          {sourceStale ? (
            <div className="callout mb-2 py-1.5 text-[11px] leading-4">
              <p className="font-medium tracking-wide">実況の更新停止</p>
              <p className="mt-0.5 text-warn/90">
                最新の公開が約 {lagMinutes} 分前で止まっています。新しい観測が来るまで短時間予測は出しません。
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
                  {lagMinutes !== null ? ` · ${lagMinutes}分前` : ""}
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
                  瞬間 {latest.maxMs.toFixed(1)}
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
                    +{point.minutesAhead}分
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
                    <p className="mt-1 text-[9px] font-medium text-warn">10 m/s 超</p>
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

          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-t border-line/40 pt-2.5">
            {harbor.nowcast.length > 0 ? (
              <InfoDisclosure title="ナウキャストについて">
                <p>
                  {harbor.nowcastSkill.calibrated
                    ? "直近30分の傾きを延長し、過去の実況との突合で風速・風向を整えています。"
                    : "直近30分の傾きが続くと仮定した、15・30・60分先の目安です。"}
                </p>
                <p>{harbor.nowcastSkill.note}</p>
              </InfoDisclosure>
            ) : latest && sourceStale ? (
              <p className="text-[11px] text-muted">実況が止まっているため、短時間予測は表示していません。</p>
            ) : latest ? (
              <p className="text-[11px] text-muted">
                傾きがはっきりしないため、短時間予測は出せません。
              </p>
            ) : null}
            <LearnStatusPanel harbor={harbor} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">実況データはまだありません。</p>
      )}

      {harbor.alerts.some((alert) => alert.kind !== "stale") ? (
        <div className="space-y-1.5">
          {harbor.alerts
            .filter((alert) => alert.kind !== "stale")
            .map((alert) => (
              <div
                key={`${alert.kind}-${alert.message}`}
                className={cn(
                  "rounded-lg py-1.5 pl-3 text-[11px] leading-4",
                  alert.level === "watch" ? "callout" : "callout-sea",
                )}
              >
                {alert.message}
              </div>
            ))}
        </div>
      ) : null}

      {harbor.pattern.match ? (
        <div className="callout-sea rounded-lg py-2 pl-3 text-[11px] leading-relaxed">
          {(() => {
            const formatted = formatPatternMatchNote(
              harbor.pattern.match.note,
              harbor.pattern.match.boostFactor,
              harbor.pattern.match.score,
            );
            return (
              <>
                <p className="font-medium tracking-wide text-sea">急上昇マッチ</p>
                <p className="mt-0.5 text-ink/85">{formatted.headline}</p>
                <p className="mt-1 text-muted">{formatted.detail}</p>
              </>
            );
          })()}
        </div>
      ) : null}

      {harbor.degraded ? (
        <p className="text-[11px] text-muted">
          取得に失敗したため、保存してある直近の実況を表示しています。
        </p>
      ) : null}
    </section>
  );
}

export function ForecastBoard() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (mode: "page" | "harbor" = "page") => {
    const silent = mode === "harbor";
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch("/api/forecast?refreshHarbor=1", {
        cache: "no-store",
        signal: AbortSignal.timeout(28_000),
      });
      const body = (await response.json()) as ForecastResponse;
      if (!body.harbor && !body.jma) {
        if (!silent) {
          setData(null);
          setError(body.errors[0] ?? "実況を取得できませんでした。");
        }
        window.setTimeout(() => {
          void load("harbor");
        }, 12_000);
        return;
      }
      setData(body);
      if (!silent) setError(null);
      if (!body.harbor?.latest) {
        window.setTimeout(() => {
          void load("harbor");
        }, 12_000);
      }
    } catch {
      if (!silent) {
        setError("接続中です。自動で再取得します…");
      }
      window.setTimeout(() => {
        void load("harbor");
      }, 10_000);
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

  return (
    <section className="anim-rise space-y-4 sm:space-y-5" aria-live="polite">
      {error ? <p className="callout py-2 text-xs">{error}</p> : null}

      {data?.jma && data.jma.warnings.length > 0 ? (
        <div className="callout py-2 text-xs leading-5">
          <p className="font-medium tracking-wide">鎌倉市 · 警報・注意報</p>
          <ul className="mt-1 space-y-0.5 text-warn/90">
            {data.jma.warnings.map((warning) => (
              <li key={warning.code} className={warning.severe ? "font-medium" : undefined}>
                {warning.name}（{warning.status}
                {warning.notes.length > 0 ? ` · ${warning.notes.join(" · ")}` : ""}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data?.harbor ? (
        <HarborPanel harbor={data.harbor} />
      ) : (
        <div className="space-y-2">
          <p className="eyebrow">Live</p>
          <h2 className="section-title">江の島ヨットハーバー</h2>
          <div className="skeleton-pulse h-36 bg-sand/70" />
          {loading ? null : (
            <p className="text-[11px] text-muted">実況データはまだありません。</p>
          )}
        </div>
      )}

      <div className="windy-strip flex flex-wrap items-center justify-between gap-2">
        <p className="prose-muted max-w-md">
          {windyBlurb()}{" "}
          <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
            Windy
          </a>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 border-line/80 bg-white/60 px-2.5 text-[11px]"
          onClick={() => void load("page")}
          disabled={loading}
        >
          {loading ? "更新中" : "実況を更新"}
        </Button>
      </div>
    </section>
  );
}
