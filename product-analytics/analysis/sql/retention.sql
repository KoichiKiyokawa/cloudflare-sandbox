WITH active_days AS (
  SELECT DISTINCT user_key, activity_day FROM events WHERE user_key IS NOT NULL AND is_active
),
cohort AS (
  SELECT user_key, min(activity_day) AS cohort_day FROM active_days GROUP BY user_key
),
results AS (
  SELECT cohort_day, day_offset, count(*) AS cohort_users,
         count(a.user_key) AS returned,
         cohort_day + day_offset < local_day(p.observed_until) AS eligible
  FROM cohort
  CROSS JOIN report_params p
  CROSS JOIN (VALUES (1), (2), (7), (30)) AS offsets(day_offset)
  LEFT JOIN active_days a ON a.user_key = cohort.user_key AND a.activity_day = cohort_day + day_offset
  WHERE cohort_day >= p.start_date AND cohort_day < least(p.end_date, local_day(p.observed_until))
  GROUP BY cohort_day, day_offset, eligible
)
SELECT cohort_day, day_offset, cohort_users, eligible,
       CASE WHEN eligible THEN returned END AS users,
       CASE WHEN eligible THEN returned::DOUBLE / cohort_users END AS rate
FROM results ORDER BY cohort_day, day_offset;
