# デプロイと運用

以下のコマンドは `product-analytics` ディレクトリで実行してください。収集用 Worker と閲覧用ダッシュボードは別のホスト名にします。初回はアプリの Origin とイベントを `events/projects.ts` に登録し、`pnpm install --frozen-lockfile` と `pnpm exec wrangler login` を実行してください。

## 収集 Worker と R2 をデプロイする

以下のコマンドは `wrangler.jsonc` の R2 Binding を使います。別のバケット名を使う場合は設定ファイル内の名前も変更してください。同じ名前の Worker をデプロイすると、使用する保存先が切り替わります。

```sh
pnpm exec wrangler r2 bucket create product-analytics-raw
pnpm exec wrangler secret put SERVER_TOKENS
pnpm exec wrangler deploy
```

`SERVER_TOKENS` はアプリ ID をキーとする JSON オブジェクトです。アプリごとに異なる24文字以上の乱数を使い、同じ値をバックエンドに設定します。デプロイ先の収集 Worker URL を Snowplow トラッカーの `collectorOrigin` に設定します。フロントとバックエンドから各1バッチを送り、HTTP 204 と R2 への保存を確認します。

## Parquet への自動変換を確認する

収集 Worker の Cron Trigger が、R2 の gzip NDJSON を UTC 受信日とアプリごとにまとめ、同じバケットの `parquet/v1/` に書きます。通常の運用で端末への同期は不要です。Parquet は元のイベントを全列保持します。

設定例は UTC の毎正時に実行します。Cloudflare Workers Paid では1時間以上の間隔にすると Cron に適用される CPU の上限が長くなります。Free の Cron の CPU 枠は10 msなので、業務運用では Paid で実測してください。変換前のイベントもその場で読めるため、この実行間隔はダッシュボードのキャッシュ期限と独立しています。当日の原本は直接読み続け、UTC の日付が変わってからまとめます。これにより、受信量の少ない時間帯ごとに小さな Parquet が増えるのを抑えます。1回に前日と過去分の巡回を各1ページ進めます。1ページは最大1,000オブジェクトです。受信量がこの処理量を超える環境や既存データが多い環境では、巡回時間と未変換分の読み取り負荷を計測してください。

デプロイ後にイベントを送り、Cron の実行結果と `parquet_compaction` ログを見ます。変換結果とその対象を記録する `manifest.json` が R2 に保存されます。変換途中の原本は DuckDB がそのまま参照し、次の Cron が処理を再開します。プレビューでは [Wrangler の手順](https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers) に沿ってスケジュールを実行できます。

## データ保持

R2 のライフサイクルは保存したオブジェクトの作成日から数えます。180日とする場合の設定例です。実行前に保存期間を確認してください。

```sh
pnpm exec wrangler r2 bucket lifecycle add product-analytics-raw expire-events raw/v1/ --expire-days 180
```

[R2 オブジェクトのライフサイクル](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。

Parquet と対応表は後から作られるため、原本だけにライフサイクルを設定してもイベントの保存期限は揃いません。原本の受信日を基準に削除する場合は、期限を過ぎた受信日の `raw/v1/` と `parquet/v1/` の両方が対象です。対応表が参照する Parquet に、単独で先に失効するルールを設定しないでください。

## DuckDB から R2 を読む

R2 バケットを限定した読み取り専用の S3 API キーを発行し、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` を環境変数として渡します。DuckDB は初回に `httpfs` 拡張を取得するため、拡張配信元に接続できる環境が必要です。クエリの試行回数が多い場合はローカルの Parquet を使うと、R2 の読み取りを抑えられます。

クエリサーバーの `ANALYTICS_SOURCE` や `openAnalysis()` の入力には、バケットのルート `r2://product-analytics-raw` を指定します。DuckDB は対応表を読み、確定済みの Parquet と、どの Parquet にも含まれていない原本を選びます。Parquet の設定を調査するときは `r2://product-analytics-raw/raw/v1/**/*.ndjson.gz` で原本だけを参照できます。端末から SQL を実行する例は [指標の定義](metrics.md#実行例) を参照してください。

[R2 S3 API](https://developers.cloudflare.com/r2/api/s3/)、[DuckDB の R2 対応](https://duckdb.org/docs/stable/core_extensions/httpfs/s3api.html)。

## DuckDB のクエリサーバーを起動する

既存の Node.js 実行環境で `pnpm install --frozen-lockfile` を実行し、次の環境変数をサービスに設定します。R2 用のキーには原本のバケットだけを許可してください。

| 環境変数 | 値 |
| --- | --- |
| `ANALYTICS_APP` | 集計対象のプロジェクト ID。例は `demo` です。 |
| `ANALYTICS_SOURCE` | 本番は R2 バケットのルート `r2://product-analytics-raw`。ローカルの Parquet、gzip NDJSON、R2 グロブを直接指定することもできます。 |
| `ANALYTICS_QUERY_TOKEN` | Worker と共有する32文字以上の乱数。 |
| `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` | R2 を読む場合の読み取り専用認証情報。 |
| `ANALYTICS_TIME_ZONE` | 暦日集計のタイムゾーン。既定は `Asia/Tokyo` です。 |
| `ANALYTICS_MAX_INGEST_LAG_HOURS` | 指定時に、集計対象の最終受信から許容する時間。 |
| `ANALYTICS_QUERY_TIMEOUT_MS` | 指定時に、クエリを中止するまでのミリ秒。 |

```sh
pnpm run dashboard:query
```

サーバーは既定で `127.0.0.1:8080` で待ち受けます。既存の HTTPS リバースプロキシなどを使い、Worker から `https://query.example.com` へアクセスできるようにします。クエリサーバーは `/api/dashboard/{7,14,30,180}` の認証済み GET と HEAD を受け付けます。SQL・対象アプリ・データ源・日付の基準はサーバー側で決めます。

## ダッシュボードをデプロイする

1. ダッシュボード専用ホスト名を Cloudflare Access の自社管理アプリに登録し、閲覧を許可するユーザーの Allow ポリシーを設定します。Application Audience (AUD) とチーム URL を控えます。
2. Worker のシークレットファイルにクエリサーバーと同じ `ANALYTICS_QUERY_TOKEN` を格納します。JSON または dotenv 形式にし、リポジトリ外に置きます。

```sh
ANALYTICS_ACCESS_TEAM=https://example.cloudflareaccess.com \
ANALYTICS_ACCESS_AUDIENCE="$ACCESS_APP_AUD" \
ANALYTICS_QUERY_URL=https://query.example.com \
node dashboard/deploy-config.ts analytics.example.com demo
pnpm run build:dashboard
pnpm exec wrangler deploy --config wrangler.dashboard.generated.json --secrets-file "$ANALYTICS_SECRETS_FILE"
```

許可したアカウントで画面と `/api/dashboard/30` を開き、未ログインのブラウザーで同じ URL を開いて Access の認証を確認します。Worker は JWT の署名・発行元・AUD・期限を検証し、クエリサーバーへ共有トークンを添えて取得を依頼します。

クエリサーバーは最初のリクエストと有効期限後の最初のリクエストで SQL を実行します。期間ごとに、集計の基準時刻から1時間は同じ結果を再利用します。同時に到着したリクエストは1件の集計を共有します。画面からの再取得はサーバーが返す有効期限に従います。プロセスを再起動すると次のリクエストで再計算します。

[Cloudflare Access の自社管理アプリ](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [業務運用と計測](business-operations.md)
