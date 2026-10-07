import { AreaMap } from "@/components/area-map";
import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

export function ForecastGuide() {
  return (
    <details className="anim-rise group border-t border-line/70 pt-6">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-muted">補足</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight text-ink sm:text-2xl">
              この予報の読み方
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              升の範囲、ハーバー実況との違い、設計の前提。タップして開く。
            </p>
          </div>
          <span className="shrink-0 text-sm text-sea transition-transform group-open:rotate-45">
            ＋
          </span>
        </div>
      </summary>

      <div className="mt-5 space-y-6">
        <AreaMap />

        <div className="grid gap-5 md:grid-cols-2">
          <article className="space-y-1.5">
            <h3 className="text-sm font-medium text-ink">沖の3時間予報</h3>
            <p className="text-sm leading-6 text-muted">
              ECMWF IFS 0.25°（約25km升）の格子値。144時間先まで。大まかな傾向向けで、岸際の数分単位の変化は捉えません。
            </p>
          </article>
          <article className="space-y-1.5">
            <h3 className="text-sm font-medium text-ink">江の島ハーバー実況</h3>
            <p className="text-sm leading-6 text-muted">
              格子点から約 {HARBOR_TO_OFFSHORE_KM.toFixed(1)}{" "}
              km の岸の5分値。ナウキャスト・吹き上がり検知・MOS局地補正に使い、沖の真値とはみなしません。
            </p>
          </article>
        </div>

        <ul className="space-y-2 border-t border-line/60 pt-4 text-sm leading-6 text-muted">
          <li>
            <span className="font-medium text-ink/80">粒度を分ける</span>
            {" — "}見通しは3時間、いまは5分実況。
          </li>
          <li>
            <span className="font-medium text-ink/80">出典</span>
            {" — "}ECMWF（CC BY 4.0）、気象庁警報、ハーバー実況（enowin）。
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
