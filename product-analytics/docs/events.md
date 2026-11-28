# イベント定義とアプリの追加

アプリごとに `events/` に Iglu ID 付きの JSON Schema を置き、`events/projects.ts` にプロジェクト ID、許可する Origin、スキーマを登録してください。アプリのフロントとサーバーには同じプロジェクト ID を設定します。サーバー用の鍵は Worker Secret にだけ登録してください。収集・保存・SQL・ダッシュボードは同じ実装を使用できます。購入や契約確定などのイベント名は `serverOnlyEvents` に登録してください。収集 Worker がブラウザー送信を拒否し、DuckDB も過去のブラウザー送信を集計対象から除外します。

ブラウザートラッカーは `examples/browser.ts` の設定を参考に、アプリの起動時に一度初期化してください。SPA ではルーターが遷移を確定した後に `page()` を呼びます。初回表示は初期化後に一度送ります。画面名と URL が必要なら、パスにメールアドレス、認証トークンなどを含めず、必要な場合はルートのテンプレートを記録してください。サンプルは URL とリファラーのクエリから UTM 以外を除き、フラグメントを削除します。ハッシュルーターではルート名をタイトルとして渡せます。

## 発火条件

| 名前 | 送信元 | 発火条件 |
| --- | --- | --- |
| `page_view` | ブラウザー | ページの初回表示が確定したときと SPA 遷移が確定したときに一度ずつ送ります。Snowplow の `pv` を使用します。 |
| `pricing_opened` | デモのブラウザー | 料金画面を表示したときに `plan` とともに送ります。 |
| `purchase_completed` | デモのバックエンド | 購入が確定したときに `plan` と `amount` とともに送ります。同じ購入の再試行では同じイベント UUID を使います。 |
| `identity_linked` | バックエンド | アプリの認証が成功したときに、認証で得た不透明なアカウント ID を Snowplow の `uid`、ブラウザーの ID を `anonymous_id` として送ります。アプリ側のログイン API はブラウザーから受け取った値を認証済みセッションに紐付けてください。 |
| `experiment_assigned` | ブラウザーまたはバックエンド | 実験の割り当てを確定したときに `experiment_id` と `variant` を送ります。 |
| `experiment_exposed` | ブラウザーまたはバックエンド | 対象グループの画面や動作が利用者に実際に露出したときに、同じ `experiment_id` と `variant` を送ります。 |

`identity_linked` 用の匿名 ID はブラウザートラッカーの `anonymousId()` で取得できます。ログイン成功後はブラウザー側でも `login(userId)` を呼びます。ログアウトや別アカウントへの切り替えでは `logout()` でユーザーとセッションの ID を更新してください。バックエンドイベントをブラウザーのセッションに含める場合は、アプリ内で関連を確認して `sessionId` を渡してください。複数の端末の匿名 ID は、ログインイベントが届くたびに同じアカウントへ統合できます。

バックエンドの呼び出し例は `examples/server.ts` にあります。複数の利用者の状態を共有しないように、呼び出しごとにトラッカーを構成しています。短時間で終了するプロセスでは送信結果まで待ちます。プロセス終了を挟んでも再送が必要な購入イベントなどは、アプリのトランザクションや既存キューに UUID・発生日時・データを持たせ、送信失敗時に同じ内容を再送してください。

## HTTP とデータ保存

- ブラウザーは `POST /v1/browser/APP_ID`、バックエンドは `POST /v1/server/APP_ID` を使います。バックエンドは `Authorization: Bearer …` が必要です。SDK は `eventMethod: 'post'` と `encodeBase64: false` を指定します。
- 送信形式は Snowplow の `payload_data/jsonschema/1-0-4` です。ページビューは `pv`、任意イベントは Iglu self-describing の `ue` を使います。パスのプロジェクト ID と `aid` は一致させてください。イベント UUID は `eid`、日時は `ttm` があれば優先し、なければ `dtm` を使います。5分より未来のイベントを拒否します。過去への遅れに上限は設定していません。
- バッチの上限は100イベント、256 KiB です。受理は HTTP 204、認証・Origin・内容の不備は4xx、保存失敗は503です。バッチは全件検証した後に保存します。ブラウザーサンプルでは10イベント、20 KB、約5秒のいずれかで送信し、ページ離脱時は SDK のフラッシュと `keepalive` を使います。ブラウザーの POST は本文を TP2 JSON のまま `text/plain` で送り、CORS プリフライトの往復を省きます。失敗したイベントは最大1,000件までのキューに保持し、再送時もイベント UUID を維持します。
- 保存する列は `app_id`、`event_id`、`occurred_at`、`received_at`、`source`、`payload_json` です。最後の列に TP2 の元レコードを保持します。IP アドレスや HTTP ヘッダーは保存列に追加していません。トラッカーが送るブラウザー情報やプロパティは含まれます。メールアドレスなどを ID やイベントに使うかどうかは各アプリのデータ方針に従って決めてください。
- `events` ビューは Iglu ID とプロパティを展開します。スキーマ変更時に互換性のある形式を追加する場合は Iglu の修正番号や追加番号を上げます。意味やデータ型を変える場合は主要バージョンを上げ、SQL で変換を定義してください。遅延送信があるため、古いスキーマも送信元と再送キューが使い切るまで登録します。集計で使うイベント名はプロジェクト内で重複させないでください。

[Snowplow Tracker Protocol](https://docs.snowplow.io/docs/events/http-requests/)、[Web トラッカーの送信設定](https://docs.snowplow.io/docs/sources/web-trackers/configuring-how-events-sent/)、[Snowplow のセッション](https://docs.snowplow.io/docs/sources/web-trackers/tracking-events/session/)。
