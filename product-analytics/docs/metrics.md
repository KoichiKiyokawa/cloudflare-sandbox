# DuckDB の指標定義

Snowplow のフィールドは `analysis/sql/snowplow.sql` で解析用の列に変換します。すべての検証済みレポートは `analysis/sql/base.sql` の `events` ビューを参照します。各 SQL は `analysis/sql/` にあります。

## 共通条件

`openAnalysis()` に渡す `ReportOptions` で集計条件を指定します。

- `app` は1プロジェクトを選びます。`from` と `to` は `timeZone` のローカル日付です。開始日は含め、終了日は含めません。既定のタイムゾーンは `Asia/Tokyo` です。
- `observedUntil` は発生時刻の上限で、境界は含めません。`knownAt` は受信時刻の上限で、境界を含めます。既定は両方とも CLI の起動時刻です。再現する場合は両方を固定してください。
- 同一のプロジェクト・イベント UUID は、受信順で最初の1件を使います。完全に同じ受信時刻のタイは送信元と元 JSON で決めます。イベント順は発生時刻、同時刻ならセッション ID、Snowplow セッション内のイベント番号、イベント UUID で決めます。別のセッション同士で同時刻の場合、タイの順序は再現用です。
- 認証済みサーバーの `uid` をアカウント ID とします。ブラウザーの `uid` は、サーバーのリンクと匿名 ID の組み合わせが一致するときに使います。1つのアカウントにだけリンクされた匿名 ID には、ログイン前の行動も含め同じ `u:ACCOUNT` を割り当てます。複数アカウントとのリンクがある場合は、明示的に突き合わせられない行を `a:ANONYMOUS_ID` として扱います。ID が両方欠ける場合は PV とイベント総数に含め、ユーザー数には含めません。
- アクティブイベントはページビューとアプリ固有イベントです。ID 紐付けと実験の割り当て・露出はアクティブ判定から外します。元データを保持している範囲が、履歴と統合に使える範囲です。

## レポート

| レポート名 | 定義 |
| --- | --- |
| `active` | 日付ごとにアクティブな `user_key` を数えます。DAU は当日、WAU は当日を含む直近7暦日、MAU は30暦日です。PV は当日のページビュー数、閲覧者は当日のページビューに付いたユニークな `user_key` 数です。観測が終了した日だけを出力し、該当イベントのない日は0です。 |
| `funnel` | 期間内に第1イベントが発生した各利用者を起点とし、指定した順にイベントを探します。最初のイベントから `windowSeconds` 以内で、期限と同時刻の変換を含めます。各開始イベントを起点に試行でき、イベントは1ステップにだけ使います。後続イベントは `to` 以降でも観測上限まで数えます。ステップの人数はユニークユーザー数です。期間末尾の開始者に全期限を与える場合は、観測時刻を終了日から期限以上先に設定してください。 |
| `retention` | 保存範囲で初めてアクティブになった日のコホートを作り、ちょうど1・2・7・30暦日後にアクティブだった割合を出力します。対象日の終了を観測できていないときは `eligible=false`、人数と割合は `null` です。最古のデータに接するコホートは、収集開始前や保持期間外に既に活動していた利用者を含み得ます。 |
| `history` | 期間内のイベント履歴を順序付けて表示します。`user` は `u:login-id` または `a:匿名ID` で指定します。 |
| `sessions` | プロジェクト・Snowplow セッション ID ごとにアクティブイベントをまとめます。開始日が期間内のセッションを数え、継続時間は最後の観測イベントまでです。最後のイベント後にページを開いていた時間は計測の対象外です。 |
| `acquisition` | 同じセッション集計から、最初のページビューの UTM source、リファラーのホスト、直接流入の順で流入元を決めます。ページビューがないときは最初のアクティブイベントを使います。集計は source、medium、campaign ごとです。同じ利用者が複数グループに出るため、利用者数はグループ間で加算できません。 |
| `segment` | `event` でイベントを絞り、`propertyPath` の DuckDB JSON Path でプロパティの値ごとにイベント数とユニーク人数を数えます。JSON の型を保持し、欠損は `(missing)` です。 |
| `experiment` | 実験 ID・variant ごとに、期間内の割り当て人数と初回露出人数を集計します。露出後に変換イベントが発生した人を観測上限まで数えます。複数 variant に露出した利用者は `multi_variant_users` に計上し、各群の露出・変換率から外します。露出がない群の率は `null` です。 |

ダッシュボードの流入元グラフは、セッションを開始したローカル日付ごとに集計します。各日の構成比は、その日の全セッション数を分母にします。凡例の構成比は、選択期間全体の全セッション数を分母にします。選択期間の上位8グループを個別に表示し、残りは「その他」にまとめます。

## 実行例

リポジトリの `product-analytics` ディレクトリで実行します。次の例は `pnpm run demo:prepare` で作った Parquet を読み、標準の DAU・WAU・MAU・PV を集計します。

```sh
pnpm exec node --input-type=module <<'JS'
import { openAnalysis, query, report } from './analysis/database.ts';

const db = await openAnalysis(['local-data/preview/events.parquet'], {
  app: 'demo',
  from: '2026-11-01',
  to: '2026-11-27',
  timeZone: 'Asia/Tokyo',
  observedUntil: '2026-11-27T00:00:00+09:00',
  knownAt: '2026-11-28T00:00:00+09:00',
});
try {
  console.table(await report(db, 'active'));
  console.table(await query(db, `
    SELECT event_name, count(*) AS events
    FROM events, report_params
    WHERE activity_day >= start_date AND activity_day < end_date
    GROUP BY event_name
    ORDER BY events DESC
  `));
} finally {
  db.close();
}
JS
```

`report()` のレポート名に対応する SQL は `analysis/sql/` にあります。ファネルでは `steps` と `windowSeconds`、実験では `experiment` と `conversion` を `openAnalysis()` に渡します。探索 SQL には `query()` を使います。`events` ビューには発生・受信の上限とプロジェクトの選択が適用されます。標準レポートと同じ日付範囲で絞るには `report_params.start_date` と `end_date` を使います。64 bit 整数は DuckDB Node API が文字列で返す場合があります。
