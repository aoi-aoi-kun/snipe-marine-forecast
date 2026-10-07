import { ForecastBoard } from "@/components/forecast-board";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-14 sm:px-8 sm:pb-20">
      <header className="site-hero -mx-5 px-5 pb-10 pt-10 text-paper sm:-mx-8 sm:px-8 sm:pb-14 sm:pt-14">
        <p className="anim-rise text-sm font-medium tracking-[0.18em] text-mist">相模湾</p>
        <h1 className="anim-rise anim-rise-delay-1 mt-3 font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
          七里ヶ浜沖
        </h1>
        <p className="anim-rise anim-rise-delay-2 mt-4 max-w-md text-sm leading-6 text-mist/95 sm:text-base">
          北緯 35.25°、東経 139.50°。海岸を含む約25kmの升を、3時間ごとに144時間先まで。
        </p>
      </header>
      <ForecastBoard />
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
          平均 10 m/s 以上、または最大瞬間風速 13 m/s 以上の枠は出艇不可能です。それ以外は、現場の状況と気象庁の警報・注意報によります。
        </p>
      </footer>
    </main>
  );
}
