create or replace function public.stock_industry_benchmark_market(
  p_scope text,
  p_market text
)
returns text
language sql
immutable
as $$
  select case
    when upper(coalesce(p_scope, '')) in ('KR', 'DOMESTIC') then 'KR'
    when upper(coalesce(p_scope, '')) in ('OVERSEAS', 'US', 'GLOBAL') then 'US'
    when upper(coalesce(p_market, '')) = 'KR' then 'KR'
    else 'US'
  end
$$;

create or replace function public.stock_industry_benchmark_expires_at(
  p_scope text,
  p_market text,
  p_grace interval default interval '12 hours'
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  target_market text := public.stock_industry_benchmark_market(p_scope, p_market);
  grace_window interval := coalesce(p_grace, interval '12 hours');
  expiry timestamptz;
begin
  select close_at + grace_window
  into expiry
  from public.market_calendar
  where market = target_market
    and is_open
    and close_at is not null
    and close_at > now()
  order by close_at asc
  limit 1;

  return coalesce(expiry, now() + interval '4 days');
end;
$$;

alter table public.stock_industry_benchmarks
  alter column expires_at set default now() + interval '4 days';

create or replace function public.refresh_stock_industry_benchmarks(
  p_as_of_date date default current_date,
  p_min_sample_count integer default 8
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_rows integer := 0;
  sample_floor integer := least(greatest(coalesce(p_min_sample_count, 8), 3), 100);
  current_score_model text := 'score-v5-dual-quality-opportunity-2026-06-05';
begin
  delete from public.stock_industry_benchmarks
  where as_of_date = p_as_of_date
    and source = 'score_snapshot';

  with snapshot_ranked as (
    select
      public.stock_snapshot_market(ticker, payload) as market,
      public.stock_snapshot_symbol(ticker, payload) as symbol,
      payload,
      fetched_at,
      updated_at,
      row_number() over (
        partition by public.stock_snapshot_market(ticker, payload), public.stock_snapshot_symbol(ticker, payload)
        order by fetched_at desc nulls last, updated_at desc nulls last
      ) as row_number
    from public.stock_score_snapshots
    where view_mode = 'detail'
      and expires_at > now()
      and coalesce(payload ->> 'ok', 'false') = 'true'
      and coalesce(
        nullif(score_model_version, ''),
        nullif(payload ->> 'score_model_version', ''),
        nullif(payload #>> '{sia_snapshot,score_model_version}', '')
      ) = current_score_model
  ),
  snapshot_base as (
    select market, symbol, payload
    from snapshot_ranked
    where row_number = 1
  ),
  base as (
    select
      case when snapshot_base.market = 'KR' then 'KR' else 'OVERSEAS' end as scope,
      snapshot_base.market,
      coalesce(
        nullif(taxonomy.canonical_sector_name, ''),
        nullif(profile.primary_sector, ''),
        nullif(snapshot_base.payload ->> 'sector', ''),
        public.stock_profile_text(snapshot_base.payload, array['섹터', 'Sector']),
        ''
      ) as sector,
      coalesce(
        nullif(taxonomy.canonical_industry_name, ''),
        nullif(profile.primary_industry, ''),
        nullif(snapshot_base.payload ->> 'industry', ''),
        public.stock_profile_text(snapshot_base.payload, array['산업', 'Industry']),
        ''
      ) as industry,
      snapshot_base.payload
    from snapshot_base
    left join public.stock_symbol_profiles profile
      on profile.market = snapshot_base.market
     and profile.symbol = snapshot_base.symbol
    left join public.industry_taxonomy_map taxonomy
      on taxonomy.taxonomy = 'profile_primary'
     and taxonomy.source_key = public.stock_profile_taxonomy_source_key(
       profile.market,
       profile.primary_sector_key,
       profile.primary_industry_key
     )
  ),
  metric_rows as (
    select base.scope, base.market, base.sector, base.industry, metric.metric, metric.value
    from base
    cross join lateral (
      values
        ('per', public.stock_metric_numeric(base.payload, 'PER')),
        ('forward_per', public.stock_metric_numeric(base.payload, 'Forward PER')),
        ('pbr', public.stock_metric_numeric(base.payload, 'PBR')),
        ('psr', public.stock_metric_numeric(base.payload, 'Price/Sales')),
        ('ev_revenue', public.stock_metric_numeric(base.payload, 'EV/Revenue'))
    ) as metric(metric, value)
    where base.market in ('US', 'KR')
      and base.sector <> ''
      and metric.value is not null
      and metric.value > 0
      and metric.value < 10000
  ),
  grouped as (
    select scope, market, sector, industry, metric, value
    from metric_rows
    where industry <> ''
    union all
    select scope, market, sector, '' as industry, metric, value
    from metric_rows
  ),
  aggregates as (
    select
      scope,
      market,
      sector,
      industry,
      metric,
      percentile_cont(0.5) within group (order by value)::numeric as median,
      percentile_cont(0.25) within group (order by value)::numeric as p25,
      percentile_cont(0.75) within group (order by value)::numeric as p75,
      percentile_cont(0.1) within group (order by value)::numeric as p10,
      percentile_cont(0.9) within group (order by value)::numeric as p90,
      count(*)::integer as sample_count
    from grouped
    group by scope, market, sector, industry, metric
    having count(*) >= sample_floor
  ),
  upserted as (
    insert into public.stock_industry_benchmarks (
      scope,
      market,
      sector,
      industry,
      metric,
      period,
      median,
      p25,
      p75,
      p10,
      p90,
      sample_count,
      source,
      provider_group_key,
      provider_group_name,
      calculation_method,
      confidence,
      as_of_date,
      expires_at
    )
    select
      scope,
      market,
      sector,
      industry,
      metric,
      'quarter',
      median,
      p25,
      p75,
      p10,
      p90,
      sample_count,
      'score_snapshot',
      '',
      '',
      'current_model_snapshot_median',
      0.8,
      p_as_of_date,
      public.stock_industry_benchmark_expires_at(scope, market)
    from aggregates
    on conflict (scope, sector, industry, metric, period, as_of_date) do update
      set scope = excluded.scope,
          market = excluded.market,
          period = excluded.period,
          median = excluded.median,
          p25 = excluded.p25,
          p75 = excluded.p75,
          p10 = excluded.p10,
          p90 = excluded.p90,
          sample_count = excluded.sample_count,
          source = excluded.source,
          provider_group_key = excluded.provider_group_key,
          provider_group_name = excluded.provider_group_name,
          calculation_method = excluded.calculation_method,
          confidence = excluded.confidence,
          expires_at = excluded.expires_at,
          updated_at = now()
      where public.stock_industry_benchmarks.source = 'score_snapshot'
    returning 1
  )
  select count(*)::integer into refreshed_rows
  from upserted;

  return refreshed_rows;
end;
$$;

update public.stock_industry_benchmarks
set expires_at = public.stock_industry_benchmark_expires_at(scope, market)
where expires_at < public.stock_industry_benchmark_expires_at(scope, market);

revoke all on function public.refresh_stock_industry_benchmarks(date, integer) from public;
grant execute on function public.refresh_stock_industry_benchmarks(date, integer) to service_role;
