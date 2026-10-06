"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForecastResponse, JmaDay, WindowForecast } from "@/lib/types";
import { jstParts } from "@/lib/time";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatStamp(iso: string): string {
  const parts = jstParts(Date.parse(iso));
  return `${parts.month}月${parts.day}日 ${parts.hour}時`;
}

function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month}月${day}日（${WEEKDAYS[weekday]}）`;
}

function formatWindow(window: WindowForecast): string {
  const start = jstParts(Date.parse(window.start));
  const end = jstParts(Date.parse(window.end));
  const endHour = end.hour === 0 ? 24 : end.hour;
  const day = `${start.month}月${start.day}日（${WEEKDAYS[start.weekday]}）`;
  const hours = `${start.hour}–${endHour}時`;
  if (!window.partialFrom) return `${day} ${hours}`;
  const partial = jstParts(Date.parse(window.partialFrom));
  return `${day} ${hours}（${partial.hour}時以降）`;
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

function WindArrow({ degrees }: { degrees: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-8 shrink-0 text-sea"
      style={{ transform: `rotate(${degrees + 180}deg)` }}
    >
      <path
        d="M12 3.5v14.5M12 3.5 7.5 8.5M12 3.5l4.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WindowRow({ window }: { window: WindowForecast }) {
  return (
    <article className="grid gap-3 border-t border-line py-4 sm:grid-cols-[minmax(0,11.5rem)_1fr] sm:gap-6">
      <h3 className="text-sm leading-6 text-ink">{formatWindow(window)}</h3>
      {window.available ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,8rem)_1fr] sm:items-center">
          <div>
            <p className="font-serif text-2xl text-ink">{window.weather}</p>
            <p className="mt-1 text-sm tabular-nums text-muted">
              {window.precipMm?.toFixed(1)} mm
            </p>
            <p className="text-sm tabular-nums text-ink">
              {formatTemp(window.tempMinC ?? 0, window.tempMaxC ?? 0)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {window.windFromDeg !== null ? (
              <WindArrow degrees={window.windFromDeg} />
            ) : (
              <span className="size-8 shrink-0" />
            )}
            <div>
              <p className="font-serif text-xl text-ink">{window.windFromLabel}</p>
              <p className="text-sm tabular-nums text-ink">
                {formatMs(window.windMeanMs ?? 0)} m/s
                <span className="text-muted">
                  {" "}
                  最大 {formatMs(window.windMaxMs ?? 0)}
                </span>
              </p>
              <p className="text-xs tabular-nums text-muted">
                {formatKt(window.windMeanMs ?? 0)} kt / 最大{" "}
                {formatKt(window.windMaxMs ?? 0)} kt
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">欠測</p>
      )}
    </article>
  );
}

function DayBand({ day }: { day: JmaDay }) {
  return (
    <article className="border-t border-line py-4">
      <h3 className="text-sm text-ink">{formatDay(day.date)}</h3>
      {day.weatherText ? (
        <div className="mt-2 space-y-1 text-sm leading-6">
          <p>{day.weatherText}</p>
          {day.windText ? <p>{day.windText}</p> : null}
          {day.waveText ? <p>波 {day.waveText}</p> : null}
          {day.pops.length > 0 ? (
            <p className="text-muted">
              降水確率{" "}
              {day.pops.map((pop) => `${pop.label} ${pop.percent}%`).join("　")}
            </p>
          ) : null}
          {day.dailyPop !== null ? (
            <p className="text-muted">降水確率 {day.dailyPop}%</p>
          ) : null}
          {day.reliability ? <p className="text-muted">信頼度 {day.reliability}</p> : null}
          {day.yokohamaMinC !== null || day.yokohamaMaxC !== null ? (
            <p className="text-muted">
              横浜の気温
              {day.yokohamaMinC !== null ? ` 最低 ${day.yokohamaMinC}℃` : ""}
              {day.yokohamaMaxC !== null ? ` 最高 ${day.yokohamaMaxC}℃` : ""}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">この日の文章予報はありません。</p>
      )}
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
      if (!body.gfs) {
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

  return (
    <section className="pt-6" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm leading-6 text-muted">
          {data?.gfs ? (
            <>
              <p>GFS 初期値 {formatStamp(data.gfs.initTime)}（日本時間）</p>
              {data.gfs.ageHours > 24 ? (
                <p>この初期値は24時間より古いです。</p>
              ) : null}
              {data.gfs.degraded ? (
                <p>新しい初期値を取りきれなかったため、保存した数値を含みます。</p>
              ) : null}
            </>
          ) : (
            <p>{loading ? "NOAA の数値予報を取得しています。" : "数値予報はまだありません。"}</p>
          )}
          {loading && !data?.gfs ? (
            <p>最初の取得は1分ほどかかることがあります。</p>
          ) : null}
          {data?.jma?.reportDatetime ? (
            <p>
              {data.jma.office}の発表 {formatStamp(data.jma.reportDatetime)}
              {data.jma.degraded ? "（保存していた予報）" : ""}
            </p>
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
        <h2 className="font-serif text-2xl text-ink">12時間ごと</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          地上10mの風、地上2mの気温。毎時値をまとめています。矢印は風の向かう向き、風向の言葉は吹いてくる向きです。
        </p>
        {loading && !data?.gfs ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-16 animate-pulse border-t border-line bg-sand/60" />
            ))}
          </div>
        ) : null}
        <div className="mt-2">
          {data?.gfs?.windows.map((window) => (
            <WindowRow key={window.start} window={window} />
          ))}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-serif text-2xl text-ink">日付ごとの予報</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          横浜地方気象台の文章です。12時間の数値とは別の予報です。風と波の文章は明後日まで、それより先は週間予報です。
        </p>
        {data?.jma ? (
          <div className="mt-2">
            {data.jma.days.map((day) => (
              <DayBand key={day.date} day={day} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">
            {loading
              ? "気象庁の発表を取得しています。"
              : "気象庁の日付予報は取得できませんでした。"}
          </p>
        )}
        {data?.jma?.days.some((day) => day.reliability) ? (
          <p className="mt-3 text-xs text-muted">信頼度は週間予報に付く A・B・C です。</p>
        ) : null}
      </div>
    </section>
  );
}
