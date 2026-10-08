# 七里ヶ浜 · ハーバー実況

相模湾・七里ヶ浜向けの参考画面です。江の島ヨットハーバーの5分実況・ナウキャスト・急上昇検知／マッチを出します。数時間〜数日の3時間予報は [Windy](https://www.windy.com/35.309/139.482?35.250,139.500,11) に任せ、この画面には表示しません。

目的・データ源・補正の考え方など、第三者向けの設計説明は [docs/DESIGN.md](docs/DESIGN.md) にあります。

MOS・急上昇マッチの学習用に、裏で ECMWF 公開データ（IFS 0.25°）も取得します。鎌倉市の警報・注意報は気象庁ホームページの公開データです。申請や API キーは使いません。

## 自分のパソコンで見る

必要なもの: Node.js と、eccodes の `grib_ls`

1. このフォルダで `npm install` を実行する
2. `npm run dev` を実行する
3. パソコンのブラウザで http://127.0.0.1:3847 を開く

## 自分のスマホで見る（同じ Wi‑Fi）

1. 上の「自分のパソコンで見る」まで済ませる（パソコン側を起動したままにする）
2. パソコンの IP アドレスを調べる（例: `192.168.1.23`）
3. スマホを同じ Wi‑Fi につなぐ
4. スマホのブラウザで `http://（パソコンのIP）:3847` を開く  
   例: `http://192.168.1.23:3847`

これではインターネット上の他人には届きません。家の外や別の Wi‑Fi の人に見せるときは、次の「ほかの人にも公開する」へ進みます。

## ほかの人にも公開する（おすすめ: Render）

予報の読み取りに `grib_ls` が必要なので、Vercel ではなく Docker で常時起動します。ログインは不要です。発行された HTTPS の URL を送れば、相手のスマホやパソコンから同じ画面を開けます。`.cache` を Disk に載せたまま動かし続けると、学習が日々厚くなります。

### A. GitHub リポジトリを用意する

1. このプロジェクトを **GitHub の公開リポジトリ**にする（Cursor なら Create repo から作成して push）
2. リポジトリの URL を控える（例: `https://github.com/あなた/snipe-marine-forecast`）

### B. Render Blueprint で載せる（いちばん簡単）

1. [https://render.com/](https://render.com/) にログインする
2. **New +** → **Blueprint**
3. GitHub を接続し、このリポジトリを選ぶ
4. `render.yaml` が読み込まれます（Docker・Singapore・Free・`/api/health`）
5. **Apply** してデプロイを待つ（初回ビルドは数分）
6. 完了後の URL（例: `https://shichirigahama-forecast.onrender.com`）を控える

補足: **Free プランでは Disk（永続ディスク）が使えません**。学習キャッシュは再デプロイで消えることがあります。溜め続けたいときは、後から有料プランにして `/app/.cache` に Disk を付けてください。ポートは `3847` です。

### C. スリープ対策（無料枠では必須）

Render 無料枠はアクセスが無いと眠ります。学習を続けるため、デプロイ後すぐに外部 cron を付けます。

1. [https://cron-job.org/](https://cron-job.org/) などで無料アカウントを作る
2. 新しいジョブを作る
   - URL: `https://（あなたのRenderのURL）/api/health?warm=1`
   - 間隔: **8〜10分ごと**
   - メソッド: GET
3. 保存したら、数回実行されて `/api/health` の `ops.warmCount` が増えることを確認する

### D. リンクを共有する

1. Render の `https://….onrender.com` を相手に送る
2. 相手はブラウザで開くだけ（アカウント不要・スマホ可）

補足: 初回起動やスリープ明けは数十秒かかることがあります。Disk を消すと学習が消えます。

## 精度を上げ続けるには

局地補正（MOS・ナウキャスト校正・急上昇・補正の補正）は、サーバが起きていて `.cache` が消えないあいだに実況と予報を突合して厚くなります。画面の「学習の状態」に件数と運用ヒントが出ます。

1. **常時起動**  
   Docker / Render の Web Service を止めない。`DISABLE_CONTINUOUS_LEARN=1` は付けない（約10分ごとに学習）。
2. **`.cache` を永続化する**  
   - Render: `render.yaml` の Disk（`/app/.cache`）をそのまま使う  
   - 自宅 Docker: `docker compose` の `forecast-cache` ボリュームを消さない  
   デプロイや再起動のたびに `.cache` を空にすると学習が振り出しに戻ります。
3. **無料枠のスリープを減らす**  
   プロセス内 keep-alive は、すでに起きているときだけ効きます（`RENDER_EXTERNAL_URL` または `KEEP_ALIVE_URL`、既定約8分）。眠ったあとは外部から起こす必要があります。  
   - 例: [cron-job.org](https://cron-job.org/) などで **8〜10分ごと**に GET  
     `https://（あなたのURL）/api/health?warm=1`  
   - `/api/health` は生存確認と学習状態の JSON を返します。`?warm=1` でハーバー再取得、約6回に1回は ECMWF も再取得します。必要なら `?full=1` で毎回フル更新。
4. **止め方（任意）**  
   - `DISABLE_CONTINUOUS_LEARN=1` … バックグラウンド学習を止める  
   - `DISABLE_KEEP_ALIVE=1` … プロセス内 ping を止める

## 自宅の Docker だけで見る（任意）

同じ Wi‑Fi 内だけ、または自分でサーバを持つ場合:

1. Docker を入れる
2. このフォルダで `docker compose up --build -d` を実行する
3. http://localhost:3847 で確認する
4. 同じ Wi‑Fi のスマホからは `http://（ホストのIP）:3847` を開く

インターネット全体に出すには、別途ドメインや公開ホスト（Render など）が必要です。

## 画面の見方

- 主表示は江の島ヨットハーバーの実況とナウキャスト（15・30・60分）です。
- 急上昇アラートと、過去パターンとのマッチ（補正係数）を出します。
- ナウキャスト平均が 10 m/s を超えると警告します。
- 数時間〜数日の3時間予報は画面に出さず、[Windy](https://www.windy.com/35.309/139.482?35.250,139.500,11) へ案内します。

## 江の島ハーバー実況（ナウキャスト）

[enowin](http://enowin.japaneast.cloudapp.azure.com/) の江の島ヨットハーバー実況を使い、次を出します。

- **ナウキャスト**: 直近30分の傾きを15・30・60分先へ延長し、過去実況との突合で減衰・バイアスを校正（`.cache/nowcast-calib.json`）
- **立ち上がり検知**: 急勾配や閾値超えをアラート
- **急上昇パターン**: 過去の急上昇を `.cache/harbor-patterns.json` に溜め、似た前兆のときマッチを表示（補正係数も保持）
- **MOS / メタ学習（裏）**: ECMWF との突合で倍率を学習（`.cache/mos.json` / `.cache/meta-calib.json`）。画面の3時間予報表示には使いません
- **過去突合の厚み**: ECMWF 公開初期値に加え、Open-Meteo の historical IFS（約30日）で欠けた枠を補う
- **実況停止**: enowin が止まっているあいだはナウキャストを出さない
- **継続学習**: ページを開くたびに実況を取り込み、サーバ起動中は約10分ごとにも更新。進捗は UI の「学習の状態」と `/api/health`、`.cache/skill-history.json` に残ります

出艇の判断は、現場の状況と気象庁の警報・注意報によります。この画面は気象庁の予報ではありません。
