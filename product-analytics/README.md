# プロダクト分析基盤

Cloudflare Worker が Snowplow トラッカーのイベントを受け、R2 に保持します。DuckDB は必要なときに実行し、検証済みの SQL で集計します。Solid v2 のダッシュボードは日常的に確認する指標を表示します。

| 役割 | 実装 |
| --- | --- |
| プロダクトのフロント | `examples/browser.ts` と Solid v2 の収集デモ。ページ、SPA 遷移、カスタムイベント、実験を送信します。 |
| 収集と集計 | `collector/` の Worker、R2 直接保存、`analysis/` の DuckDB と SQL。 |
| ダッシュボード | `dashboard/` の Solid v2 アプリ。Apache ECharts で DAU・PV の日次推移と、流入元別セッションの日別件数・構成比を表示します。期間は直近7日・14日・30日・半年（180日）から選べ、日別 CSV をダウンロードできます。DAU と PV にはそれぞれ目標ラインを設定できます。Cloudflare Access で認証し、サーバー側の DuckDB が必要に応じて SQL を実行します。サーバーは結果を1時間キャッシュします。 |

## ローカルで開発する

```sh
pnpm install --frozen-lockfile
pnpm run demo:prepare
pnpm run build:dashboard
```

1つ目のターミナルで DuckDB のクエリサーバーを起動します。

```sh
ANALYTICS_DEV=1 ANALYTICS_APP=demo \
ANALYTICS_SOURCE=local-data/preview/events.parquet \
ANALYTICS_QUERY_TOKEN=local-dashboard-token-for-loopback-only \
pnpm run dashboard:query
```

別のターミナルで `pnpm run dashboard` を実行し、`http://127.0.0.1:5173/` を開きます。ローカル Worker が画面を配信し、本番と同じ経路でクエリサーバーへ転送します。SQL を保存したあとにページを再読み込みするか、「最新の集計を読む」を押すと反映されます。画面のコードを変更した場合は `pnpm run build:dashboard` を再実行します。

`pnpm run demo:prepare` が用意するのはサンプルイベントの NDJSON と Parquet です。集計 JSON を手元に保存する場合は、起動後に API へリクエストしてください。保存したレスポンスは「集計 JSON を開く」から読み込めます。

```sh
curl -fsS http://127.0.0.1:5173/api/dashboard/30 -o local-data/preview/dashboard-report.json
```

### ローカルで認証を確認する

ローカル Worker は `127.0.0.1` に限定し、ブラウザーの Cloudflare Access ログインを省略します。クエリサーバーはローカルでも Worker と共有する Bearer トークンを検証します。上のトークンはローカル設定専用です。

```sh
pnpm exec node --test tests/dashboard-access.test.ts tests/dashboard-query.test.ts
```

テストはローカルで署名した JWT を本番 Worker に渡し、認証後に許可された期間のレポートだけが DuckDB に届くことを確認します。Cloudflare Access の実際のログインと許可ポリシーは検証用ホストで確認してください。

[ダッシュボードの確認手順](docs/verify-dashboard.md) · [Cloudflare へのデプロイと Access 設定](docs/deploy.md)

## 自動テストを実行する

Node.js 22.18 以上と pnpm 12.22.0 を使用してください。ブラウザーの結合テストはインストール済みの Google Chrome を使用します。別の Chromium を使う場合は環境変数 `CHROME_BIN` に実行ファイルのパスを指定してください。

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:e2e
```

結合テストは、ブラウザーと Node.js の Snowplow トラッカーからローカル Worker に送信し、R2 エミュレーターから取得した原本を DuckDB で Parquet に変換します。再送、重複、ログイン連携、ファネル、実験、画面の更新、API レスポンスを保存した JSON の読み込みを確認します。結合テストはポート 5173 を使います。収集デモを手動で開く場合も、ダッシュボード用 Worker を停止し、`pnpm exec vite --host 127.0.0.1` と `pnpm run dev:collector` を起動して `http://127.0.0.1:5173/collector-demo.html` を開きます。

## 導入と分析

- [収集 Worker、R2、ダッシュボードのデプロイ](docs/deploy.md)
- [業務運用の手順、クラウド負荷計測、監視、復旧](docs/business-operations.md)
- [新しいアプリの登録、発火条件、Snowplow の送信設定](docs/events.md)
- [指標の定義と SQL の実行例](docs/metrics.md)
- [候補の比較、保存設計、月間10万〜1億イベントの費用](docs/design.md)
- [AI エージェント用の分析手順](SKILL.md)
