import { AreaMap } from "@/components/area-map";
import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

export function ForecastGuide() {
  return (
    <section
      aria-labelledby="forecast-guide-title"
      className="anim-rise anim-rise-delay-2 space-y-8 rounded-xl border border-line/70 bg-paper/55 p-4 backdrop-blur-sm sm:p-6"
    >
      <header className="space-y-3">
        <p className="text-xs font-medium tracking-[0.16em] text-sea">このアプリについて</p>
        <h2
          id="forecast-guide-title"
          className="font-serif text-2xl tracking-tight text-ink sm:text-3xl"
        >
          沖の予報と、岸の実況を分けて読む
        </h2>
        <p className="max-w-3xl text-sm leading-7 text-ink/85 sm:text-base">
          七里ヶ浜沖でのスナイプ出艇向けに、相模湾の数値予報と江の島の風実況を1つの画面にまとめています。
          気象庁の公式予報の代替ではなく、公開データを組み合わせた参考情報です。地点の違いを前提に、時間軸の違う2種類の情報を並べるのが設計の中心です。
        </p>
      </header>

      <AreaMap />

      <div className="grid gap-6 md:grid-cols-2">
        <article className="space-y-2">
          <h3 className="font-serif text-lg text-ink">沖の3時間予報（妥当性）</h3>
          <p className="text-sm leading-7 text-muted">
            天気・気温・風・降水量は ECMWF が公開する IFS 0.25° の格子値です。1升はおよそ25km四方で、七里ヶ浜の海岸から沖までを1つの箱として扱います。
            00 UTC と 12 UTC の初期値から、日本時間の3時間枠で144時間先まで並べています。全球モデルなので、地形や島の影響は格子の解像度でしか表現されません。
            数時間〜2日程度の大まかな向きや強さの傾向には使えますが、岸際の数分単位の変化をそのまま当てるものではありません。
          </p>
        </article>
        <article className="space-y-2">
          <h3 className="font-serif text-lg text-ink">江の島ハーバー実況（直近）</h3>
          <p className="text-sm leading-7 text-muted">
            江の島ヨットハーバー（enowin）の5分実況は、予報格子の代表点から約{" "}
            {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km 離れた岸の地点です。ハーバーの風を沖の真値とみなしません。
            直近1〜2時間の上昇率・風向変化からナウキャストと吹き上がり検知を出します。あわせて、過去の3時間枠ごとに「沖のECMWF」と「同時間帯のハーバー平均」を突合し、時間帯×風向帯の倍率（MOS）で沖予報を常時ずらします。急上昇の型が似ているときは、その上に短い上振れ補正も足します。サーバが動いているあいだは約15分ごとに学習を続けます。
          </p>
        </article>
      </div>

      <article className="space-y-3 border-t border-line/70 pt-6">
        <h3 className="font-serif text-lg text-ink">設計思想（第三者向けの要点）</h3>
        <ul className="space-y-3 text-sm leading-7 text-muted">
          <li>
            <span className="font-medium text-ink/85">粒度を混ぜない。</span>
            144時間先までの見通しは3時間、いま起きていることは5分実況。同じ表に無理に揃えず、役割を分けています。
          </li>
          <li>
            <span className="font-medium text-ink/85">出典を明示する。</span>
            数値予報は ECMWF 公開データ（CC BY 4.0）、警報・注意報は気象庁、実況はハーバー公開データです。APIキーや有料サービスは使いません。
          </li>
          <li>
            <span className="font-medium text-ink/85">出艇判断はルール＋現場。</span>
            平均 10 m/s 以上、または最大瞬間 13 m/s 以上の枠を「出艇不可能」と表示しますが、最終判断は現場の波・操船・気象庁の警報に委ねます。
          </li>
          <li>
            <span className="font-medium text-ink/85">限界も表示する。</span>
            前兆のない突発的な吹き上がりを、数値予報だけで確実に予言することはできません。実況は「起き始めを早く知る」ため、パターン補正は「似た型のとき沖予報を控えめに上振れさせる」ための補助です。
          </li>
        </ul>
      </article>
    </section>
  );
}
