import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

const WINDY_URL =
  "https://www.windy.com/35.309/139.482?35.250,139.500,11,i:pressure";

export function ForecastGuide() {
  return (
    <details className="anim-rise group border-t border-line/50 pt-4">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-muted">この画面の読み方</h2>
          <span className="shrink-0 text-sm leading-none text-muted transition-transform duration-300 group-open:rotate-45 group-open:text-sea">
            ＋
          </span>
        </div>
      </summary>

      <div className="mt-3 space-y-2.5 text-[12px] leading-5 text-muted">
        <p>
          このアプリは江の島ヨットハーバーの5分実況と、そこから伸ばす短時間予測・急上昇検知に絞っています。格子点（七里ヶ浜沖）まで約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)}{" "}
          km。数時間〜数日の沖の見通しは{" "}
          <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
            Windy
          </a>
          を使ってください。
        </p>
        <ul className="space-y-1.5">
          <li>
            <span className="font-medium text-ink/75">使い分け</span>
            {" — "}いま〜1時間はハーバー実況とナウキャスト。それより先の3時間予報は Windy。
          </li>
          <li>
            <span className="font-medium text-ink/75">急上昇</span>
            {" — "}立ち上がり検知と、過去の急上昇パターンとのマッチを表示します。学習用に沖モデルとの突合も裏で続けます。
          </li>
          <li>
            <span className="font-medium text-ink/75">実況停止</span>
            {" — "}enowin の更新が止まっているあいだは、短時間予測を出しません。
          </li>
          <li>
            <span className="font-medium text-ink/75">出艇の目安</span>
            {" — "}ナウキャスト平均が 10 m/s を超えると警告。最終判断は現場と警報・注意報。
          </li>
          <li>
            <span className="font-medium text-ink/75">限界</span>
            {" — "}前兆のない突風は見えません。
          </li>
        </ul>
      </div>
    </details>
  );
}
