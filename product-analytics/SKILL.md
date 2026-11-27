---
name: product-analytics
description: Analyze this repository's Snowplow product events with the DuckDB CLI. Use the checked-in metric definitions for DAU, engagement, funnels, retention, acquisition and experiments.
---

# プロダクト分析

1. プロジェクトのイベントは `events/projects.ts`、各 JSON Schema、[発火条件](docs/events.md) で確認してください。
2. 時間範囲とタイムゾーンを確定し、[指標定義](docs/metrics.md) にある既存の CLI コマンドを使ってください。指標名を維持したまま計算方法を変えないでください。再現できる分析では `--observed-until` と `--known-at` を指定してください。
3. データは担当者が用意したローカル Parquet または読み取り権限のある R2 を参照してください。R2 の接続方法は [運用手順](docs/deploy.md) にあります。
4. 探索 SQL はファイルに置き、`pnpm run analytics query --sql-file FILE --source PATH --app ID --from DATE --to DATE --tz ZONE` を実行してください。プロジェクト、重複、ユーザー統合を適用した `events` を使います。日付範囲は SQL に明記してください。`stored_events` はデータの診断に使う原本で、プロジェクトを選ぶ前の全行を含みます。
5. 結果には対象期間、タイムゾーン、観測と受信の締め切り、対象イベントを添えてください。リテンションの未観測セルは空欄にします。可視化の入力には集計結果を使い、個別の ID は必要な場合だけ扱ってください。
