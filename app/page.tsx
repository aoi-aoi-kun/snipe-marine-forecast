import { ForecastBoard } from "@/components/forecast-board";
import { WINDY_URL, windyBlurb } from "@/lib/ui-copy";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-[max(3.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 sm:pb-24 sm:pt-4">
      <ForecastBoard />

      <footer className="anim-rise prose-muted mt-8 space-y-2 border-t border-line/60 pt-5 sm:mt-10">
        <p>
          警報・注意報：
          <a
            className="soft-link"
            href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
          >
            気象庁（鎌倉市）
          </a>
          （公共データ利用規約に基づく利用）。
        </p>
        <p>
          実況：
          <a className="soft-link" href="http://enowin.japaneast.cloudapp.azure.com/">
            enowin · 江の島ヨットハーバー
          </a>
        </p>
        <p>
          {windyBlurb()}
          <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
            Windy
          </a>
          。急上昇の学習用に ECMWF 公開データも裏で取得しますが、3時間予報はこの画面には出しません。
        </p>
      </footer>
    </main>
  );
}
