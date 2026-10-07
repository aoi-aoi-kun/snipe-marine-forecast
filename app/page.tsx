import { ForecastBoard } from "@/components/forecast-board";
import { ForecastGuide } from "@/components/forecast-guide";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-[max(3.75rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] sm:px-8 sm:pb-24">
      <header className="site-hero -mx-4 px-4 pb-10 pt-9 text-paper sm:-mx-8 sm:px-8 sm:pb-16 sm:pt-16">
        <p className="anim-rise text-[0.7rem] font-medium tracking-[0.2em] text-mist/95 sm:text-xs">
          相模湾 · スナイプ出艇向け
        </p>
        <h1 className="anim-rise anim-rise-delay-1 mt-3 font-serif text-[2.75rem] leading-[1.02] tracking-[-0.03em] sm:mt-4 sm:text-6xl md:text-7xl">
          七里ヶ浜沖
        </h1>
        <p className="anim-rise anim-rise-delay-2 mt-4 max-w-sm text-sm leading-6 text-mist/90 sm:mt-5 sm:max-w-md sm:text-base sm:leading-7">
          沖の3時間予報と、江の島ハーバーの5分実況。
        </p>
      </header>

      <ForecastBoard />

      <div className="mt-14 sm:mt-20">
        <ForecastGuide />
      </div>

      <footer className="anim-rise mt-14 space-y-3.5 border-t border-line/70 pt-8 text-xs leading-5 text-muted sm:mt-20">
        <p>
          出典：気象庁ホームページ（
          <a
            className="soft-link"
            href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
          >
            鎌倉市の警報・注意報
          </a>
          ）。公共データ利用規約（第1.0版）に基づき利用しています。
        </p>
        <p>
          天気・気温・風・降水量は{" "}
          <a
            className="soft-link"
            href="https://www.ecmwf.int/en/forecasts/datasets/open-data"
          >
            ECMWF の公開データ
          </a>
          （IFS 0.25°）の3時間ごとの値です。
          <a className="soft-link" href="https://creativecommons.org/licenses/by/4.0/">
            CC BY 4.0
          </a>
          で利用しています。気象庁の予報ではなく、ECMWF による承認や提携を示すものでもありません。
        </p>
        <p>
          江の島ヨットハーバー実況：
          <a className="soft-link" href="http://enowin.japaneast.cloudapp.azure.com/">
            enowin
          </a>
          （運営・ハーバー確認済み）。読み方は上の「補足」を参照。
        </p>
      </footer>
    </main>
  );
}
