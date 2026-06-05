create or replace function public.stock_runtime_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_tables text[];
  missing_rpcs text[];
begin
  select coalesce(array_agg(item.name), '{}'::text[])
  into missing_tables
  from (
    values
      ('public.stock_score_snapshots'),
      ('public.stock_quote_snapshots'),
      ('public.stock_refresh_jobs'),
      ('public.stock_api_rate_limits'),
      ('public.stock_refresh_leases'),
      ('public.stock_refresh_cooldowns'),
      ('public.stock_rule_judgments'),
      ('public.stock_industry_benchmarks'),
      ('public.stock_symbol_profiles'),
      ('public.market_calendar')
  ) as item(name)
  where to_regclass(item.name) is null;

  select coalesce(array_agg(item.name), '{}'::text[])
  into missing_rpcs
  from (
    values
      ('acquire_stock_api_rate_limit'),
      ('acquire_stock_refresh_cooldown'),
      ('acquire_stock_refresh_lease'),
      ('enqueue_stock_refresh_job'),
      ('claim_stock_refresh_jobs'),
      ('complete_stock_refresh_job'),
      ('fail_stock_refresh_job'),
      ('refresh_stock_industry_benchmarks')
  ) as item(name)
  where not exists (
    select 1
    from pg_proc proc
    join pg_namespace ns
      on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname = item.name
  );

  return jsonb_build_object(
    'ok',
    coalesce(array_length(missing_tables, 1), 0) = 0
      and coalesce(array_length(missing_rpcs, 1), 0) = 0,
    'checked_at', now(),
    'missing_tables', missing_tables,
    'missing_rpcs', missing_rpcs
  );
end;
$$;

revoke all on function public.stock_runtime_readiness() from public;
grant execute on function public.stock_runtime_readiness() to service_role;

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
      now() + interval '1 day'
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
