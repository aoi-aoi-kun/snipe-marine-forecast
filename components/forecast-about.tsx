import type { HarborBundle } from "@/lib/types";
import {
  formatContinuousLine,
  formatLearnLead,
  formatLearnMetrics,
  formatLearningTrend,
  shortenLearningNote,
  WINDY_URL,
  windyBlurb,
} from "@/lib/ui-copy";
import { HARBOR_TO_OFFSHORE_KM } from "@/lib/geo";

function learnInput(harbor: HarborBundle | null) {
  if (!harbor) return null;
  return {
    tip: harbor.learnOps?.tip,
    intervalMinutes: harbor.mos?.continuous.intervalMinutes ?? 10,
    continuousStarted: harbor.mos?.continuous.started ?? false,
    ticking: harbor.learnOps?.ticking ?? false,
    lastTickAt: harbor.mos?.continuous.lastTickAt ?? null,
    cacheWritable: harbor.learnOps?.cacheWritable,
    learningDays: harbor.learnOps?.learningDays ?? 0,
    warmCount: harbor.learnOps?.warmCount ?? 0,
    nowcastCases: harbor.learnOps?.nowcastCases ?? harbor.nowcastSkill.caseCount,
    nowcastCalibrated: harbor.nowcastSkill.calibrated,
    mosPairs: harbor.learnOps?.mosPairs ?? harbor.mos?.pairCount ?? 0,
    mosActiveBins: harbor.mos?.activeBins ?? 0,
    patternEvents: harbor.learnOps?.patternEvents ?? harbor.pattern.storedEvents,
    metaMosReady: Boolean(harbor.learnOps?.metaMosReady || harbor.mos?.meta?.mosReady),
    metaPatternReady: Boolean(
      harbor.learnOps?.metaPatternReady || harbor.mos?.meta?.patternReady,
    ),
    learningNote: harbor.learning?.note,
    improving: harbor.learning?.improving,
  };
}

function accuracyParagraphs(harbor: HarborBundle | null): string[] {
  if (!harbor) {
    return [
      "実況を取得すると、過去の検証に基づく誤差の目安をここに表示します。",
    ];
  }
  const parts: string[] = [];
  const horizons = harbor.nowcastSkill.horizons ?? [];
  if (horizons.length > 0) {
    const line = horizons
      .map((item) => {
        const mae =
          item.maeCalibrated != null && Number.isFinite(item.maeCalibrated)
            ? `±${item.maeCalibrated.toFixed(2)} m/s`
            : "—";
        return `${item.minutesAhead}分先 ${mae}`;
      })
      .join("、");
    parts.push(
      `ナウキャストの平均誤差（校正後）は、おおよそ ${line} です。平常時は「いまの風が続く」に近い予測になりやすく、誤差は小さめに見えます。`,
    );
  } else {
    parts.push("ナウキャストの誤差目安は、検証データが揃い次第表示します。");
  }

  const rising = harbor.nowcastSkill.risingHorizons ?? [];
  if (rising.length > 0) {
    parts.push(
      "風が立ち上がっているときは、平常時とは別の校正を使い、傾きを残した予測に切り替えます。急上昇そのものを事前に完璧に当てる精度はまだ限定的です。",
    );
  }

  const blend = harbor.nowcastSkill.blendCalib;
  if (blend) {
    parts.push(blend.note);
    const best = [...blend.horizons].sort(
      (a, b) => b.skillVsNowcast - a.skillVsNowcast,
    )[0];
    if (blend.calibrated && best && best.skillVsNowcast > 0) {
      parts.push(
        `融合校正後は、ナウキャスト単体より誤差が小さくなる傾向があります（例: ${best.minutesAhead}分先）。`,
      );
    }
  }

  const outlook = harbor.nowcastSkill.rampOutlook;
  if (outlook?.pRiseGe25 != null && outlook.pPeakGe10 != null) {
    parts.push(
      `いま急上昇マッチがある場合の分類目安は、類似検証 ${outlook.support} 件にもとづき、` +
        `+2.5 m/s 以上の急上昇が約 ${Math.round(outlook.pRiseGe25 * 100)}%、` +
        `ピーク平均 10 m/s 超が約 ${Math.round(outlook.pPeakGe10 * 100)}% です。`,
    );
  } else if (harbor.pattern.match?.calib) {
    parts.push(harbor.pattern.match.calib.note);
  } else {
    parts.push(
      "急上昇の分類精度は、似た過去事例の事後検証が増えるほど安定します。前兆のない突風は捉えられません。",
    );
  }

  parts.push(
    "この数値は参考であり、気象庁の警報・注意報や現場の判断に代わるものではありません。",
  );
  return parts;
}

