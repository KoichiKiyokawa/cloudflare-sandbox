WITH periods AS (
  SELECT list(struct_pack(period_start := start_date, period_end := end_date)) AS specs
  FROM report_params
)
SELECT a.* EXCLUDE (period_start, period_end)
FROM periods p, LATERAL acquisition_for_periods(p.specs) a
ORDER BY sessions DESC, source, utm_medium, utm_campaign;
