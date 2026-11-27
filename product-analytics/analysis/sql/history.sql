SELECT occurred_at, received_at, event_id, event_name, event_schema, user_key, anonymous_id, session_id,
       source, url, referrer, properties
FROM events, report_params p
WHERE activity_day >= p.start_date AND activity_day < p.end_date
  AND (p.user_filter IS NULL OR user_key = p.user_filter)
ORDER BY occurred_at, session_id, event_index NULLS LAST, event_id;
