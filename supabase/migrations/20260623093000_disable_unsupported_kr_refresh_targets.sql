with unsupported_targets as (
  update public.stock_refresh_targets targets
  set instrument_type = 'UNSUPPORTED_KR_PRODUCT',
      enabled = false,
      tier = 'inactive',
      quote_interval_seconds = null,
      score_detail_interval_seconds = null,
      score_compare_interval_seconds = null,
      score_technical_interval_seconds = null,
      chart_interval_seconds = null,
      updated_at = now()
  where targets.market = 'KR'
    and targets.symbol !~ '^[0-9]{6}$'
  returning targets.market, targets.symbol
),
deleted_jobs as (
  delete from public.stock_refresh_jobs jobs
  using unsupported_targets targets
  where jobs.market = targets.market
    and jobs.symbol = targets.symbol
    and jobs.status in ('queued', 'running')
  returning jobs.id
)
delete from public.stock_quote_snapshots snapshots
using unsupported_targets targets
where snapshots.market = targets.market
  and snapshots.symbol = targets.symbol
  and snapshots.payload ->> 'error' = 'invalid_ticker';
