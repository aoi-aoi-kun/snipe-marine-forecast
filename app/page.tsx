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
          北緯 35.25°、東経 139.50°。ECMWF の 0.25° の升で、海岸を含みます。3時間ごとで、96時間先まで。
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
          天気・気温・風・降水量は{" "}
          <a
            className="underline decoration-line underline-offset-2 hover:text-ink"
            href="https://www.ecmwf.int/en/forecasts/datasets/open-data"
          >
            ECMWF の公開データ
          </a>
          （IFS 0.25°）の3時間ごとの値です。
          <a
            className="underline decoration-line underline-offset-2 hover:text-ink"
            href="https://creativecommons.org/licenses/by/4.0/"
          >
            CC BY 4.0
          </a>
          で利用しています。気象庁の予報ではなく、ECMWF による承認や提携を示すものでもありません。
        </p>
        <p>
          10 m/s 以上の枠は出艇不可能です。それ以外は、現場の状況と気象庁の警報・注意報によります。
        </p>
      </footer>
    </main>
  );
}
