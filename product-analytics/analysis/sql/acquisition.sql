SELECT a.*
FROM report_params p, LATERAL acquisition_between(p.start_date, p.end_date) a
ORDER BY sessions DESC, source, utm_medium, utm_campaign;
