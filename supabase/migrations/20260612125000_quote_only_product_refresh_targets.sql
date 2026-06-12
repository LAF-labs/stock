with quote_only_targets as (
  select
    targets.market,
    targets.symbol,
    case
      when targets.market = 'KR' and upper(coalesce(targets.exchange, '')) = 'KONEX' then 'KONEX_STOCK'
      when regexp_replace(upper(coalesce(targets.metadata ->> 'name', '')), '\s+', '', 'g') ~ '(?:[0-9]+)?우(?:B|C)?(?:\(전환\))?$'
        or coalesce(targets.metadata ->> 'name', '') ilike '%우선주%'
        or coalesce(targets.metadata ->> 'name', '') ilike '%우선%' then 'PREFERRED_STOCK'
      else 'ETF'
    end as normalized_instrument_type
  from public.stock_refresh_targets targets
  where targets.enabled
    and (
      upper(targets.instrument_type) in ('ETF', 'ETN')
      or upper(coalesce(targets.exchange, '')) = 'KONEX'
      or regexp_replace(upper(coalesce(targets.metadata ->> 'name', '')), '\s+', '', 'g') ~ '(?:[0-9]+)?우(?:B|C)?(?:\(전환\))?$'
      or coalesce(targets.metadata ->> 'name', '') ilike '%우선주%'
      or coalesce(targets.metadata ->> 'name', '') ilike '%우선%'
      or upper(coalesce(targets.metadata ->> 'name', '')) ~ '^(1Q|ACE|ARIRANG|FOCUS|HANARO|HK|KBSTAR|KIWOOM|KOACT|KODEX|KOSEF|PLUS|RISE|SOL|TIME|TIGER|TREX|WON|BNK |IBK |DAISHIN)'
      or upper(coalesce(targets.metadata ->> 'name', '')) ~ '(ETF|ETN|TDF|S&P500)'
      or coalesce(targets.metadata ->> 'name', '') ~ '(공모주|국채|나스닥|데일리|레버리지|미국채|버퍼|상장지수|선물|액티브|인덱스|인버스|채권|커버드콜|타겟|혼합)'
    )
)
update public.stock_refresh_targets targets
set instrument_type = quote_only_targets.normalized_instrument_type,
    tier = 'etf',
    quote_interval_seconds = coalesce(targets.quote_interval_seconds, 86400),
    score_detail_interval_seconds = null,
    score_compare_interval_seconds = null,
    score_technical_interval_seconds = null,
    chart_interval_seconds = null,
    metadata = targets.metadata || jsonb_build_object('quote_only_reason', 'unsupported_stock_score_product'),
    updated_at = now()
from quote_only_targets
where targets.market = quote_only_targets.market
  and targets.symbol = quote_only_targets.symbol;

delete from public.stock_refresh_jobs jobs
using public.stock_refresh_targets targets
where jobs.market = targets.market
  and jobs.symbol = targets.symbol
  and jobs.kind in ('score', 'chart')
  and jobs.status in ('queued', 'running')
  and (jobs.status = 'queued' or coalesce(jobs.locked_until, jobs.locked_at + interval '15 minutes') <= now())
  and targets.tier = 'etf'
  and targets.score_detail_interval_seconds is null
  and targets.score_compare_interval_seconds is null
  and targets.score_technical_interval_seconds is null
  and targets.chart_interval_seconds is null
  and targets.metadata ->> 'quote_only_reason' = 'unsupported_stock_score_product';
