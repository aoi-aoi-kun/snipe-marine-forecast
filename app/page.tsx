import { ForecastBoard } from "@/components/forecast-board";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-[max(3.5rem,env(safe-area-inset-bottom))] pt-[max(0.4rem,env(safe-area-inset-top))] sm:px-6 sm:pb-16 sm:pt-2">
      <ForecastBoard />

      <footer className="site-footer anim-rise">
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
          急上昇の学習用に ECMWF 公開データも裏で取得しますが、3時間予報はこの画面には出しません。
        </p>
      </footer>
    </main>
  );
}
