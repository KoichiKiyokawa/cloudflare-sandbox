SELECT source, utm_medium, utm_campaign, count(*) AS sessions,
       count(DISTINCT user_key) AS users, sum(page_views)::BIGINT AS page_views
FROM acquisition_sessions, report_params
WHERE started_day >= start_date AND started_day < end_date
GROUP BY source, utm_medium, utm_campaign
ORDER BY sessions DESC, source, utm_medium, utm_campaign;
