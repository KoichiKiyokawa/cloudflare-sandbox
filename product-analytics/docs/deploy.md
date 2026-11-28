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

R2 の読み取り鍵を設定した AWS CLI で、分析対象のデータを差分同期できます。ローカルへの同期後、受信日ごとに `pack` すると、繰り返しの集計で多数の小ファイルを開く時間を減らせます。

```sh
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws --region auto --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  s3 sync s3://product-analytics-raw/raw/v1/ local-data/raw

pnpm run analytics pack --source 'local-data/raw/2026-11-27/*/*.ndjson.gz' \
  --output local-data/parquet/2026-11-27.parquet
```

`pack` では元の受信日と同じ出力ファイルを使うと、受信日の途中で実行しても後から全件を再作成できます。同じ受信日をまとめるときは、その受信日の全アプリを入力に含めてください。空の受信日はスキップしてください。ローカルファイルにもバケットと同じデータ保持方針を適用してください。

## データ保持

R2 のライフサイクルは保存したオブジェクトの作成日から数えます。180日とする場合の設定例です。実行前に保存期間を確認してください。

```sh
pnpm exec wrangler r2 bucket lifecycle add product-analytics-raw expire-events raw/v1/ --expire-days 180
```

[R2 オブジェクトのライフサイクル](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。

## DuckDB から R2 を読む

R2 バケットを限定した読み取り専用の S3 API キーを発行し、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` を環境変数として渡します。DuckDB は初回に `httpfs` 拡張を取得するため、拡張配信元に接続できる環境が必要です。クエリの試行回数が多い場合はローカルの Parquet を使うと、R2 の読み取りを抑えられます。

```sh
pnpm run analytics active \
  --source 'r2://product-analytics-raw/raw/v1/**/*.ndjson.gz' \
  --app demo --from 2026-11-01 --to 2026-11-27
```

受信日ごとにまとめた Parquet を使う場合は、そのパスまたは R2 グロブを指定できます。移行中は `--source` を複数指定し、旧形式と新形式を同じレポートで扱えます。各グロブには最低1ファイルが必要です。R2 の一覧と読み取りができる資格情報を使います。探索 SQL は端末上で実行するため、信頼する SQL ファイルを渡してください。

[R2 S3 API](https://developers.cloudflare.com/r2/api/s3/)、[DuckDB の R2 対応](https://duckdb.org/docs/stable/core_extensions/httpfs/s3api.html)。

## DuckDB のクエリサーバーを起動する

既存の Node.js 実行環境で `pnpm install --frozen-lockfile` を実行し、次の環境変数をサービスに設定します。R2 用のキーには原本のバケットだけを許可してください。

| 環境変数 | 値 |
| --- | --- |
| `ANALYTICS_APP` | 集計対象のプロジェクト ID。例は `demo` です。 |
| `ANALYTICS_SOURCE` | 集計元の Parquet または gzip NDJSON。R2 グロブも指定できます。 |
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
