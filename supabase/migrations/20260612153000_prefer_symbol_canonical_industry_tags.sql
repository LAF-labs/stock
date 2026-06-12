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
  where source = 'score_snapshot'
    and (as_of_date = p_as_of_date or expires_at <= now());

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
      and coalesce(fetched_at, updated_at) >= now() - interval '30 days'
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
        nullif(canonical_sector_tag.name, ''),
        nullif(taxonomy.canonical_sector_name, ''),
        nullif(profile.primary_sector, ''),
        nullif(snapshot_base.payload ->> 'sector', ''),
        public.stock_profile_text(snapshot_base.payload, array['섹터', 'Sector']),
        ''
      ) as sector,
      coalesce(
        nullif(canonical_industry_tag.name, ''),
        nullif(taxonomy.canonical_industry_name, ''),
        nullif(profile.primary_industry, ''),
        nullif(snapshot_base.payload ->> 'industry', ''),
        public.stock_profile_text(snapshot_base.payload, array['산업', 'Industry']),
        ''
      ) as industry,
      snapshot_base.payload,
      (
        coalesce(
          nullif(lower(profile.asset_class), ''),
          nullif(lower(snapshot_base.payload ->> 'asset_class'), ''),
          nullif(lower(snapshot_base.payload #>> '{industry_profile,asset_class}'), ''),
          'stock'
        ) = 'stock'
        and upper(coalesce(
          nullif(snapshot_base.payload ->> 'instrument_type', ''),
          nullif(snapshot_base.payload #>> '{industry_profile,instrument_type}', ''),
          ''
        )) not in (
          'ETF',
          'ETN',
          'ETP',
          'ELW',
          'FUND',
          'MUTUAL_FUND',
          'WARRANT',
          'DERIVATIVE',
          'STRUCTURED_PRODUCT',
          'PREFERRED',
          'PREF',
          'SPAC',
          'REIT'
        )
        and not (
          upper(concat_ws(
            ' ',
            snapshot_base.payload ->> 'name',
            snapshot_base.payload #>> '{industry_profile,name}',
            profile.name
          )) ~ '(^|[^A-Z0-9])(ETF|ETN|ETP|ELW|WARRANT|FUTURE|FUTURES)([^A-Z0-9]|$)'
          or concat_ws(
            ' ',
            snapshot_base.payload ->> 'name',
            snapshot_base.payload #>> '{industry_profile,name}',
            profile.name
          ) ~* '(COVERED CALL|LEVERAGED|INVERSE|워런트|펀드|상장지수|레버리지|인버스|선물|파생|커버드콜|채권혼합|원자재|단일종목)'
        )
      ) as benchmark_eligible
    from snapshot_base
    left join public.stock_symbol_profiles profile
      on profile.market = snapshot_base.market
     and profile.symbol = snapshot_base.symbol
    left join lateral (
      select tag.name
      from public.stock_symbol_industry_tags tag
      where tag.market = snapshot_base.market
        and tag.symbol = snapshot_base.symbol
        and tag.taxonomy = 'finviz_canonical'
        and tag.level = 1
      order by tag.confidence desc, tag.is_primary desc, tag.updated_at desc
      limit 1
    ) canonical_sector_tag on true
    left join lateral (
      select tag.name
      from public.stock_symbol_industry_tags tag
      where tag.market = snapshot_base.market
        and tag.symbol = snapshot_base.symbol
        and tag.taxonomy = 'finviz_canonical'
        and tag.level = 2
        and tag.is_primary
      order by tag.confidence desc, tag.updated_at desc
      limit 1
    ) canonical_industry_tag on true
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
      and base.benchmark_eligible
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
    union all
    select scope, market, '' as sector, '' as industry, metric, value
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
      case
        when sector = '' and industry = '' then 'current_model_market_median'
        else 'current_model_snapshot_median'
      end,
      case
        when sector = '' and industry = '' then 0.6
        else 0.8
      end,
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

revoke all on function public.refresh_stock_industry_benchmarks(date, integer) from public;
grant execute on function public.refresh_stock_industry_benchmarks(date, integer) to service_role;
