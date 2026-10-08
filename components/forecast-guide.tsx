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
          沖の見通しは ECMWF（約25km升・3時間ごと）、直近は江の島ヨットハーバーの5分実況です。格子点まで約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)}{" "}
          km。地点が異なるため、数値はそのまま比べません。
        </p>
        <ul className="space-y-1.5">
          <li>
            <span className="font-medium text-ink/75">使い分け</span>
            {" — "}いま〜1時間はハーバー実況とナウキャスト。数時間〜数日は沖予報（出艇海域の参考）。
          </li>
          <li>
            <span className="font-medium text-ink/75">補正</span>
            {" — "}沖予報への局地補正は控えめ（確かな型だけ）。全体平均では沖をハーバーに寄せません。
          </li>
          <li>
            <span className="font-medium text-ink/75">実況停止</span>
            {" — "}enowin の更新が止まっているあいだは、短時間予測を出しません。
          </li>
          <li>
            <span className="font-medium text-ink/75">出艇不可能</span>
            {" — "}平均 10 m/s 以上、または瞬間 13 m/s 以上。最終判断は現場と警報・注意報。
          </li>
          <li>
            <span className="font-medium text-ink/75">限界</span>
            {" — "}前兆のない突風は見えません。初期値差が大きい枠はモデルのぶれが大きい合図です。
          </li>
        </ul>
      </div>
    </details>
  );
}
