# 収集・保存方式の調査と設計

2026年11月27日に公式ドキュメント、パッケージレジストリ、GitHub API を確認しました。前提は、複数の個人開発プロジェクト、常時稼働プロセスなし、DuckDB でのオンデマンド集計です。

## 採用した構成

ブラウザーと Node.js の Snowplow トラッカーから、共通の Cloudflare Worker に Snowplow TP2 の POST バッチを送ります。Worker はプロジェクト、リクエスト元、JSON Schema、時刻を検証し、書き込みを確認してから HTTP 204 を返します。プロジェクトの Origin とイベント定義は `events/projects.ts` に登録します。ブラウザー用とサーバー用の URL はプロジェクトごとに分かれています。

本番の基本構成では、Worker の Binding から Basin Pipelines に入れ、Zstandard 圧縮の Parquet を R2 に保存します。無料枠向けの構成では、Worker が受け取ったバッチを gzip 圧縮の NDJSON として R2 に置きます。DuckDB CLI は両形式を読み込み、NDJSON を Parquet にまとめることもできます。日常の指標は Solid v2 のダッシュボードで集計済み JSON を開きます。集計エンジンと R2 の認証情報は分析を行う端末に置きます。ローカルのダッシュボードは閲覧時に DuckDB で180日分を集計し、選択した期間だけを HTTP API で返します。グラフには Apache ECharts の折れ線・軸・ツールチップと Canvas 描画を使います。

    Snowplow browser tracker ─┐
                             ├─ Worker ─ Basin Pipelines ─ R2 Parquet ─┐
    Snowplow Node tracker ────┘          └─ R2 NDJSON (gzip) ─────────────┴─ DuckDB CLI ─ JSON ─ Solid v2

## トラッカー

GitHub のスター数と最終 push 日は 2026年11月27日取得です。3リポジトリともアーカイブされていません。依存関係は掲載バージョンの npm メタデータで確認しました。

| 候補 | スター・最終 push | ライセンスと依存関係 | 独自エンドポイントと判断 |
| --- | --- | --- | --- |
| Snowplow Browser / Node 4.10.3 | 593・11月7日 | BSD-3-Clause。Browser は browser-tracker-core、tracker-core、tslib。Node は tracker-core、tslib。コアは uuid を使用 | 両方とも独自ホストと POST パスを設定できます。セッション ID、イベント UUID、ローカルキュー、バッチ、再送を提供し、外部の設定配信を必要としません。採用しました。 |
| Segment Analytics Next 1.84.4 / Node 3.1.0 | 480・11月24日 | MIT。Browser の直接依存は11件で analytics-core、facade、js-cookie など。Node は6件で analytics-core、jose など | Browser は `apiHost` と同梱した `cdnSettings`、Node は `host` と `path` を指定できます。セッション ID を製品用途に揃える実装と、外部設定への通信を止める設定が必要です。 |
| RudderStack Analytics.js 3.36.1 | 181・11月27日 | MIT。公開 Browser パッケージの npm メタデータでは直接の `dependencies` はありません。設定に応じて追加モジュールが読み込まれます | 独自の Data Plane URL と、独自またはインラインのソース設定を指定できます。設定配信と送信先の互換動作を揃える範囲が広くなります。 |

