CREATE TEMP MACRO local_day(t) AS
  CAST(timezone((SELECT time_zone FROM report_params), t) AS DATE);

CREATE TEMP MACRO utm_value(url, parameter) AS
  try(url_decode(replace(nullif(regexp_extract(
    regexp_extract(split_part(url, '#', 1), '[?](.*)', 1), '(^|&)' || parameter || '=([^&]*)', 2
  ), ''), '+', ' ')));

CREATE TEMP TABLE visible_events AS
WITH parsed AS (
  SELECT app_id, event_id, occurred_at::TIMESTAMPTZ AS occurred_at,
         received_at::TIMESTAMPTZ AS received_at, source, payload_json::JSON AS raw
  FROM stored_events
  WHERE app_id = (SELECT app_id FROM report_params)
    AND received_at::TIMESTAMPTZ <= (SELECT known_at FROM report_params)
),
eligible AS (
  SELECT * FROM parsed
  WHERE source = 'server' OR NOT coalesce(list_contains(
    (SELECT server_only_events FROM report_params),
    snowplow_custom_event_name(snowplow_custom_event(raw))
  ), false)
  QUALIFY row_number() OVER (
    PARTITION BY app_id, event_id ORDER BY received_at, source, raw::VARCHAR
  ) = 1
),
event_data AS (
  SELECT *, snowplow_event_index(raw) AS event_index,
         unnest(snowplow_event_fields(raw, snowplow_custom_event(raw)))
  FROM eligible
  WHERE occurred_at < (SELECT observed_until FROM report_params)
)
SELECT app_id, event_id, occurred_at, received_at, source, raw,
       claimed_user_id, anonymous_id, session_id, event_index, url, referrer, event_schema, event_name, properties,
       utm_value(url, 'utm_source') AS utm_source,
       utm_value(url, 'utm_medium') AS utm_medium,
       utm_value(url, 'utm_campaign') AS utm_campaign,
       utm_value(url, 'utm_content') AS utm_content,
       utm_value(url, 'utm_term') AS utm_term,
       is_identity_link
FROM event_data;

CREATE TEMP VIEW events AS
WITH trusted_links AS (
  SELECT DISTINCT properties->>'anonymous_id' AS anonymous_id, claimed_user_id AS known_user_id
  FROM visible_events
  WHERE source = 'server' AND is_identity_link
),
unambiguous_links AS (
  SELECT anonymous_id, min(known_user_id) AS known_user_id FROM trusted_links
  GROUP BY anonymous_id HAVING count(*) = 1
),
identified AS (
  SELECT e.*,
         CASE WHEN e.source = 'server' THEN e.claimed_user_id
              ELSE explicit_link.known_user_id END AS verified_user_id,
         inferred_link.known_user_id AS inferred_user_id
  FROM visible_events e
  LEFT JOIN trusted_links explicit_link
    ON e.anonymous_id = explicit_link.anonymous_id AND e.claimed_user_id = explicit_link.known_user_id
  LEFT JOIN unambiguous_links inferred_link ON inferred_link.anonymous_id = e.anonymous_id
)
SELECT * EXCLUDE(verified_user_id, inferred_user_id, is_identity_link),
       coalesce(verified_user_id, inferred_user_id) AS user_id,
       coalesce('u:' || coalesce(verified_user_id, inferred_user_id), 'a:' || anonymous_id) AS user_key,
       local_day(occurred_at) AS activity_day,
       event_name NOT IN ('identity_linked', 'experiment_assigned', 'experiment_exposed') AS is_active
FROM identified;

CREATE TEMP VIEW web_sessions AS
SELECT app_id, session_id,
       first(user_key ORDER BY occurred_at, event_index NULLS LAST, event_id) FILTER (WHERE user_key IS NOT NULL) AS user_key,
       min(occurred_at) AS started_at, max(occurred_at) AS last_event_at,
       local_day(min(occurred_at)) AS started_day,
       date_diff('millisecond', min(occurred_at), max(occurred_at)) / 1000.0 AS duration_seconds,
       count(*) AS events, count(*) FILTER (WHERE event_name = 'page_view') AS page_views,
       first(url ORDER BY (event_name = 'page_view') DESC, occurred_at, event_index NULLS LAST, event_id) AS landing_url,
       first(referrer ORDER BY (event_name = 'page_view') DESC, occurred_at, event_index NULLS LAST, event_id) AS referrer,
       first(utm_source ORDER BY (event_name = 'page_view') DESC, occurred_at, event_index NULLS LAST, event_id) AS utm_source,
       first(utm_medium ORDER BY (event_name = 'page_view') DESC, occurred_at, event_index NULLS LAST, event_id) AS utm_medium,
       first(utm_campaign ORDER BY (event_name = 'page_view') DESC, occurred_at, event_index NULLS LAST, event_id) AS utm_campaign
FROM events WHERE session_id IS NOT NULL AND is_active
GROUP BY app_id, session_id;

CREATE TEMP VIEW acquisition_sessions AS
SELECT started_day,
       coalesce(utm_source, nullif(regexp_extract(referrer, '^https?://([^/:?#]+)', 1), ''), '(direct)') AS source,
       utm_medium, utm_campaign, user_key, page_views
FROM web_sessions;
