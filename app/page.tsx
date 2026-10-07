import { ForecastBoard } from "@/components/forecast-board";
import { ForecastGuide } from "@/components/forecast-guide";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-[max(3.5rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] sm:px-8 sm:pb-20">
      <header className="site-hero -mx-4 px-4 pb-8 pt-8 text-paper sm:-mx-8 sm:px-8 sm:pb-14 sm:pt-14">
        <p className="anim-rise text-xs font-medium tracking-[0.18em] text-mist sm:text-sm">相模湾 · スナイプ出艇向け</p>
        <h1 className="anim-rise anim-rise-delay-1 mt-2 font-serif text-[2.5rem] leading-[1.05] tracking-tight sm:mt-3 sm:text-6xl md:text-7xl">
          七里ヶ浜沖
        </h1>
        <p className="anim-rise anim-rise-delay-2 mt-3 max-w-xl text-sm leading-7 text-mist/95 sm:mt-4 sm:text-base">
          ECMWF の沖予報（3時間・144時間）と、江の島ヨットハーバーの5分実況を並べた参考画面です。升の範囲と実況地点の違いを前提に読んでください。
        </p>
      </header>
      <div className="space-y-8 sm:space-y-10">
        <ForecastGuide />
        <ForecastBoard />
      </div>
      <footer className="anim-rise mt-14 space-y-3 border-t border-line/80 pt-7 text-xs leading-5 text-muted">
        <p>
          出典：気象庁ホームページ（
          <a
            className="underline decoration-line underline-offset-2 transition-colors hover:text-ink"
            href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
          >
            鎌倉市の警報・注意報
          </a>
          ）。公共データ利用規約（第1.0版）に基づき利用しています。
        </p>
        <p>
          天気・気温・風・降水量は{" "}
          <a
            className="underline decoration-line underline-offset-2 transition-colors hover:text-ink"
            href="https://www.ecmwf.int/en/forecasts/datasets/open-data"
          >
            ECMWF の公開データ
          </a>
          （IFS 0.25°）の3時間ごとの値です。
          <a
            className="underline decoration-line underline-offset-2 transition-colors hover:text-ink"
            href="https://creativecommons.org/licenses/by/4.0/"
          >
            CC BY 4.0
          </a>
          で利用しています。気象庁の予報ではなく、ECMWF による承認や提携を示すものでもありません。
        </p>
        <p>
          江の島ヨットハーバー実況：
          <a
            className="underline decoration-line underline-offset-2 transition-colors hover:text-ink"
            href="http://enowin.japaneast.cloudapp.azure.com/"
          >
            enowin
          </a>
          （運営・ハーバー確認済み）。設計の説明はページ上部の「このアプリについて」を参照してください。
        </p>
      </footer>
    </main>
  );
}
