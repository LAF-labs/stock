alter table public.stock_industry_benchmarks
  add column if not exists scope text,
  add column if not exists period text not null default 'quarter',
  add column if not exists provider_group_key text not null default '',
  add column if not exists provider_group_name text not null default '',
  add column if not exists calculation_method text not null default 'snapshot_median',
  add column if not exists confidence numeric not null default 1;

update public.stock_industry_benchmarks
set scope = case when market = 'KR' then 'KR' else 'OVERSEAS' end
where scope is null or scope = '';

alter table public.stock_industry_benchmarks
  alter column scope set not null,
  alter column scope set default 'KR';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'stock_industry_benchmarks_pkey'
      and conrelid = 'public.stock_industry_benchmarks'::regclass
  ) then
    alter table public.stock_industry_benchmarks
      drop constraint stock_industry_benchmarks_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_industry_benchmarks_pkey'
      and conrelid = 'public.stock_industry_benchmarks'::regclass
  ) then
    alter table public.stock_industry_benchmarks
      add constraint stock_industry_benchmarks_pkey
      primary key (scope, sector, industry, metric, period, as_of_date);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_industry_benchmarks_scope_check'
      and conrelid = 'public.stock_industry_benchmarks'::regclass
  ) then
    alter table public.stock_industry_benchmarks
      add constraint stock_industry_benchmarks_scope_check
      check (scope in ('KR', 'OVERSEAS'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_industry_benchmarks_period_check'
      and conrelid = 'public.stock_industry_benchmarks'::regclass
  ) then
    alter table public.stock_industry_benchmarks
      add constraint stock_industry_benchmarks_period_check
      check (period in ('quarter', 'annual', 'ttm'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_industry_benchmarks_confidence_check'
      and conrelid = 'public.stock_industry_benchmarks'::regclass
  ) then
    alter table public.stock_industry_benchmarks
      add constraint stock_industry_benchmarks_confidence_check
      check (confidence >= 0 and confidence <= 1);
  end if;
end $$;

create index if not exists stock_industry_benchmarks_scope_lookup_idx
on public.stock_industry_benchmarks (scope, metric, period, industry, sector, expires_at desc, sample_count desc);

create index if not exists stock_industry_benchmarks_provider_group_idx
on public.stock_industry_benchmarks (source, provider_group_key, as_of_date desc);

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
      'snapshot_median',
      0.75,
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
