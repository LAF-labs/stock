create or replace function public.stock_profile_taxonomy_source_key(
  p_market text,
  p_sector_key text,
  p_industry_key text
)
returns text
language sql
immutable
as $$
  select concat_ws(':', upper(coalesce(p_market, '')), coalesce(p_sector_key, ''), coalesce(p_industry_key, ''))
$$;

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
begin
  delete from public.stock_industry_benchmarks
  where as_of_date = p_as_of_date
    and source = 'score_snapshot';

  with snapshot_base as (
    select
      public.stock_snapshot_market(ticker, payload) as market,
      public.stock_snapshot_symbol(ticker, payload) as symbol,
      payload
    from public.stock_score_snapshots
    where view_mode = 'detail'
      and updated_at >= now() - interval '30 days'
  ),
  base as (
    select
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
    select base.market, base.sector, base.industry, metric.metric, metric.value
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
    select market, sector, industry, metric, value
    from metric_rows
    where industry <> ''
    union all
    select market, sector, '' as industry, metric, value
    from metric_rows
  ),
  aggregates as (
    select
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
    group by market, sector, industry, metric
    having count(*) >= sample_floor
  ),
  upserted as (
    insert into public.stock_industry_benchmarks (
      market,
      sector,
      industry,
      metric,
      median,
      p25,
      p75,
      p10,
      p90,
      sample_count,
      source,
      as_of_date,
      expires_at
    )
    select
      market,
      sector,
      industry,
      metric,
      median,
      p25,
      p75,
      p10,
      p90,
      sample_count,
      'score_snapshot',
      p_as_of_date,
      now() + interval '1 day'
    from aggregates
    on conflict (market, sector, industry, metric, as_of_date) do update
      set median = excluded.median,
          p25 = excluded.p25,
          p75 = excluded.p75,
          p10 = excluded.p10,
          p90 = excluded.p90,
          sample_count = excluded.sample_count,
          source = excluded.source,
          expires_at = excluded.expires_at,
          updated_at = now()
    returning 1
  )
  select count(*)::integer into refreshed_rows
  from upserted;

  return refreshed_rows;
end;
$$;
