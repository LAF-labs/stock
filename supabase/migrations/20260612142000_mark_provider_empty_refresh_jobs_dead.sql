update public.stock_refresh_jobs
set status = 'dead',
    locked_by = null,
    locked_at = null,
    locked_until = null,
    completed_at = now(),
    last_error = left('provider_confirmed_empty: ' || coalesce(last_error, 'provider returned no data'), 1000),
    updated_at = now()
where status in ('queued', 'running')
  and (status = 'queued' or coalesce(locked_until, locked_at + interval '15 minutes') <= now())
  and last_error is not null
  and not (
    lower(last_error) like '%fetch failed%'
    or lower(last_error) like '%rate limit%'
    or lower(last_error) like '%rate_limited%'
    or lower(last_error) like '%timeout%'
    or lower(last_error) like '%timed out%'
    or lower(last_error) like '%token_failed%'
    or lower(last_error) like '%expired token%'
    or lower(last_error) like '%http 500%'
    or lower(last_error) like '%http 502%'
    or lower(last_error) like '%http 503%'
    or lower(last_error) like '%http 504%'
  )
  and (
    lower(last_error) like '%kis_not_found%'
    or lower(last_error) like '%no data found%'
    or lower(last_error) like '%symbol may be delisted%'
    or lower(last_error) like '%possibly delisted%'
    or lower(last_error) like '%empty price%'
    or lower(last_error) like '%empty daily chart%'
    or lower(last_error) like '%daily chart was not found%'
    or lower(last_error) like '%chart_series_missing%'
    or lower(last_error) like '%no price data found%'
    or lower(last_error) like '%not found%'
    or lower(last_error) like '%http 404%'
  );
