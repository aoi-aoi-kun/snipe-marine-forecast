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
import { JST_OFFSET_MS } from "@/lib/time";
import { cn } from "@/lib/utils";

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

const MEAN_LIMIT_MS = 10;
const GUST_LIMIT_MS = 13;

function meanHot(value: number | null | undefined): boolean {
  return value != null && value >= MEAN_LIMIT_MS;
}

function gustHot(value: number | null | undefined): boolean {
  return value != null && value >= GUST_LIMIT_MS;
}

function ThresholdBadges({
  meanMs,
  gustMs,
  meanLabel = "平均",
  gustLabel = "瞬間",
}: {
  meanMs?: number | null;
  gustMs?: number | null;
  meanLabel?: string;
  gustLabel?: string;
}) {
  const showMean = meanHot(meanMs);
  const showGust = gustHot(gustMs);
  if (!showMean && !showGust) return null;
  return (
    <div className="threshold-row">
      {showMean ? (
        <span className="threshold-badge">
          {meanLabel} {MEAN_LIMIT_MS} m/s 超
        </span>
      ) : null}
      {showGust ? (
        <span className="threshold-badge">
          {gustLabel} {GUST_LIMIT_MS} m/s 超
        </span>
      ) : null}
    </div>
  );
}

function HarborPanel({ harbor }: { harbor: HarborBundle }) {
  const latest = harbor.latest;
  const rising =
    harbor.riseRateMsPerHour !== null && harbor.riseRateMsPerHour >= 1.5;
  const lagMinutes =
    latest === null
      ? null
      : Math.max(0, Math.floor((Date.now() - Date.parse(latest.at)) / 60_000));
  const sourceStale = lagMinutes !== null && lagMinutes >= 20;
  const liveMeanHot = meanHot(latest?.meanMs);
  const liveGustHot = gustHot(latest?.maxMs);
  const liveHot = liveMeanHot || liveGustHot;
  const nowcastHot = harbor.nowcast.some((point) => meanHot(point.meanMs));
  const match = harbor.pattern.match;
  const matchMeanHot = meanHot(match?.expectedPeakMs);
  const matchGustHot = gustHot(match?.expectedMaxMs);
  const matchHot = matchMeanHot || matchGustHot;
  const riseLabel =
    harbor.riseRateMsPerHour !== null
      ? `${harbor.riseRateMsPerHour >= 0 ? "+" : ""}${harbor.riseRateMsPerHour.toFixed(1)}`
      : null;
  const matchFormatted = match ? formatPatternMatchNote(match) : null;

  return (
    <section className="anim-rise space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div>
          <p className="eyebrow mb-0.5">Live</p>
          <h2 className="section-title">江の島ヨットハーバー</h2>
        </div>
        <InfoDisclosure title="データについて" className="shrink-0">
          <p>{harbor.note}</p>
          <p>出典 {HARBOR_SOURCE_LABEL}。沖の格子点とは地点が異なります。</p>
          <p>
            平均 {MEAN_LIMIT_MS} m/s 超、瞬間 {GUST_LIMIT_MS} m/s 超は強調表示します。
          </p>
          <p>{windyBlurb()}</p>
        </InfoDisclosure>
      </div>

      <div className="panel-stack">
        {latest ? (
          <article
            className={cn(
              "wind-panel anim-rise",
              (liveHot || sourceStale) && "wind-panel-warn",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={cn("panel-kicker", liveHot && "panel-kicker-warn")}>実況 · いま</p>
                <p
                  className={cn(
                    "mt-1 text-[13px] leading-4",
                    sourceStale ? "font-medium text-warn" : "text-muted",
                  )}
                >
                  {formatHarborObsTime(latest.at)}
                  {lagMinutes !== null ? ` · ${lagMinutes}分前` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-white/70 px-3.5 py-2 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-sea)_16%,transparent)]">
                <WindArrow
                  degrees={latest.fromDeg}
                  blocked={liveHot}
                  label={latest.fromLabel}
                  size="lg"
                />
                <div className="min-w-[3.5rem]">
                  <p className="text-[10px] font-medium tracking-wide text-muted">風向</p>
                  <p className="mt-0.5 font-serif text-xl leading-none tracking-tight text-ink">
                    {latest.fromLabel ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <ThresholdBadges meanMs={latest.meanMs} gustMs={latest.maxMs} />
            </div>

            {liveHot ? (
              <p className="threshold-banner mt-2.5">
                {liveMeanHot && liveGustHot
                  ? `平均 ${MEAN_LIMIT_MS} m/s・瞬間 ${GUST_LIMIT_MS} m/s を超えています。出艇判断を慎重に。`
                  : liveMeanHot
                    ? `平均風速が ${MEAN_LIMIT_MS} m/s を超えています。出艇判断を慎重に。`
                    : `瞬間風速が ${GUST_LIMIT_MS} m/s を超えています。出艇判断を慎重に。`}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-end justify-between gap-x-5 gap-y-4">
              <p
                className={cn("live-speed", liveMeanHot && "text-warn")}
                aria-label={`平均 ${latest.meanMs.toFixed(1)} メートル毎秒`}
              >
                {latest.meanMs.toFixed(1)}
                <span className="live-speed-unit">m/s</span>
              </p>
              <dl className="grid min-w-[11rem] grid-cols-2 gap-x-5 gap-y-3">
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted">瞬間</dt>
                  <dd
                    className={cn(
                      "mt-1 font-serif text-3xl tabular-nums leading-none tracking-tight sm:text-4xl",
                      liveGustHot ? "text-warn" : "text-ink",
                    )}
                  >
                    {latest.maxMs.toFixed(1)}
                    <span className="ml-1 text-xs font-sans text-muted">m/s</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted">傾き</dt>
                  <dd
                    className={cn(
                      "mt-1 font-serif text-3xl tabular-nums leading-none tracking-tight sm:text-4xl",
                      rising ? "text-warn" : "text-ink",
                    )}
                  >
                    {riseLabel ?? "—"}
                    {riseLabel ? (
                      <span className="ml-1 text-[10px] font-sans text-muted">m/s/h</span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </div>

            {sourceStale ? (
              <p className="mt-4 text-[13px] font-medium leading-5 text-warn">
                公開側の更新が止まっています。新しい観測が来るまで短時間予測は出しません。
              </p>
            ) : rising && !liveHot ? (
              <p className="mt-4 text-[13px] leading-5 text-warn/90">
                立ち上がり気味です。ナウキャストと急上昇マッチも確認してください。
              </p>
            ) : null}
          </article>
        ) : (
          <p className="text-sm text-muted">実況データはまだありません。</p>
        )}

        <article
          className={cn("wind-panel anim-rise anim-rise-delay-1", nowcastHot && "wind-panel-warn")}
        >
          <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className={cn("panel-kicker", nowcastHot && "panel-kicker-warn")}>
                ナウキャスト
              </p>
              <p className="mt-1 text-[13px] text-muted">15 / 30 / 60 分先の目安</p>
            </div>
            <InfoDisclosure title="説明">
              <p>
                {harbor.nowcastSkill.calibrated
                  ? "直近30分の傾きを延長し、過去の実況との突合で風速・風向を整えています。"
                  : "直近30分の傾きが続くと仮定した、15・30・60分先の目安です。"}
              </p>
              <p>{harbor.nowcastSkill.note}</p>
            </InfoDisclosure>
          </div>

          {nowcastHot ? (
            <p className="threshold-banner mb-2.5">
              60分以内の見込みが平均 {MEAN_LIMIT_MS} m/s を超えます。
            </p>
          ) : null}

          {harbor.nowcast.length > 0 ? (
            <ol className="nowcast-rail">
              {harbor.nowcast.map((point, index) => {
                const delta = latest === null ? null : point.meanMs - latest.meanMs;
                const overMean = meanHot(point.meanMs);
                return (
                  <li
                    key={point.minutesAhead}
                    className={cn("nowcast-tile", overMean && "nowcast-tile-warn")}
                    style={{ animationDelay: `${0.08 + index * 0.07}s` }}
                  >
                    <p className="text-[11px] font-medium tracking-wide text-muted">
                      +{point.minutesAhead}分
                    </p>
                    <div className="mt-2 flex justify-center">
                      <WindArrow
                        degrees={point.fromDeg}
                        blocked={overMean}
                        label={point.fromLabel}
                        size="md"
                      />
                    </div>
                    <p className={cn("nowcast-speed mt-2", overMean ? "text-warn" : "text-ink")}>
                      {point.meanMs.toFixed(1)}
                      <span className="nowcast-speed-unit">m/s</span>
                    </p>
                    {overMean ? (
                      <p className="mt-2 text-[11px] font-medium text-warn">
                        平均 {MEAN_LIMIT_MS} 超
                      </p>
                    ) : delta !== null ? (
                      <p
                        className={cn(
                          "mt-2 text-[12px] tabular-nums font-medium",
                          delta > 0.15
                            ? "text-warn"
                            : delta < -0.15
                              ? "text-sea"
                              : "text-muted",
                        )}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)} いま比
                      </p>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted">
                        {point.fromLabel ?? "風向 —"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : latest && sourceStale ? (
            <p className="text-[13px] text-muted">
              実況が止まっているため、短時間予測は表示していません。
            </p>
          ) : (
            <p className="text-[13px] text-muted">
              傾きがはっきりしないため、短時間予測は出せません。
            </p>
          )}
        </article>

        <article
          className={cn(
            "wind-panel anim-rise anim-rise-delay-2",
            match && matchHot && "wind-panel-warn",
          )}
        >
          <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className={cn("panel-kicker", match && matchHot && "panel-kicker-warn")}>
                急上昇マッチ
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {match
                  ? "類似イベントから見た上昇の目安"
                  : "いまは該当する前兆がありません"}
              </p>
            </div>
            {match ? (
              <InfoDisclosure title="説明">
                <p>{matchFormatted?.detail}</p>
              </InfoDisclosure>
            ) : null}
          </div>

          {match && matchFormatted ? (
            <>
              <ThresholdBadges
                meanMs={match.expectedPeakMs}
                gustMs={match.expectedMaxMs}
                meanLabel="ピーク"
                gustLabel="瞬間"
              />
              {matchHot ? (
                <p className="threshold-banner mt-2.5">
                  {matchMeanHot && matchGustHot
                    ? `ピーク平均 ${MEAN_LIMIT_MS} m/s・瞬間 ${GUST_LIMIT_MS} m/s を超える見込みです。`
                    : matchMeanHot
                      ? `ピーク平均が ${MEAN_LIMIT_MS} m/s を超える見込みです。`
                      : `瞬間が ${GUST_LIMIT_MS} m/s を超える見込みです。`}
                </p>
              ) : null}
              <p className="mt-2.5 text-[13px] leading-5 text-ink/85">{matchFormatted.headline}</p>
              <dl className="metric-rail not-prose mt-3">
                {matchFormatted.metrics.map((item) => {
                  const warn =
                    (item.label === "ピーク目安" && matchMeanHot) ||
                    (item.label === "瞬間目安" && matchGustHot) ||
                    (item.label === "上昇目安" &&
                      meanHot((latest?.meanMs ?? 0) + match.expectedRiseMs));
                  return (
                    <div key={item.label} className={cn("metric-tile", warn && "metric-tile-warn")}>
                      <dt>{item.label}</dt>
                      <dd>
                        {item.value}
                        {item.hint ? <span className="metric-hint">{item.hint}</span> : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          ) : (
            <p className="text-[13px] leading-5 text-muted">
              立ち上がりがはっきりしたとき、過去の急上昇パターンとの一致と定量目安をここに出します。
            </p>
          )}
        </article>
      </div>

      {harbor.alerts.some((alert) => alert.kind !== "stale") ? (
        <div className="space-y-1.5">
          {harbor.alerts
            .filter((alert) => alert.kind !== "stale")
            .map((alert) => (
              <div
                key={`${alert.kind}-${alert.message}`}
                className={cn(
                  "rounded-lg py-1.5 pl-3 text-[12px] leading-4",
                  alert.level === "watch" ? "callout" : "callout-sea",
                )}
              >
                {alert.message}
              </div>
            ))}
        </div>
      ) : null}

      <div className="secondary-zone border-t border-line/35 pt-2">
        <LearnStatusPanel harbor={harbor} />
      </div>

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