export function ForecastAbout({ harbor }: { harbor: HarborBundle | null }) {
  const input = learnInput(harbor);
  const metrics = input ? formatLearnMetrics(input) : [];
  const trend = input ? formatLearningTrend(input.improving) : null;

  return (
    <section className="about-panel anim-rise" aria-labelledby="about-heading">
      <div className="mb-5 sm:mb-6">
        <p className="eyebrow mb-1">案内</p>
        <h2 id="about-heading" className="section-title">
          このアプリについて
        </h2>
        <p className="prose-muted mt-2 max-w-prose">
          江の島ヨットハーバーの実況と、そこから見る約1時間先までの目安です。七里ヶ浜沖の格子点とは約{" "}
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km 離れており、数値はそのまま比べられません。
        </p>
      </div>

      <div className="about-grid">
        <article className="about-block">
          <h3>アプリの見方</h3>
          <p>
            画面上部の細いブランド帯の直後に、実況・ナウキャストが並びます。気象庁の警報・注意報は、発表があるときだけ見出し直下に強く出します。ないときは「発表なし」一行に留めます。
          </p>
          <p>
            短時間の判断はナウキャストの15・30・60分を見てください。平均 10 m/s 超、瞬間 13 m/s 超は強調表示します。急上昇マッチは類似の有無と見込みの目安で、数値はナウキャストに織り込みます。
          </p>
          <p>
            {windyBlurb()}
            <a className="soft-link" href={WINDY_URL} target="_blank" rel="noreferrer">
              Windy を開く
            </a>
          </p>
        </article>

        <article className="about-block">
          <h3>予測の計算方法</h3>
          <p>
            ナウキャストは、直近およそ30分の実況から風速・風向の傾きを求め、15・30・60分先へ延長します。過去に「同じように延長したあと、実際どうなったか」で減衰とずれを校正します。
          </p>
          <p>
            平常時と立ち上がり時では校正を分けます。立ち上がりや急上昇マッチがあるときは、傾きを残した校正と、過去の類似イベントのピーク目安への寄せを使います。融合の寄せ具合も事後検証で重みとバイアスを学習します。風向は16方位で扱います。
          </p>
          <p>
            数時間先の沖の格子予報は画面には出さず、学習用にだけ取得します。出艇の最終判断は、現場と気象庁の発表に従ってください。
          </p>
        </article>

        <article className="about-block">
          <h3>予測の精確性</h3>
          {accuracyParagraphs(harbor).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </article>

        <article className="about-block">
          <h3>学習の状態</h3>
          {input ? (
            <>
              <p>{formatLearnLead(input)}</p>
              <p>{formatContinuousLine(input)}</p>
              <dl className="stat-row not-prose">
                {metrics.map((item) => (
                  <div key={item.label} className="stat-pill">
                    <dt>{item.label}</dt>
                    <dd>
                      {item.value}
                      {item.hint ? <span className="stat-hint">{item.hint}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {harbor?.learning ? (
                <>
                  <p>{shortenLearningNote(harbor.learning.note)}</p>
                  {trend ? <p>{trend}</p> : null}
                </>
              ) : (
                <p>
                  {harbor?.nowcastSkill.calibrated
                    ? "ナウキャストは過去実況で校正済みです。"
                    : "ナウキャストは検証データを蓄積中です。"}
                  {harbor?.mos?.note ? ` ${harbor.mos.note}` : ""}
                </p>
              )}
              {harbor?.nowcastSkill.note ? (
                <p className="text-[0.7rem] leading-relaxed text-muted">
                  {harbor.nowcastSkill.note}
                </p>
              ) : null}
            </>
          ) : (
            <p>実況を読み込むと、学習の件数と稼働状況を表示します。</p>
          )}
        </article>
      </div>
    </section>
  );
}
