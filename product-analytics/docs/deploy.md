# デプロイと日次更新

以下のコマンドは `product-analytics` ディレクトリで実行してください。収集用 Worker と閲覧用ダッシュボードは別のホスト名にします。初回はアプリの Origin とイベントを `events/projects.ts` に登録し、`pnpm install --frozen-lockfile` と `pnpm exec wrangler login` を実行してください。

## Basin と R2 Parquet

Workers Paid を有効にしてから、R2 バケット、Stream、Parquet Sink、Pipeline を順に作成します。Stream の HTTP エンドポイントは停止し、検証を行う収集 Worker から Binding で書き込みます。

```sh
pnpm exec wrangler r2 bucket create product-analytics-events
pnpm exec wrangler basin pipelines streams create product_analytics_stream \
  --schema-file collector/basin-schema.json --no-http-enabled
pnpm exec wrangler basin pipelines sinks create product_analytics_sink \
  --type r2 --bucket product-analytics-events --format parquet --compression zstd \
  --path events/v1 --partitioning 'year=%Y/month=%m/day=%d' --roll-size 64 --roll-interval 300
pnpm exec wrangler basin pipelines create product_analytics_pipe --sql-file collector/basin.sql
```

Sink 作成時に Wrangler が R2 の書き込み認証情報を生成できる権限を用意してください。Stream の出力に表示された ID を `wrangler.production.jsonc` の `stream` に入れます。

```sh
cp wrangler.production.example.jsonc wrangler.production.jsonc
pnpm exec wrangler deploy --config wrangler.production.jsonc --dry-run
pnpm exec wrangler secret put SERVER_TOKENS --config wrangler.production.jsonc
pnpm exec wrangler deploy --config wrangler.production.jsonc
```

`SERVER_TOKENS` の値は `{"your-project":"…","another-project":"…"}` の形式です。アプリごとに異なる24文字以上の値を安全な乱数で生成し、アプリのバックエンドにも設定してください。`openssl rand -hex 32` で生成できます。デプロイ先の Worker URL をトラッカーの `collectorOrigin` に設定します。

初回は許可済み Origin のフロントから1バッチ、正式な鍵を持つバックエンドから1バッチを送り、HTTP 204 を確認します。ロール後に R2 の `events/v1/` に Parquet が現れることと、次の CLI で該当プロジェクトを集計できることを確認してください。

[Basin Stream 管理](https://developers.cloudflare.com/basin-pipelines/streams/manage-streams/)、[Basin R2 Sink](https://developers.cloudflare.com/basin-pipelines/sinks/available-sinks/r2/)、[Basin 入門](https://developers.cloudflare.com/basin-pipelines/getting-started/)。

## 少量の R2 直接保存

以下のコマンドは `wrangler.jsonc` の R2 Binding を使います。別のバケット名を使う場合は設定ファイル内の名前も変更してください。同じ名前の Worker をデプロイすると、使用する保存先が切り替わります。

```sh
pnpm exec wrangler r2 bucket create product-analytics-raw
pnpm exec wrangler secret put SERVER_TOKENS
pnpm exec wrangler deploy
```

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
pnpm exec wrangler r2 bucket lifecycle add product-analytics-events expire-events events/v1/ --expire-days 180
pnpm exec wrangler r2 bucket lifecycle add product-analytics-raw expire-events raw/v1/ --expire-days 180
```

[R2 オブジェクトのライフサイクル](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。

## DuckDB から R2 を読む

R2 バケットを限定した読み取り専用の S3 API キーを発行し、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` を環境変数として渡します。DuckDB は初回に `httpfs` 拡張を取得するため、拡張配信元に接続できる環境が必要です。クエリの試行回数が多い場合はローカルの Parquet を使うと、R2 の読み取りを抑えられます。

```sh
pnpm run analytics active \
  --source 'r2://product-analytics-events/events/v1/**/*.parquet' \
  --app demo --from 2026-11-01 --to 2026-11-27
```

Basin を使わない場合は、例えば `r2://product-analytics-raw/raw/v1/**/*.ndjson.gz` を指定できます。移行中は `--source` を複数指定し、旧形式と新形式を同じレポートで扱えます。各グロブには最低1ファイルが必要です。R2 の一覧と読み取りができる資格情報を使います。探索 SQL は端末上で実行するため、信頼する SQL ファイルを渡してください。

[R2 S3 API](https://developers.cloudflare.com/r2/api/s3/)、[DuckDB の R2 対応](https://duckdb.org/docs/stable/core_extensions/httpfs/s3api.html)。

## ダッシュボードを実行する

ローカルで `pnpm run demo:prepare` を実行し、`pnpm run dashboard` を起動してください。最初の API リクエストで DuckDB がサンプル Parquet を集計します。サーバーは180日分の集計結果を同じプロセスのメモリーに1時間保持し、複数のリクエストが同時に来た場合は一つの集計結果を共有します。

ブラウザーが取得するのは、選択した期間の集計結果です。たとえば初期表示では `GET /api/dashboard?days=30` を使います。レスポンスの `Cache-Control: private, max-age=60` でブラウザーに最長60秒保持されます。再検証時の `If-None-Match` が現在の `ETag` と一致すると、本文なしの HTTP 304 を返します。

HTTP API はローカルの試作です。上のクラウド向けコマンドは収集 Worker と R2 への保存を対象にしています。