[Snowplow リポジトリ](https://github.com/snowplow/snowplow-javascript-tracker)、[Browser 送信仕様](https://docs.snowplow.io/docs/sources/web-trackers/configuring-how-events-sent/)、[Node 初期化](https://docs.snowplow.io/docs/sources/node-js-tracker/initialization/)、[Segment リポジトリ](https://github.com/segmentio/analytics-next)、[Segment Browser のホスト設定](https://github.com/segmentio/analytics-next/tree/master/packages/browser#custom-cdn--api-proxy)、[Segment Node の設定](https://github.com/segmentio/analytics-next/blob/master/packages/node/src/app/settings.ts)、[RudderStack リポジトリ](https://github.com/rudderlabs/rudder-sdk-js)。

## イベント仕様

| 仕様 | 使える範囲と判断 |
| --- | --- |
| Snowplow | TP2 の発生時刻、イベント UUID、セッション、ユーザー ID と Iglu self-describing event を利用します。独自部分は各プロダクトのイベント、ID 紐付けイベント、実験イベント、および R2 の保存列です。 |
| Segment Spec | `Page`、`Track`、`Identify`、`Alias` と共通の `context` が揃っており、別のトラッカーから収集する際の候補です。本構成では Snowplow の送信形式をそのまま受けられます。 |
| Activity Schema | 顧客の活動を並べ、分析・モデリングを行うためのテーブル仕様です。ブラウザーの送信、セッション、再送の取り決めは別途必要です。 |
| OpenTelemetry Semantic Conventions | バックエンドのログや診断イベントで名前と属性を揃えられます。プロダクト分析用の匿名 ID 統合やブラウザートラッカーは別途必要です。 |

[Snowplow のイベントフィールド](https://docs.snowplow.io/docs/fundamentals/canonical-event/)、[Segment Spec](https://www.twilio.com/docs/segment/connections/spec)、[Activity Schema](https://activityschema.com/)、[OpenTelemetry のイベント規約](https://opentelemetry.io/docs/specs/semconv/general/events/)。

## 保存方式の比較

| 方式 | 運用と料金 | 判断 |
| --- | --- | --- |
| Basin Pipelines → R2 Parquet | Workers Paid が必要です。パイプラインがバッファー、Parquet 化、ファイル分割を行います。処理・書き出しはそれぞれ月50 GBまで込みです。 | 本番の基本構成です。 |
| Worker → R2 NDJSON gzip → DuckDB | Workers Free から開始できます。R2 は HTTP バッチごとに1オブジェクトなので、バッチが小さいと Class A と一覧取得が増えます。パックは CLI で実行します。 | 少量のプロジェクト向けです。 |
| Queues → R2 | メッセージの書き込み、取得、削除が通常3操作です。Free は日1万操作、Paid は月100万操作込みで、超過は100万操作あたり $0.40 です。Parquet コンシューマーと障害時の再処理が必要です。 | 書き出しを自前で制御する必要が生じた場合の候補です。 |
| D1 → R2 | Free は日10万書き込み行、Paid は月5,000万行込みで、超過は100万行あたり $1 です。インデックスも書き込みを消費し、R2 への定期エクスポートが必要です。 | 集計元の全イベントを保存すると DB 運用が増えます。 |
| Basin Catalog → Apache Iceberg | トランザクション、スナップショット、コンパクション、パーティション管理を利用できます。月100万カタログ操作と月10 GB・100万オブジェクトのコンパクション枠があります。 | 更新や複数エンジンでの協調が必要になった場合の候補です。 |

[Basin Pricing](https://developers.cloudflare.com/basin/platform/pricing/)、[Basin Pipelines Pricing](https://developers.cloudflare.com/basin-pipelines/platform/pricing/)、[R2 sink](https://developers.cloudflare.com/basin-pipelines/sinks/available-sinks/r2/)、[Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)、[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)。

## 保存と運用

- 受理したイベントは TP2 のレコード全体を `payload_json` に保持します。サンプリングと事前集計は行いません。受信後の重複も保存し、分析ではプロジェクトとイベント ID で除外します。バッチの一部が不正な場合は書き込み前にバッチ全体を HTTP 400 で拒否します。
- 基本構成は R2 の `events/v1/year=…/month=…/day=…/` です。Basin のロール目安は5分・64 MBです。日付パーティションは収集側の時刻なので、遅延到着は過去の日付の集計を変えます。イベント時刻と受信時刻を指標計算時に指定できます。
- 直接保存は `raw/v1/YYYY-MM-DD/APP_ID/` です。日次で同期・パックすると、DuckDB を繰り返し起動しても少数の Parquet を参照できます。パックは全行を保持し、出力ファイルを置き換えます。元ファイルを削除する操作は行いません。
- 保存列は固定し、プロパティの追加と型の変更は Iglu バージョンを追加して扱います。保存列を破壊的に変更する場合は別の主要バージョンのプレフィックスを使います。
- 試算の保持期間は180日です。R2 のライフサイクルでデータを保持期間の対象にできます。初回の収集前に、必要なリテンション期間を考慮して設定してください。個別ユーザーの削除は実装していません。
- ブラウザーの Origin 許可リストは CORS の許可先を制御します。ブラウザー経路は公開され、HTTP クライアントは Origin を偽装できます。分析権限とは独立した書き込み経路として扱います。認証や購入のような確定イベントはサーバー経由で送ってください。公開後に大量の不正リクエストが問題になる場合は Cloudflare のレート制限を検討してください。
- 収集結果の遅延は、SDK のバッファー、再送、Basin のロール間隔に左右されます。ブラウザーのストレージ拒否、強制終了、広告ブロッカー、通信切断では欠測が起きます。
- プロジェクトごとに ID とサーバー鍵を分けます。R2 の読み取り権限はバケット単位で付与するため、管理者を共有しないプロジェクトには別のバケットと Worker を用意してください。

[Cloudflare R2 ライフサイクル](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)、[Basin Stream Binding](https://developers.cloudflare.com/basin-pipelines/streams/writing-to-streams/)。

## 月額見積もり

| 月間イベント | POST 回数 | Basin 向け非圧縮データ | Basin + Parquet | R2 直接保存 |
| ---: | ---: | ---: | ---: | ---: |
| 10万 | 2.5万 | 0.12 GB | $5.00 | $0.00 |
| 100万 | 25万 | 1.2 GB | $5.00 | $0.00 |
| 1,000万 | 250万 | 12 GB | $5.00 | $9.26 |
| 1億 | 2,500万 | 120 GB | $18.10 | $131.70 |

金額は米ドル、税別です。平均4イベント/POST、2 ms CPU/POST、非圧縮1,200 B/イベント、Parquet 150 B/イベント、バッチ gzip 450 B/イベント、180日分を定常状態で保存すると仮定しました。Basin は `SELECT *` も SQL 処理量に含め、同じ非圧縮データ量を Parquet 書き出し料金にも使います。

Basin を使う場合、月1,000万イベントでは Parquet の定常保存量9 GBが R2 無料枠に収まります。月1億イベントでは Worker が $9.90、Basin が $7.00、R2 保存が $1.20 です。この試算では Basin 側の Class A を月10万回、Class B を月500万回としました。毎回 R2 の全履歴を読む使い方では、Class B が増えます。

直接保存は1 POSTにつき1 PUT、差分同期で1オブジェクトにつき1 GET、1,000件につき1 LIST を仮定しました。R2 Standard は月10 GB、Class A 100万回、Class B 1,000万回まで無料で、超過分は所定の単位で切り上げます。月1,000万イベントの直接保存は均等に到着し、追加の Worker 呼び出しが少ない場合には Workers Free の日10万リクエスト内です。ピーク時や CORS プリフライトが多い場合は日次上限に達します。

他の Worker と共有する枠、リトライ、OPTIONS、Workers Logs の超過、既存端末の費用は含めていません。圧縮率、リクエストあたりのイベント数、転送量は稼働後に計測してください。試算は `pnpm run cost` で再計算できます。

[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Basin Pipelines Pricing](https://developers.cloudflare.com/basin-pipelines/platform/pricing/)、[R2 Pricing](https://developers.cloudflare.com/r2/pricing/)。
