"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, HarborBundle } from "@/lib/types";
import { JST_OFFSET_MS, jstParts } from "@/lib/time";
import { cn } from "@/lib/utils";

const WINDY_URL =
  "https://www.windy.com/35.309/139.482?35.250,139.500,11,i:pressure";

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
                {harbor.learnOps ? (
                  <p className="text-ink/80">{harbor.learnOps.tip}</p>
                ) : null}
                <p>
                  継続学習は約 {harbor.mos?.continuous.intervalMinutes ?? 10}{" "}
                  分ごと
                  {harbor.mos?.continuous.started
                    ? harbor.learnOps?.ticking
                      ? "（いま学習中）"
                      : "（稼働中）"
                    : "（次の取得で開始）"}
                  {harbor.mos?.continuous.lastTickAt
                    ? ` · 前回 ${formatStamp(harbor.mos.continuous.lastTickAt)}`
                    : ""}
                  。ページを開くたびにも実況を取り込みます。キャッシュ
                  {harbor.learnOps
                    ? harbor.learnOps.cacheWritable
                      ? "は書き込み可"
                      : "に書けません"
                    : "の状態は取得中"}
                  {harbor.learnOps && harbor.learnOps.learningDays > 0
                    ? ` · 蓄積約 ${harbor.learnOps.learningDays.toFixed(1)} 日（warm ${harbor.learnOps.warmCount}）`
                    : ""}
                  。
                </p>
                <p>
                  検証件数 · ナウキャスト{" "}
                  {harbor.learnOps?.nowcastCases ?? harbor.nowcastSkill.caseCount} ·
                  MOS {harbor.learnOps?.mosPairs ?? harbor.mos?.pairCount ?? 0} ·
                  急上昇{" "}
                  {harbor.learnOps?.patternEvents ?? harbor.pattern.storedEvents} ·
                  補正の補正{" "}
                  {harbor.learnOps?.metaMosReady || harbor.mos?.meta?.mosReady
                    ? "MOS側あり"
                    : "MOS側蓄積中"}
                  /
                  {harbor.learnOps?.metaPatternReady || harbor.mos?.meta?.patternReady
                    ? "急上昇側あり"
                    : "急上昇側蓄積中"}
                </p>
                {harbor.learning ? (
                  <p>
                    {harbor.learning.note}
                    {harbor.learning.improving === true
                      ? " 使うほど誤差が縮む方向です。"
                      : ""}
                  </p>
                ) : (
                  <p>
                    ナウキャストは
                    {harbor.nowcastSkill.calibrated
                      ? `校正済み（検証 ${harbor.nowcastSkill.caseCount} 件）。`
                      : `検証 ${harbor.nowcastSkill.caseCount} 件を蓄積中。`}
                    {harbor.mos ? ` ${harbor.mos.note}` : ""}
                  </p>
                )}
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
          <p className="font-medium tracking-wide text-sea">急上昇マッチ</p>
          <p className="mt-0.5">{harbor.pattern.match.note}</p>
          <p className="mt-1 text-muted">
            補正係数 {harbor.pattern.match.boostFactor.toFixed(2)} · 一致度{" "}
            {(harbor.pattern.match.score * 100).toFixed(0)}%
          </p>
        </div>
      ) : null}

      {harbor.degraded ? (
        <p className="text-[11px] text-muted">取得に失敗したため、保存済みの実況を表示しています。</p>
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
        setError("実況を取得しています。自動で再試行します…");
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
          {loading ? null : (
            <p className="text-[11px] text-muted">実況はまだありません。</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/45 pt-3">
        <p className="text-[11px] leading-4 text-muted">
          数時間〜数日の風の見通しは{" "}
          <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
            Windy
          </a>
          を参照してください。
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2.5 text-[11px]"
          onClick={() => void load("page")}
          disabled={loading}
        >
          {loading ? "取得中" : "実況を更新"}
        </Button>
      </div>
    </section>
  );
}
