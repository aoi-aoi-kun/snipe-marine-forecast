import { ForecastBoard } from "@/components/forecast-board";
import { ForecastGuide } from "@/components/forecast-guide";

const WINDY_URL =
  "https://www.windy.com/35.309/139.482?35.250,139.500,11,i:pressure";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-[max(3.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 sm:pb-24 sm:pt-4">
      <ForecastBoard />

      <div className="mt-8 sm:mt-10">
        <ForecastGuide />
      </div>

      <footer className="anim-rise mt-8 space-y-2.5 border-t border-line/60 pt-5 text-[11px] leading-4 text-muted sm:mt-10">
        <p>
          出典：気象庁ホームページ（
          <a
            className="soft-link"
            href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
          >
            鎌倉市の警報・注意報
          </a>
          ）。公共データ利用規約（第1.0版）に基づく利用です。
        </p>
        <p>
          江の島ヨットハーバー実況：
          <a className="soft-link" href="http://enowin.japaneast.cloudapp.azure.com/">
            enowin
          </a>
          。読み方は上の「補足」へ。
        </p>
        <p>
          数時間〜数日の風の見通しは{" "}
          <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
            Windy
          </a>
          を参照してください。学習・急上昇マッチ用に ECMWF 公開データも裏で取得しますが、この画面には3時間予報を出しません。
        </p>
      </footer>
    </main>
  );
}
