# 収集・保存方式の調査と設計

2026年11月27日に公式ドキュメント、パッケージレジストリ、GitHub API を確認しました。前提は、複数の個人開発プロジェクト、常時稼働プロセスなし、DuckDB でのオンデマンド集計です。

## 採用した構成

ブラウザーと Node.js の Snowplow トラッカーから、共通の Cloudflare Worker に Snowplow TP2 の POST バッチを送ります。Worker はプロジェクト、リクエスト元、JSON Schema、時刻を検証し、書き込みを確認してから HTTP 204 を返します。プロジェクトの Origin とイベント定義は `events/projects.ts` に登録します。ブラウザー用とサーバー用の URL はプロジェクトごとに分かれています。

収集 Worker は、受け取ったバッチを gzip 圧縮の NDJSON として非公開 R2 に保存します。Cron Trigger が原本を保持したまま UTC 受信日とアプリごとに Parquet にまとめます。DuckDB は完成した Parquet と未変換の原本を読みます。

ダッシュボードは Cloudflare Access で認証します。Worker は閲覧時にクエリサーバーへ集計結果を取りに行きます。クエリサーバーはキャッシュに有効な結果がないときに、リポジトリの既存 SQL で直近180日を集計します。判断基準にした時刻から1時間は結果を再利用します。DuckDB と R2 の読み取り認証情報はクエリサーバーに置きます。

    Snowplow → 収集 Worker → 非公開 R2 の原本
                                     ↑
    Solid v2 ← Access 搭載 Worker ← Node.js / DuckDB

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
| Basin Pipelines → R2 Parquet | Workers Paid が必要です。パイプラインがバッファー、Parquet 化、ファイル分割を行います。処理・書き出しはそれぞれ月50 GBまで込みです。 | 比較対象です。 |
| Worker → R2 NDJSON gzip → Parquet → DuckDB | R2 は HTTP バッチごとに原本を1オブジェクト保存し、Cron が複数バッチを Parquet にまとめます。変換には原本の読み取り料金と Parquet および対応表の書き込み料金がかかります。 | 採用構成です。 |
| Queues → R2 | メッセージの書き込み、取得、削除が通常3操作です。Free は日1万操作、Paid は月100万操作込みで、超過は100万操作あたり $0.40 です。Parquet コンシューマーと障害時の再処理が必要です。 | 書き出しを自前で制御する必要が生じた場合の候補です。 |
| D1 → R2 | Free は日10万書き込み行、Paid は月5,000万行込みで、超過は100万行あたり $1 です。インデックスも書き込みを消費し、R2 への定期エクスポートが必要です。 | 集計元の全イベントを保存すると DB 運用が増えます。 |
| Basin Catalog → Apache Iceberg | トランザクション、スナップショット、コンパクション、パーティション管理を利用できます。月100万カタログ操作と月10 GB・100万オブジェクトのコンパクション枠があります。 | 更新や複数エンジンでの協調が必要になった場合の候補です。 |

