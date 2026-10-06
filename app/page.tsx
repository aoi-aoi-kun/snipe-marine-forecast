import { ForecastBoard } from "@/components/forecast-board";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="border-b border-line pb-6">
        <p className="text-sm text-sea">相模湾の格子点</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-ink sm:text-5xl">
          七里ヶ浜沖
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          北緯 35.25°、東経 139.50°。約25kmの升で、海岸を含みます。48時間先までは6時間ごと、その先は12時間ごとで、96時間先まで。
        </p>
      </header>
      <ForecastBoard />
      <footer className="mt-12 space-y-3 border-t border-line pt-6 text-xs leading-5 text-muted">
        <p>
          出典：気象庁ホームページ（
          <a
            className="underline decoration-line underline-offset-2 hover:text-ink"
            href="https://www.jma.go.jp/bosai/warning/#lang=ja&area_type=class20s&area_code=1420400"
          >
            鎌倉市の警報・注意報
          </a>
          ）。公共データ利用規約（第1.0版）に基づき利用しています。
        </p>
        <p>
          天気・気温・風・降水量は NOAA GFS（0.25°）の毎時値を、NOMADS の GRIB フィルタで取得して、6時間または12時間に集約したものです。気象庁の予報ではありません。NOAA による承認や提携を示すものではありません。
        </p>
        <p>出艇の判断は、現場の状況と気象庁の警報・注意報によります。</p>
      </footer>
    </main>
  );
}
