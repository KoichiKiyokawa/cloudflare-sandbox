WITH experiment_events AS (
  SELECT user_key, activity_day, occurred_at, event_name, properties->>'variant' AS variant
  FROM events, report_params p
  WHERE event_name IN ('experiment_assigned', 'experiment_exposed') AND user_key IS NOT NULL
    AND properties->>'experiment_id' = p.experiment
),
assignments AS (
  SELECT variant, count(DISTINCT user_key) AS assigned_users
  FROM experiment_events, report_params p
  WHERE event_name = 'experiment_assigned' AND activity_day >= start_date AND activity_day < end_date
  GROUP BY variant
),
exposures AS (
  SELECT variant, user_key, min(occurred_at) AS exposed_at
  FROM experiment_events WHERE event_name = 'experiment_exposed'
  GROUP BY variant, user_key
),
variant_counts AS (
  SELECT user_key, count(*) AS variants FROM exposures GROUP BY user_key
),
outcomes AS (
  SELECT variant, count(*) FILTER (WHERE variants > 1) AS multi_variant_users,
         count(*) FILTER (WHERE variants = 1) AS exposed_users,
         count(*) FILTER (WHERE variants = 1 AND did_convert) AS converted_users
  FROM (
    SELECT x.*, v.variants, EXISTS (
      SELECT 1 FROM events e
      WHERE e.user_key = x.user_key AND e.event_name = p.conversion AND e.occurred_at > x.exposed_at
    ) AS did_convert
    FROM exposures x JOIN variant_counts v USING (user_key) CROSS JOIN report_params p
    WHERE local_day(exposed_at) >= start_date AND local_day(exposed_at) < end_date
  ) outcomes GROUP BY variant
)
SELECT variant, coalesce(assigned_users, 0) AS assigned_users, coalesce(exposed_users, 0) AS exposed_users,
       coalesce(converted_users, 0) AS converted_users, coalesce(multi_variant_users, 0) AS multi_variant_users,
       converted_users::DOUBLE / nullif(exposed_users, 0) AS conversion_rate
FROM assignments FULL OUTER JOIN outcomes USING (variant) ORDER BY variant;
