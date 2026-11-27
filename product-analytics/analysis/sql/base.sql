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
  QUALIFY row_number() OVER (
    PARTITION BY app_id, event_id ORDER BY received_at::TIMESTAMPTZ, source, payload_json
  ) = 1
),
wire AS (
  SELECT *, try_cast(raw->>'ue_pr' AS JSON) AS unstructured,
         try_cast(raw->>'co' AS JSON) AS contexts
  FROM parsed
  WHERE occurred_at < (SELECT observed_until FROM report_params)
),
event_data AS (
  SELECT *, raw->>'uid' AS claimed_user_id, raw->>'duid' AS anonymous_id,
         raw->>'sid' AS session_id, raw->>'url' AS url, raw->>'refr' AS referrer,
         unstructured->'data'->>'schema' AS event_schema,
         unstructured->'data'->'data' AS properties,
         (SELECT min(try_cast(value->'data'->>'eventIndex' AS BIGINT))
          FROM json_each(contexts->'data')
          WHERE starts_with(value->>'schema', 'iglu:com.snowplowanalytics.snowplow/client_session/jsonschema/')) AS event_index
  FROM wire
)
SELECT app_id, event_id, occurred_at, received_at, source, raw,
       nullif(claimed_user_id, '') AS claimed_user_id, nullif(anonymous_id, '') AS anonymous_id,
       nullif(session_id, '') AS session_id, event_index, url, referrer, event_schema,
       CASE WHEN raw->>'e' = 'pv' THEN 'page_view' ELSE split_part(event_schema, '/', 2) END AS event_name,
       coalesce(properties, '{}'::JSON) AS properties,
       utm_value(url, 'utm_source') AS utm_source,
       utm_value(url, 'utm_medium') AS utm_medium,
       utm_value(url, 'utm_campaign') AS utm_campaign,
       utm_value(url, 'utm_content') AS utm_content,
       utm_value(url, 'utm_term') AS utm_term
FROM event_data;

CREATE TEMP VIEW events AS
WITH trusted_links AS (
  SELECT DISTINCT properties->>'anonymous_id' AS anonymous_id, claimed_user_id AS known_user_id
  FROM visible_events
  WHERE source = 'server'
    AND event_schema = 'iglu:com.product_analytics/identity_linked/jsonschema/1-0-0'
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
SELECT * EXCLUDE(verified_user_id, inferred_user_id),
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

CREATE TEMP MACRO acquisition_between(period_start, period_end) AS TABLE
WITH acquisition AS (
  SELECT coalesce(utm_source, nullif(regexp_extract(referrer, '^https?://([^/:?#]+)', 1), ''), '(direct)') AS source,
         utm_medium, utm_campaign, user_key, page_views
  FROM web_sessions
  WHERE started_day >= period_start AND started_day < period_end
)
SELECT source, utm_medium, utm_campaign, count(*) AS sessions,
       count(DISTINCT user_key) AS users, sum(page_views)::BIGINT AS page_views
FROM acquisition GROUP BY source, utm_medium, utm_campaign;
