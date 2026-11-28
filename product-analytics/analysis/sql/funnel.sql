WITH RECURSIVE
steps AS (
  SELECT unnest(steps) AS name, generate_subscripts(steps, 1) AS step
  FROM report_params
),
ordered AS MATERIALIZED (
  SELECT user_key, event_name, activity_day, occurred_at,
         row_number() OVER (PARTITION BY user_key ORDER BY occurred_at, session_id, event_index NULLS LAST, event_id) AS position
  FROM events, report_params
  WHERE user_key IS NOT NULL AND list_contains(steps, event_name)
    AND activity_day >= start_date
    AND occurred_at <= timezone(time_zone, end_date::TIMESTAMP) + to_seconds(window_seconds)
),
paths(user_key, step, position, started_at) AS (
  SELECT user_key, 1::BIGINT, position, occurred_at
  FROM ordered, report_params
  WHERE event_name = steps[1] AND activity_day < end_date
  UNION ALL
  SELECT paths.user_key, steps.step, next_step.position, paths.started_at
  FROM paths JOIN steps ON steps.step = paths.step + 1
  CROSS JOIN report_params p
  JOIN LATERAL (
    SELECT position
    FROM ordered e
    WHERE e.user_key = paths.user_key AND e.event_name = steps.name
      AND e.position > paths.position
      AND e.occurred_at <= paths.started_at + to_seconds(p.window_seconds)
    ORDER BY position LIMIT 1
  ) next_step ON true
),
counts AS (
  SELECT step, count(DISTINCT user_key) AS users FROM paths GROUP BY step
)
SELECT steps.step::INTEGER AS step, steps.name AS event_name, coalesce(counts.users, 0) AS users,
       coalesce(counts.users, 0)::DOUBLE / nullif(max(counts.users) OVER (), 0) AS rate_from_start
FROM steps LEFT JOIN counts USING (step) ORDER BY steps.step;
