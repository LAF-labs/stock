create table if not exists public.stock_symbol_profiles (
  market text not null check (market in ('US', 'KR')),
  symbol text not null,
  name text not null default '',
  exchange text not null default '',
  asset_class text not null default 'stock' check (asset_class in ('stock', 'etf', 'etn', 'reit', 'spac', 'preferred', 'other')),
  primary_sector text not null default '',
  primary_industry text not null default '',
  primary_sector_key text not null default '',
  primary_industry_key text not null default '',
  classification_status text not null default 'pending' check (classification_status in ('pending', 'partial', 'verified', 'missing')),
  source_priority integer not null default 100,
  source text not null default 'symbol_master',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market, symbol)
);

create index if not exists stock_symbol_profiles_industry_idx
on public.stock_symbol_profiles (market, primary_industry_key, primary_sector_key);

create index if not exists stock_symbol_profiles_status_idx
on public.stock_symbol_profiles (classification_status, market);

drop trigger if exists set_stock_symbol_profiles_updated_at
on public.stock_symbol_profiles;

create trigger set_stock_symbol_profiles_updated_at
before update on public.stock_symbol_profiles
for each row
execute function public.set_updated_at();

alter table public.stock_symbol_profiles enable row level security;

drop policy if exists "stock_symbol_profiles_public_select" on public.stock_symbol_profiles;

create policy "stock_symbol_profiles_public_select"
on public.stock_symbol_profiles
for select
using (true);

revoke all on table public.stock_symbol_profiles from public;
grant select on table public.stock_symbol_profiles to anon;
grant select, insert, update, delete on table public.stock_symbol_profiles to service_role;

create table if not exists public.stock_symbol_industry_tags (
  market text not null check (market in ('US', 'KR')),
  symbol text not null,
  taxonomy text not null default 'provider',
  code text not null default '',
  name text not null default '',
  level integer not null default 0 check (level >= 0),
  source text not null default 'unknown',
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  is_primary boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market, symbol, taxonomy, level, code, name, source)
);

create index if not exists stock_symbol_industry_tags_symbol_idx
on public.stock_symbol_industry_tags (market, symbol, is_primary desc, confidence desc);

create index if not exists stock_symbol_industry_tags_taxonomy_idx
on public.stock_symbol_industry_tags (taxonomy, level, code, name);

drop trigger if exists set_stock_symbol_industry_tags_updated_at
on public.stock_symbol_industry_tags;

create trigger set_stock_symbol_industry_tags_updated_at
before update on public.stock_symbol_industry_tags
for each row
execute function public.set_updated_at();

alter table public.stock_symbol_industry_tags enable row level security;

drop policy if exists "stock_symbol_industry_tags_public_select" on public.stock_symbol_industry_tags;

create policy "stock_symbol_industry_tags_public_select"
on public.stock_symbol_industry_tags
for select
using (true);

revoke all on table public.stock_symbol_industry_tags from public;
grant select on table public.stock_symbol_industry_tags to anon;
grant select, insert, update, delete on table public.stock_symbol_industry_tags to service_role;

create table if not exists public.industry_taxonomy_map (
  taxonomy text not null,
  source_key text not null,
  code text not null default '',
  name text not null default '',
  canonical_sector_key text not null default '',
  canonical_sector_name text not null default '',
  canonical_industry_key text not null default '',
  canonical_industry_name text not null default '',
  confidence numeric not null default 0.8 check (confidence >= 0 and confidence <= 1),
  updated_at timestamptz not null default now(),
  primary key (taxonomy, source_key)
);

create index if not exists industry_taxonomy_map_canonical_idx
on public.industry_taxonomy_map (canonical_sector_key, canonical_industry_key);

drop trigger if exists set_industry_taxonomy_map_updated_at
on public.industry_taxonomy_map;

create trigger set_industry_taxonomy_map_updated_at
before update on public.industry_taxonomy_map
for each row
execute function public.set_updated_at();

alter table public.industry_taxonomy_map enable row level security;

drop policy if exists "industry_taxonomy_map_public_select" on public.industry_taxonomy_map;

create policy "industry_taxonomy_map_public_select"
on public.industry_taxonomy_map
for select
using (true);

revoke all on table public.industry_taxonomy_map from public;
grant select on table public.industry_taxonomy_map to anon;
grant select, insert, update, delete on table public.industry_taxonomy_map to service_role;

create or replace function public.stock_snapshot_market(p_ticker text, p_payload jsonb)
returns text
language sql
immutable
as $$
  select upper(
    coalesce(
      nullif(p_payload ->> 'market', ''),
      case
        when coalesce(p_ticker, '') ~* '^KR:' then 'KR'
        when coalesce(p_ticker, '') ~* '^US:' then 'US'
        when coalesce(p_ticker, '') ~* '^(KR:)?Q?[0-9]{6}$' then 'KR'
        else 'US'
      end
    )
  )
$$;

create or replace function public.stock_snapshot_symbol(p_ticker text, p_payload jsonb)
returns text
language sql
immutable
as $$
  with raw as (
    select upper(coalesce(nullif(p_payload ->> 'symbol', ''), regexp_replace(coalesce(p_ticker, ''), '^(US|KR):', '', 'i'))) as symbol
  )
  select case
    when public.stock_snapshot_market(p_ticker, p_payload) = 'KR' and raw.symbol ~ '^Q[0-9]{6}$'
      then substr(raw.symbol, 2)
    when public.stock_snapshot_market(p_ticker, p_payload) = 'KR'
      then regexp_replace(raw.symbol, '\.(KS|KQ)$', '')
    else raw.symbol
  end
  from raw
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
        nullif(profile.primary_sector, ''),
        nullif(snapshot_base.payload ->> 'sector', ''),
        public.stock_profile_text(snapshot_base.payload, array['섹터', 'Sector']),
        ''
      ) as sector,
      coalesce(
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

revoke all on function public.refresh_stock_industry_benchmarks(date, integer) from public;
grant execute on function public.refresh_stock_industry_benchmarks(date, integer) to service_role;