[Basin Pricing](https://developers.cloudflare.com/basin/platform/pricing/)、[Basin Pipelines Pricing](https://developers.cloudflare.com/basin-pipelines/platform/pricing/)、[R2 sink](https://developers.cloudflare.com/basin-pipelines/sinks/available-sinks/r2/)、[Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)、[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)。

## 保存と運用

- 受理したイベントは TP2 のレコード全体を `payload_json` に保持します。サンプリングと事前集計は行いません。受信後の重複も保存し、分析ではプロジェクトとイベント ID で除外します。バッチの一部が不正な場合は書き込み前にバッチ全体を HTTP 400 で拒否します。
- 遅延到着は過去の日付の集計を変えます。イベント時刻と受信時刻を指標計算時に指定できます。
- 原本は `raw/v1/YYYY-MM-DD/APP_ID/` に書き、ファイルキーは再利用しません。Worker は対象キーをその日の対応表に予約し、決まったキーへ Parquet を書きます。Parquet の出力を確認した後、R2 の条件付き書き込みで対応表を更新します。途中で中断した場合は予約した範囲を再開します。
- DuckDB は分析の開始時に対応表を読み、各原本の読み取り先を決めます。変換中の予約は読み替えに使わず、Parquet の一覧をそのまま集計対象にも使いません。すでに開始した分析は選んだ読み取り先を使い続けます。過去の日付に原本が追加された場合も、その原本は次回の分析で直接読めます。
- 保存列は固定し、プロパティの追加と型の変更は Iglu バージョンを追加して扱います。保存列を破壊的に変更する場合は別の主要バージョンのプレフィックスを使います。
- 試算の保持期間は180日です。R2 のライフサイクルでデータを保持期間の対象にできます。初回の収集前に、必要なリテンション期間を考慮して設定してください。個別ユーザーの削除は実装していません。
- ブラウザーの Origin 許可リストは CORS の許可先を制御します。ブラウザー経路は公開され、HTTP クライアントは Origin を偽装できます。分析権限とは独立した書き込み経路として扱います。認証や購入のような確定イベントはサーバー経由で送ってください。ブラウザー経路にはプロジェクト・接続元 IP ごとに Cloudflare のレート制限を適用し、超過時は HTTP 429 を返します。初期設定は1拠点で毎分600リクエストです。共有 IP の利用が多い場合は実トラフィックを確認して調整してください。
- 収集結果の遅延は、SDK のバッファーと再送に左右されます。ブラウザーのストレージ拒否、強制終了、広告ブロッカー、通信切断では欠測が起きます。
- プロジェクトごとに ID とサーバー鍵を分けます。R2 の読み取り権限はバケット単位で付与するため、管理者を共有しないプロジェクトには別のバケットと Worker を用意してください。

[Cloudflare R2 ライフサイクル](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)、[Basin Stream Binding](https://developers.cloudflare.com/basin-pipelines/streams/writing-to-streams/)。

## 収集と原本保存の月額見積もり

| 月間イベント | POST 回数 | Basin 向け非圧縮データ | Basin + Parquet（比較） | R2 直接保存（採用） |
| ---: | ---: | ---: | ---: | ---: |
| 10万 | 2.5万 | 0.12 GB | $5.00 | $0.00 |
| 100万 | 25万 | 1.2 GB | $5.00 | $0.00 |
| 1,000万 | 250万 | 12 GB | $5.00 | $9.26 |
| 1億 | 2,500万 | 120 GB | $18.10 | $131.70 |

金額は米ドル、税別です。平均4イベント/POST、2 ms CPU/POST、非圧縮1,200 B/イベント、Parquet 150 B/イベント、バッチ gzip 450 B/イベント、180日分を定常状態で保存すると仮定しました。Basin は `SELECT *` も SQL 処理量に含め、同じ非圧縮データ量を Parquet 書き出し料金にも使います。

Basin を使う場合、月1,000万イベントでは Parquet の定常保存量9 GBが R2 無料枠に収まります。月1億イベントでは Worker が $9.90、Basin が $7.00、R2 保存が $1.20 です。この試算では Basin 側の Class A を月10万回、Class B を月500万回としました。毎回 R2 の全履歴を読む使い方では、Class B が増えます。

直接保存は1 POSTにつき1 PUT、差分同期で1オブジェクトにつき1 GET、1,000件につき1 LIST を仮定しました。R2 Standard は月10 GB、Class A 100万回、Class B 1,000万回まで無料で、超過分は所定の単位で切り上げます。月1,000万イベントの直接保存は均等に到着し、追加の Worker 呼び出しが少ない場合には Workers Free の日10万リクエスト内です。ピーク時や CORS プリフライトが多い場合は日次上限に達します。

他の Worker と共有する枠、リトライ、OPTIONS、Workers Logs の超過は含めていません。自動変換の追加費用には Cron の CPU、巡回の LIST、Parquet と対応表の PUT、Parquet の保存容量が含まれます。クエリサーバーの利用料と、変換後の R2 読み取り数・処理時間は [業務運用の手順](business-operations.md) に沿って計測します。原本保存の試算は `pnpm run cost` で再計算できます。

[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Basin Pipelines Pricing](https://developers.cloudflare.com/basin-pipelines/platform/pricing/)、[R2 Pricing](https://developers.cloudflare.com/r2/pricing/)。
