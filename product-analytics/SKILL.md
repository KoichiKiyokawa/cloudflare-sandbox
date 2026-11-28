---
name: product-analytics
description: Analyze this repository's Snowplow product events with DuckDB. Use the checked-in SQL and metric definitions for DAU, engagement, funnels, retention, acquisition and experiments.
---

# プロダクト分析

1. プロジェクトのイベントは `events/projects.ts`、各 JSON Schema、[発火条件](docs/events.md) で確認してください。
2. 対象期間とタイムゾーンを確定し、`analysis/database.ts` の `openAnalysis()` に渡してください。標準指標は `report()` で集計します。再現に使えるよう `observedUntil` と `knownAt` を記録してください。レポート名と実行例は [指標定義](docs/metrics.md) にあります。
3. データは担当者が用意したローカル Parquet または読み取り権限のある R2 を参照してください。R2 の接続方法は [運用手順](docs/deploy.md) にあります。
4. 探索 SQL は `query()` で実行してください。プロジェクト選択、重複排除、ユーザー統合を適用した `events` を使います。日付範囲は SQL に明記してください。`stored_events` はデータの診断に使う原本で、プロジェクトを選ぶ前の全行を含みます。実行後は `finally` で接続を閉じてください。
5. 結果には対象期間、タイムゾーン、観測と受信の締め切り、対象イベントを添えてください。リテンションの未観測セルは空欄にします。可視化の入力には集計結果を使い、個別の ID は必要な場合だけ扱ってください。
