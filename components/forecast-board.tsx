"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, HarborBundle } from "@/lib/types";
import { formatPatternMatchNote } from "@/lib/ui-copy";
import { formatRampOutlookLine } from "@/lib/ramp-outlook";
import { JST_OFFSET_MS } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ActiveWarning } from "@/lib/types";
import { ForecastAbout } from "@/components/forecast-about";

function formatHarborObsTime(iso: string): string {
  const shifted = new Date(Date.parse(iso) + JST_OFFSET_MS);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return `${month}月${day}日 ${hour}時${minute.toString().padStart(2, "0")}分`;
}

/** Wind arrow: filled pointer shows where the wind is going (fromDeg + 180). */
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
    size === "sm" ? "size-7" : size === "lg" ? "size-11 sm:size-12" : "size-9 sm:size-10";
  if (degrees === null) {
    return (
      <span
        className={cn(
          "wind-arrow wind-arrow-empty mx-auto grid place-items-center rounded-full",
          sizeClass,
        )}
        title="風向なし"
      >
        <span className="size-1.5 rounded-full bg-muted/50" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "wind-arrow mx-auto grid place-items-center rounded-full",
        sizeClass,
        blocked ? "wind-arrow-warn" : "wind-arrow-sea",
      )}
      aria-hidden={label ? undefined : true}
      aria-label={label ?? undefined}
      role={label ? "img" : undefined}
    >
      <svg viewBox="0 0 32 32" className="size-[72%]" overflow="visible">
        {/* Fixed 16-point compass ring */}
        <circle
          cx="16"
          cy="16"
          r="14.6"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.16"
          strokeWidth="1.1"
        />
        {Array.from({ length: 16 }, (_, index) => {
          const angle = (index * 22.5 * Math.PI) / 180;
          const major = index % 4 === 0;
          const inner = major ? 11.2 : 12.2;
          const outer = 14.4;
          const x1 = 16 + inner * Math.sin(angle);
          const y1 = 16 - inner * Math.cos(angle);
          const x2 = 16 + outer * Math.sin(angle);
          const y2 = 16 - outer * Math.cos(angle);
          return (
            <line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeOpacity={major ? 0.42 : 0.22}
              strokeWidth={major ? 1.15 : 0.85}
              strokeLinecap="round"
            />
          );
        })}
        <g
          style={{
            transform: `rotate(${degrees + 180}deg)`,
            transformOrigin: "16px 16px",
            transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <path
            d="M16 4.4 10.6 14.6h2.55v11.4c0 .75.62 1.35 1.38 1.35h1.94c.76 0 1.38-.6 1.38-1.35V14.6H21.4L16 4.4Z"
            fill="currentColor"
            fillOpacity="0.14"
            transform="translate(0.4 0.5)"
          />
          <path
            d="M16 4.4 10.6 14.6h2.55v11.4c0 .75.62 1.35 1.38 1.35h1.94c.76 0 1.38-.6 1.38-1.35V14.6H21.4L16 4.4Z"
            fill="currentColor"
          />
          <path d="M16 5.6 13.2 11.2h5.6L16 5.6Z" fill="white" fillOpacity="0.28" />
        </g>
      </svg>
    </span>
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

function SectionTools({
  loading,
  refreshing,
  onRefresh,
}: {
  loading: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
}) {
  const busy = loading || Boolean(refreshing);
  return (
    <div className="section-tools">
      <Button
        variant="outline"
        size="sm"
        className="refresh-button"
        onClick={onRefresh}
        disabled={busy}
      >
        {busy ? "更新中" : "実況を更新"}
      </Button>
    </div>
  );
}

function HarborPanel({
  harbor,
  warnings,
  jmaLoaded,
  loading,
  refreshing,
  onRefresh,
}: {
  harbor: HarborBundle;
  warnings?: ActiveWarning[] | null;
  jmaLoaded?: boolean;
  loading: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
}) {
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
  const matchFormatted = match ? formatPatternMatchNote(match) : null;
  const outlookLine = harbor.nowcastSkill.rampOutlook
    ? formatRampOutlookLine(harbor.nowcastSkill.rampOutlook)
    : null;
  const warningList = warnings ?? [];
  const hasWarnings = warningList.length > 0;

  return (
    <section>
      <div className="section-head">
        <div className="section-head-copy">
          <h2 className="section-title">江の島ヨットハーバー</h2>
          <p className="jma-meta mt-1">
            {jmaLoaded === false ? (
              <span>気象庁の発表を確認中…</span>
            ) : hasWarnings ? (
              <span className="jma-meta-warn">気象庁 · 警報・注意報あり（下を確認）</span>
            ) : (
              <span>
                気象庁 · 発表なし
                {" · "}
                <a
                  className="soft-link"
                  href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
                  target="_blank"
                  rel="noreferrer"
                >
                  一覧
                </a>
              </span>
            )}
          </p>
        </div>
        <SectionTools
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </div>

      {hasWarnings ? <JmaAlert warnings={warningList} /> : null}

      <div className="primary-panels">
        {latest ? (
          <article
            className={cn(
              "wind-panel wind-panel-live",
              (liveHot || sourceStale) && "wind-panel-warn",
            )}
          >
            <div className="panel-head">
              <div>
                <p className={cn("panel-kicker", liveHot && "panel-kicker-warn")}>実況 · いま</p>
                <p
                  className={cn(
                    "panel-sub",
                    sourceStale && "font-medium text-warn",
                  )}
                >
                  {formatHarborObsTime(latest.at)}
                  {lagMinutes !== null ? ` · ${lagMinutes}分前` : ""}
                  {latest.fromLabel ? ` · ${latest.fromLabel}` : ""}
                </p>
              </div>
              <WindArrow
                degrees={latest.fromDeg}
                blocked={liveHot}
                label={latest.fromLabel}
                size="md"
              />
            </div>

            <div className="mt-2">
              <ThresholdBadges meanMs={latest.meanMs} gustMs={latest.maxMs} />
            </div>

            {liveHot ? (
              <p className="threshold-banner mt-2">
                {liveMeanHot && liveGustHot
                  ? `平均 ${MEAN_LIMIT_MS}・瞬間 ${GUST_LIMIT_MS} m/s 超。出艇判断を慎重に。`
                  : liveMeanHot
                    ? `平均風速が ${MEAN_LIMIT_MS} m/s 超。出艇判断を慎重に。`
                    : `瞬間風速が ${GUST_LIMIT_MS} m/s 超。出艇判断を慎重に。`}
              </p>
            ) : null}

            <dl className="metric-rail metric-rail-2 not-prose mt-2.5">
              <div className={cn("metric-tile", liveMeanHot && "metric-tile-warn")}>
                <dt>平均</dt>
                <dd>
                  {latest.meanMs.toFixed(1)}
                  <span className="metric-unit">m/s</span>
                </dd>
              </div>
              <div className={cn("metric-tile", liveGustHot && "metric-tile-warn")}>
                <dt>瞬間</dt>
                <dd>
                  {latest.maxMs.toFixed(1)}
                  <span className="metric-unit">m/s</span>
                </dd>
              </div>
            </dl>

            {sourceStale ? (
              <p className="panel-body font-medium text-warn">
                公開更新が停止中。短時間予測は出しません。
              </p>
            ) : rising && !liveHot ? (
              <p className="panel-body text-warn/90">
                立ち上がり気味です。ナウキャストも確認してください。
              </p>
            ) : null}
          </article>
        ) : (
          <article className="wind-panel wind-panel-live">
            <p className="panel-kicker">実況 · いま</p>
            <p className="panel-body text-muted">実況データはまだありません。</p>
          </article>
        )}

        <article
          className={cn(
            "wind-panel wind-panel-nowcast",
            nowcastHot && "wind-panel-warn",
          )}
        >
          <div className="panel-head">
            <div>
              <p className={cn("panel-kicker", nowcastHot && "panel-kicker-warn")}>
                ナウキャスト
              </p>
              <p className="panel-sub">
                {harbor.nowcastSkill.patternBlended
                  ? "15 / 30 / 60 分先 · 急上昇を反映"
                  : harbor.nowcastSkill.risingRegime
                    ? "15 / 30 / 60 分先 · 立ち上がり校正"
                    : "15 / 30 / 60 分先の目安"}
              </p>
            </div>
          </div>

          {nowcastHot ? (
            <p className="threshold-banner mt-2">
              60分以内の見込みが平均 {MEAN_LIMIT_MS} m/s 超。
            </p>
          ) : null}

          {harbor.nowcast.length > 0 ? (
            <ol className="nowcast-rail mt-2.5">
              {harbor.nowcast.map((point) => {
                const delta = latest === null ? null : point.meanMs - latest.meanMs;
                const overMean = meanHot(point.meanMs);
                return (
                  <li
                    key={point.minutesAhead}
                    className={cn("nowcast-tile", overMean && "nowcast-tile-warn")}
                  >
                    <p className="tile-label">+{point.minutesAhead}分</p>
                    <div className="mt-1.5 flex justify-center">
                      <WindArrow
                        degrees={point.fromDeg}
                        blocked={overMean}
                        label={point.fromLabel}
                        size="sm"
                      />
                    </div>
                    <p className="nowcast-speed">
                      {point.meanMs.toFixed(1)}
                      <span className="nowcast-speed-unit">m/s</span>
                    </p>
                    {overMean ? (
                      <p className="tile-hint">平均 {MEAN_LIMIT_MS} 超</p>
                    ) : delta !== null ? (
                      <p
                        className={cn(
                          "tile-hint",
                          delta > 0.15
                            ? "text-warn"
                            : delta < -0.15
                              ? "text-sea"
                              : undefined,
                        )}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)} いま比
                      </p>
                    ) : (
                      <p className="tile-hint">{point.fromLabel ?? "風向 —"}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : latest && sourceStale ? (
            <p className="panel-body text-muted">
              実況停止中のため、短時間予測は表示していません。
            </p>
          ) : (
            <p className="panel-body text-muted">
              傾きがはっきりしないため、短時間予測は出せません。
            </p>
          )}
        </article>
      </div>

      <div className="panel-stack panel-stack-secondary">
        <article className="wind-panel wind-panel-match">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">急上昇マッチ</p>
              <p className="panel-sub">
                {match
                  ? harbor.nowcastSkill.patternBlended
                    ? "類似の過去あり · ナウキャストに反映"
                    : "類似の過去イベントあり"
                  : "いまは該当する前兆がありません"}
              </p>
            </div>
          </div>

          {match && matchFormatted ? (
            <div className="mt-2 space-y-1">
              <p className="panel-body">{matchFormatted.headline}</p>
              {outlookLine ? <p className="panel-body text-warn/90">{outlookLine}</p> : null}
            </div>
          ) : null}
        </article>
      </div>

      {harbor.alerts.some((alert) => alert.kind !== "stale") ? (
        <div className="alert-stack mt-3">
          {harbor.alerts
            .filter((alert) => alert.kind !== "stale")
            .map((alert) => (
              <div
                key={`${alert.kind}-${alert.message}`}
                className={alert.level === "watch" ? "callout" : "callout-sea"}
              >
                {alert.message}
              </div>
            ))}
        </div>
      ) : null}

      {harbor.degraded ? (
        <p className="prose-muted mt-3">
          取得に失敗したため、保存してある直近の実況を表示しています。
        </p>
      ) : null}
    </section>
  );
}

/** Full alert block — only rendered when JMA has active warnings. */
function JmaAlert({ warnings }: { warnings: ActiveWarning[] }) {
  return (
    <aside className="jma-alert" aria-label="気象庁 鎌倉市の警報・注意報">
      <div className="panel-head">
        <p className="jma-alert-title">気象庁 · 鎌倉市の警報・注意報</p>
        <a
          className="soft-link jma-alert-link"
          href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
          target="_blank"
          rel="noreferrer"
        >
          発表一覧
        </a>
      </div>
      <ul className="jma-alert-list">
        {warnings.map((warning) => (
          <li
            key={warning.code}
            className={cn(
              "jma-alert-item",
              warning.severe && "jma-alert-item-severe",
            )}
          >
            {warning.name}
            <span>
              （{warning.status}
              {warning.notes.length > 0 ? ` · ${warning.notes.join(" · ")}` : ""}）
            </span>
          </li>
        ))}
      </ul>
      <p className="jma-alert-note">最終判断は発表と現場を優先。</p>
    </aside>
  );
}

export function ForecastBoard() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const dataRef = useRef<ForecastResponse | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const applyForecast = useCallback((body: ForecastResponse, soft: boolean) => {
    const merge = (prev: ForecastResponse | null): ForecastResponse => {
      // Budget fallbacks can omit harbor — never wipe a good live panel.
      if (!body.harbor?.latest && prev?.harbor) {
        return {
          ...body,
          harbor: prev.harbor,
          ifs: body.ifs ?? prev.ifs,
          jma: body.jma ?? prev.jma,
        };
      }
      return body;
    };
    if (soft) {
      startTransition(() => {
        setData((prev) => merge(prev));
        setError(null);
      });
      return;
    }
    setData((prev) => merge(prev));
    setError(null);
  }, []);

  const load = useCallback(
    async (mode: "page" | "harbor" = "page") => {
      const hasHarbor = Boolean(dataRef.current?.harbor?.latest);
      // After first paint, keep panels mounted and refresh in place.
      const soft = mode === "harbor" || hasHarbor;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (!soft) {
        setLoading(true);
        setError(null);
      } else if (mode === "page") {
        setRefreshing(true);
      }
      try {
        const response = await fetch("/api/forecast?refreshHarbor=1", {
          cache: "no-store",
          signal: AbortSignal.timeout(16_000),
        });
        const body = (await response.json()) as ForecastResponse;
        if (!body.harbor && !body.jma && !hasHarbor) {
          if (!soft) {
            setData(null);
            setError(body.errors[0] ?? "実況を取得できませんでした。");
          }
          window.setTimeout(() => {
            void load("harbor");
          }, 8_000);
          return;
        }
        applyForecast(body, soft);
        if (!body.harbor?.latest && !hasHarbor) {
          window.setTimeout(() => {
            void load("harbor");
          }, 8_000);
        }
      } catch {
        if (!soft) {
          setError("接続中です。自動で再取得します…");
        }
        window.setTimeout(() => {
          void load("harbor");
        }, 8_000);
      } finally {
        inFlightRef.current = false;
        if (!soft) setLoading(false);
        setRefreshing(false);
      }
    },
    [applyForecast],
  );

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
    <div className="anim-rise space-y-3 sm:space-y-3.5">
      <section aria-live="polite">
        {error ? <p className="callout">{error}</p> : null}

        {data?.harbor ? (
          <HarborPanel
            harbor={data.harbor}
            warnings={data.jma?.warnings}
            jmaLoaded={Boolean(data.jma) || !loading}
            loading={loading}
            refreshing={refreshing}
            onRefresh={() => void load("page")}
          />
        ) : (
          <div>
            <div className="section-head">
              <div className="section-head-copy">
                <h2 className="section-title">江の島ヨットハーバー</h2>
                <p className="jma-meta mt-1">
                  {data?.jma?.warnings && data.jma.warnings.length > 0
                    ? null
                    : data?.jma
                      ? "気象庁 · 発表なし"
                      : loading
                        ? "気象庁の発表を確認中…"
                        : "気象庁 · 確認待ち"}
                </p>
              </div>
              <SectionTools
                loading={loading}
                refreshing={refreshing}
                onRefresh={() => void load("page")}
              />
            </div>
            {data?.jma?.warnings && data.jma.warnings.length > 0 ? (
              <JmaAlert warnings={data.jma.warnings} />
            ) : null}
            <div className="primary-panels">
              <div className="skeleton-panel skeleton-pulse" />
              <div className="skeleton-panel skeleton-pulse anim-rise-delay-1" />
            </div>
            {loading ? null : (
              <p className="prose-muted mt-3">実況データはまだありません。</p>
            )}
          </div>
        )}
      </section>

      <ForecastAbout harbor={data?.harbor ?? null} />
    </div>
  );
}
