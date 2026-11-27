WITH days AS (
  SELECT day::DATE AS day FROM report_params,
    generate_series(start_date, least(end_date, local_day(observed_until)) - 1, INTERVAL 1 DAY) AS t(day)
),
activity AS (
  SELECT activity_day, user_key, count(*) FILTER (WHERE event_name = 'page_view') AS page_views
  FROM events, report_params
  WHERE is_active AND activity_day >= start_date - 29 AND activity_day < end_date
  GROUP BY activity_day, user_key
)
SELECT day,
       count(DISTINCT user_key) FILTER (WHERE activity_day = day) AS dau,
       count(DISTINCT user_key) FILTER (WHERE activity_day >= day - 6) AS wau,
       count(DISTINCT user_key) AS mau,
       coalesce(sum(page_views) FILTER (WHERE activity_day = day), 0)::BIGINT AS page_views,
       count(DISTINCT user_key) FILTER (WHERE activity_day = day AND page_views > 0) AS page_users
FROM days LEFT JOIN activity ON activity_day BETWEEN day - 29 AND day
GROUP BY day ORDER BY day;
