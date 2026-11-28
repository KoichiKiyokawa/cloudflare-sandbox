WITH scoped AS MATERIALIZED (
  SELECT * FROM acquisition_sessions_for_periods(?::JSON::STRUCT(period_start DATE, period_end DATE)[])
),
ranked AS (
  SELECT period_start, period_end, source, utm_medium, utm_campaign,
         count(*) AS sessions, count(DISTINCT user_key) AS users, sum(page_views)::BIGINT AS page_views,
         row_number() OVER (
           PARTITION BY period_start, period_end ORDER BY sessions DESC, source, utm_medium, utm_campaign
         )::INTEGER AS source_rank
  FROM scoped
  GROUP BY period_start, period_end, source, utm_medium, utm_campaign
  QUALIFY source_rank <= 8
)
SELECT period_start, period_end, NULL::DATE AS day, source_rank,
       source, utm_medium, utm_campaign, sessions, users, page_views
FROM ranked
UNION ALL
SELECT s.period_start, s.period_end, s.started_day AS day, r.source_rank,
       NULL, NULL, NULL, count(*) AS sessions, NULL, NULL
FROM scoped s
LEFT JOIN ranked r ON s.period_start = r.period_start AND s.period_end = r.period_end
  AND s.source = r.source AND s.utm_medium IS NOT DISTINCT FROM r.utm_medium
  AND s.utm_campaign IS NOT DISTINCT FROM r.utm_campaign
GROUP BY s.period_start, s.period_end, s.started_day, r.source_rank
ORDER BY period_start, period_end, day NULLS FIRST, source_rank NULLS LAST;
