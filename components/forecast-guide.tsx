import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";
import { WINDY_URL, windyBlurb } from "@/lib/ui-copy";

export function ForecastGuide() {
  return (
    <details className="anim-rise info-disclosure group border-t border-line/50 pt-4">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="eyebrow mb-0.5">Guide</p>
            <h2 className="text-sm font-medium text-ink/80">この画面の読み方</h2>
          </div>
          <span
            className="shrink-0 text-sm leading-none text-muted transition-transform duration-300 group-open:rotate-45 group-open:text-sea"
            aria-hidden="true"
          >
            ＋
          </span>
        </div>
      </summary>

      <div className="prose-muted mt-3 max-w-prose space-y-3">
        <p>
          江の島ヨットハーバーの5分実況と、そこから伸ばす短時間予測に特化しています。ハーバーと七里ヶ浜沖の格子点は約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km 離れており、数値はそのまま比較できません。{windyBlurb()}
          {" "}
          <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
            Windy を開く
          </a>
        </p>

        <ul className="guide-list space-y-2">
          <li>
            <span className="font-medium text-ink/75">いま〜1時間</span>
            {" — "}
            実況カードとナウキャスト（15・30・60分）を見てください。
          </li>
          <li>
            <span className="font-medium text-ink/75">急上昇</span>
            {" — "}
            立ち上がりのアラートに加え、似た過去イベントから上昇幅・ピーク・所要時間の目安を出します。マッチ後の実測で目安を校正し、使うほど精度が上がります。
          </li>
          <li>
            <span className="font-medium text-ink/75">強調の目安</span>
            {" — "}
            平均 10 m/s 超、瞬間 13 m/s 超は実況・ナウキャスト・急上昇マッチで強く表示します。出艇の最終判断は現場と気象庁の警報・注意報に従ってください。
          </li>
          <li>
            <span className="font-medium text-ink/75">実況が止まったとき</span>
            {" — "}
            enowin の更新が途切れると、短時間予測は出しません。最後に取れた観測だけを表示します。
          </li>
          <li>
            <span className="font-medium text-ink/75">限界</span>
            {" — "}
            前兆のない突風や、地点差によるブレは拾えません。
          </li>
        </ul>
      </div>
    </details>
  );
}
