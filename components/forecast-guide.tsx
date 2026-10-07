import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

export function ForecastGuide() {
  return (
    <details className="anim-rise group border-t border-line/70 pt-6">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-muted">補足</p>
            <h2 className="mt-1 font-serif text-lg tracking-tight text-ink sm:text-xl">
              この予報の読み方
            </h2>
          </div>
          <span className="shrink-0 text-sm text-sea transition-transform group-open:rotate-45">
            ＋
          </span>
        </div>
      </summary>

      <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
        <p>
          沖の見通しは ECMWF（約25km升・3時間）、直近は江の島ハーバーの5分実況（格子点から約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km）です。地点が違うので、数値をそのまま同一視しません。
        </p>
        <ul className="space-y-1.5">
          <li>
            <span className="font-medium text-ink/80">役割分担</span>
            {" — "}数時間〜数日は沖予報、いま〜1時間はナウキャスト（過去実況で校正）。
          </li>
          <li>
            <span className="font-medium text-ink/80">補正</span>
            {" — "}ナウキャストは傾きの過大評価を抑え、沖予報は時間帯・風向のMOSで倍率調整。
          </li>
          <li>
            <span className="font-medium text-ink/80">出艇不可能</span>
            {" — "}平均 10 m/s 以上、または瞬間 13 m/s 以上。最終判断は現場と警報。
          </li>
          <li>
            <span className="font-medium text-ink/80">限界</span>
            {" — "}前兆のない突風は予測できません。
          </li>
        </ul>
      </div>
    </details>
  );
}
