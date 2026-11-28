WITH scoped AS MATERIALIZED (
  SELECT a.* FROM acquisition_sessions a, report_params
  WHERE started_day >= start_date AND started_day < least(end_date, local_day(observed_until))
),
ranked AS (
  SELECT source, utm_medium, utm_campaign,
         count(*) AS sessions, count(DISTINCT user_key) AS users, sum(page_views)::BIGINT AS page_views,
         row_number() OVER (ORDER BY sessions DESC, source, utm_medium, utm_campaign)::INTEGER AS source_rank
  FROM scoped
  GROUP BY source, utm_medium, utm_campaign
  QUALIFY source_rank <= 8
)
SELECT NULL::DATE AS day, source_rank,
       source, utm_medium, utm_campaign, sessions, users, page_views
FROM ranked
UNION ALL
SELECT s.started_day AS day, r.source_rank,
       NULL, NULL, NULL, count(*) AS sessions, NULL, NULL
FROM scoped s
LEFT JOIN ranked r ON s.source = r.source AND s.utm_medium IS NOT DISTINCT FROM r.utm_medium
  AND s.utm_campaign IS NOT DISTINCT FROM r.utm_campaign
GROUP BY s.started_day, r.source_rank
ORDER BY day NULLS FIRST, source_rank NULLS LAST;
