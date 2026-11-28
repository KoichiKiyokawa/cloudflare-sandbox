CREATE TEMP MACRO snowplow_custom_event(packet) AS
  try_cast(packet->>'ue_pr' AS JSON)->'data';

CREATE TEMP MACRO snowplow_custom_event_name(custom_event) AS
  split_part(custom_event->>'schema', '/', 2);

CREATE TEMP MACRO snowplow_event_index(packet) AS (
  SELECT min(try_cast(value->'data'->>'eventIndex' AS BIGINT))
  FROM json_each(try_cast(packet->>'co' AS JSON)->'data')
  WHERE starts_with(value->>'schema', 'iglu:com.snowplowanalytics.snowplow/client_session/jsonschema/')
);

CREATE TEMP MACRO snowplow_event_fields(packet, custom_event) AS
  struct_pack(
    claimed_user_id := nullif(packet->>'uid', ''),
    anonymous_id := nullif(packet->>'duid', ''),
    session_id := nullif(packet->>'sid', ''),
    url := packet->>'url',
    referrer := packet->>'refr',
    event_schema := custom_event->>'schema',
    event_name := CASE WHEN packet->>'e' = 'pv' THEN 'page_view' ELSE snowplow_custom_event_name(custom_event) END,
    properties := coalesce(custom_event->'data', '{}'::JSON),
    is_identity_link := (custom_event->>'schema') = 'iglu:com.product_analytics/identity_linked/jsonschema/1-0-0'
  );
