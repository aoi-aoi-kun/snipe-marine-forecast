import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

export function ForecastGuide() {
  return (
    <details className="anim-rise group surface px-4 py-4 sm:px-5 sm:py-5">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="eyebrow">補足</p>
            <h2 className="mt-1.5 font-serif text-xl tracking-tight text-ink sm:text-2xl">
              この予報の読み方
            </h2>
          </div>
          <span className="shrink-0 text-lg leading-none text-sea transition-transform duration-300 group-open:rotate-45">
            ＋
          </span>
        </div>
      </summary>

      <div className="mt-5 space-y-3.5 border-t border-line/50 pt-4 text-sm leading-7 text-muted">
        <p>
          沖の見通しは ECMWF（約25km升・3時間）、直近は江の島ハーバーの5分実況（格子点から約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km）です。地点が違うので、数値をそのまま同一視しません。
        </p>
        <ul className="space-y-2">
          <li>
            <span className="font-medium text-ink/85">役割分担</span>
            {" — "}数時間〜数日は沖予報、いま〜1時間はナウキャスト（過去実況で校正）。
          </li>
          <li>
            <span className="font-medium text-ink/85">補正</span>
            {" — "}ナウキャストは傾きの過大評価を抑え、沖予報は時間帯・風向のMOSで倍率調整。
          </li>
          <li>
            <span className="font-medium text-ink/85">出艇不可能</span>
            {" — "}平均 10 m/s 以上、または瞬間 13 m/s 以上。最終判断は現場と警報。
          </li>
          <li>
            <span className="font-medium text-ink/85">限界</span>
            {" — "}前兆のない突風は予測できません。
          </li>
        </ul>
      </div>
    </details>
  );
}
