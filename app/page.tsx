import { ForecastBoard } from "@/components/forecast-board";
import { ForecastGuide } from "@/components/forecast-guide";
import { OFFSHORE_POINT } from "@/lib/geo";

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
          天気・気温・風・降水量は{" "}
          <a
            className="soft-link"
            href="https://www.ecmwf.int/en/forecasts/datasets/open-data"
          >
            ECMWF の公開データ
          </a>
          （IFS 0.25°）の3時間値です（
          <a className="soft-link" href="https://creativecommons.org/licenses/by/4.0/">
            CC BY 4.0
          </a>
          ）。気象庁の予報ではなく、ECMWF の承認・提携を示すものでもありません。沖の格子点は{" "}
          {OFFSHORE_POINT.lat.toFixed(2)}°N, {OFFSHORE_POINT.lon.toFixed(2)}°E。
        </p>
        <p>
          江の島ヨットハーバー実況：
          <a className="soft-link" href="http://enowin.japaneast.cloudapp.azure.com/">
            enowin
          </a>
          。読み方は上の「補足」へ。
        </p>
      </footer>
    </main>
  );
}
