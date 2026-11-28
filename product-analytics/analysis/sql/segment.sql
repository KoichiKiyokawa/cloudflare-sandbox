SELECT coalesce(json_extract(properties, p.property_path)::VARCHAR, '(missing)') AS segment,
       count(*) AS events, count(DISTINCT user_key) AS users
FROM events, report_params p
WHERE activity_day >= p.start_date AND activity_day < p.end_date
  AND (p.event_filter IS NULL OR event_name = p.event_filter)
GROUP BY segment ORDER BY events DESC, segment;
