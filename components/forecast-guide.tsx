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

      <div className="mt-4 space-y-4 text-sm leading-6 text-muted">
        <p>
          沖の見通しは ECMWF IFS 0.25°（約25km升）の3時間値、いまの風は江の島ヨットハーバー（格子点から約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km）の5分実況です。地点が違うため、ハーバーを沖の真値とはみなしません。
        </p>
        <ul className="space-y-2">
          <li>
            <span className="font-medium text-ink/80">粒度</span>
            {" — "}見通しは3時間、直近は5分実況とナウキャスト。
          </li>
          <li>
            <span className="font-medium text-ink/80">補正</span>
            {" — "}MOS局地補正と急上昇パターンは統計的な倍率で、置き換えではありません。
          </li>
          <li>
            <span className="font-medium text-ink/80">出艇不可能</span>
            {" — "}平均 10 m/s 以上、または瞬間 13 m/s 以上。最終判断は現場と警報。
          </li>
          <li>
            <span className="font-medium text-ink/80">限界</span>
            {" — "}前兆のない突発的な吹き上がりは予言できません。
          </li>
        </ul>
      </div>
    </details>
  );
}
