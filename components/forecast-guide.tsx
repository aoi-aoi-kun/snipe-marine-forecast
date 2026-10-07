import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

export function ForecastGuide() {
  return (
    <details className="anim-rise group border-t border-line/50 pt-4">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-muted">この予報の読み方</h2>
          <span className="shrink-0 text-sm leading-none text-muted transition-transform duration-300 group-open:rotate-45 group-open:text-sea">
            ＋
          </span>
        </div>
      </summary>

      <div className="mt-3 space-y-2.5 text-[12px] leading-5 text-muted">
        <p>
          沖は ECMWF（約25km升・3時間ごと）、直近は江の島ハーバーの5分実況です。格子点まで約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km あり、数値は同一視しません。
        </p>
        <ul className="space-y-1.5">
          <li>
            <span className="font-medium text-ink/75">役割</span>
            {" — "}数時間〜数日は沖予報、いま〜1時間はナウキャスト（実況で校正）。
          </li>
          <li>
            <span className="font-medium text-ink/75">補正</span>
            {" — "}ナウキャストは傾きの過大を抑え、沖予報は時間帯・風向のMOSで倍率調整。
          </li>
          <li>
            <span className="font-medium text-ink/75">出艇不可能</span>
            {" — "}平均 10 m/s 以上、または瞬間 13 m/s 以上。最終判断は現場と警報・注意報。
          </li>
          <li>
            <span className="font-medium text-ink/75">限界</span>
            {" — "}前兆のない突風は捉えられません。
          </li>
        </ul>
      </div>
    </details>
  );
}
