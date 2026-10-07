import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

export function ForecastGuide() {
  return (
    <details className="anim-rise group border-t border-line/50 pt-4">
      <summary className="cursor-pointer list-none marker:content-none">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-muted">この予報の読み方</h2>
          <span className="shrink-0 text-sm leading-none text-muted transition-transform duration-300 group-open:rotate-45 group-open:text-sea">
            ＋
          </span>
        </div>
      </summary>

      <div className="mt-3 space-y-3 text-[12px] leading-5 text-muted">
        <div>
          <p className="font-medium text-ink/75">参照しているデータ</p>
          <p className="mt-1">
            沖の天気と風は欧州中期予報センター（ECMWF）の公開数値予報、いまの風は江の島ヨットハーバー（enowin）の5分実況、警報・注意報は気象庁（鎌倉市）の発表です。いずれも申請や API
            キーなしで使える公開データです。
          </p>
        </div>
        <div>
          <p className="font-medium text-ink/75">予測の立て方</p>
          <p className="mt-1">
            数時間〜数日先は、七里ヶ浜沖の格子点における ECMWF の3時間ごとの値を使います。いま〜1時間は、ハーバー実況の直近の傾きを15・30・60分先へ延ばし、過去の当たり具合で校正したナウキャストです。格子点まで約{" "}
            {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km
            あり、地点が異なるため数値はそのまま比べません。
          </p>
        </div>
        <div>
          <p className="font-medium text-ink/75">局地補正</p>
          <p className="mt-1">
            同じ時間帯・似た風向のとき「ハーバー平均 ÷ 沖予報」がどれくらいだったかを覚え、その倍率を沖の予報にかけます。ハーバーの値で沖を置き換えるのではなく、過去のずれを統計的に寄せる処理です。
          </p>
        </div>
        <p>
          平均 10 m/s 以上、または瞬間 13 m/s
          以上は出艇不可能とします。最終判断は現場と警報・注意報。前兆のない突風は見えません。
        </p>
      </div>
    </details>
  );
}
