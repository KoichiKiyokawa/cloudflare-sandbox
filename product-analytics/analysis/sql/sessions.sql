SELECT session_id, user_key, started_at, last_event_at, duration_seconds, events, page_views,
       landing_url, referrer, utm_source, utm_medium, utm_campaign
FROM web_sessions, report_params
WHERE started_day >= start_date AND started_day < end_date
ORDER BY started_at, session_id;
