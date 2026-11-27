# プロダクト分析基盤

Cloudflare Worker が Snowplow トラッカーのイベントを受け、R2 に保持します。DuckDB は必要なときに実行し、検証済みの SQL で集計します。Solid v2 のダッシュボードは日常的に確認する指標を表示します。

| 役割 | 実装 |
| --- | --- |
| プロダクトのフロント | `examples/browser.ts` と Solid v2 の収集デモ。ページ、SPA 遷移、カスタムイベント、実験を送信します。 |
| 収集と集計 | `collector/` の Worker、Basin Pipelines または R2 直接保存、`analysis/` の DuckDB CLI と SQL。 |
| ダッシュボード | `dashboard/` の Solid v2 アプリ。日次指標と流入元を表示します。Apache ECharts で DAU・PV・流入元を切り替えられます。期間は直近7日・14日・30日・半年（180日）から選べ、日別 CSV をダウンロードできます。DAU と PV にはそれぞれ目標ラインを設定できます。ローカルでは閲覧をきっかけに DuckDB が集計し、期間ごとに HTTP キャッシュを使います。 |

## 画面を確認する

```sh
pnpm install --frozen-lockfile
pnpm run demo:prepare
pnpm run dashboard
```

`http://127.0.0.1:5173/` を開いてください。確認項目は [ダッシュボードの確認手順](docs/verify-dashboard.md) にあります。

## 自動テストを実行する

Node.js 22.18 以上と pnpm 12.22.0 を使用してください。ブラウザーの結合テストはインストール済みの Google Chrome を使用します。別の Chromium を使う場合は環境変数 `CHROME_BIN` に実行ファイルのパスを指定してください。

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:e2e --out-dir local-data/sample
```

結合テストは、ブラウザーと Node.js の Snowplow トラッカーからローカル Worker に送信し、R2 エミュレーターから取得した原本を DuckDB CLI で Parquet に変換します。再送、重複、ログイン連携、ファネル、実験、ダッシュボードの更新も確認します。結合テストで生成した `local-data/sample/snapshot.json` も、画面の「集計 JSON を開く」から選べます。収集を手動で試す場合は別のターミナルで `pnpm run dev:collector` を起動し、`http://127.0.0.1:5173/collector-demo.html` を開いてください。

## 導入と分析

- [収集 Worker、R2、Basin のデプロイとダッシュボードの実行](docs/deploy.md)
- [新しいアプリの登録、発火条件、Snowplow の送信設定](docs/events.md)
- [指標の定義と CLI の使用例](docs/metrics.md)
- [候補の比較、保存設計、月間10万〜1億イベントの費用](docs/design.md)
- [AI エージェント用の分析手順](SKILL.md)
