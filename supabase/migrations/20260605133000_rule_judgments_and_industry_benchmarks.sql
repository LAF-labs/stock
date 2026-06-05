create table if not exists public.stock_rule_judgments (
  ticker text not null,
  cache_date date not null,
  model text not null,
  judgment jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticker, cache_date, model)
);

create index if not exists stock_rule_judgments_cache_date_idx
on public.stock_rule_judgments (cache_date);

drop trigger if exists set_stock_rule_judgments_updated_at
on public.stock_rule_judgments;

create trigger set_stock_rule_judgments_updated_at
before update on public.stock_rule_judgments
for each row
execute function public.set_updated_at();

alter table public.stock_rule_judgments enable row level security;

revoke all on table public.stock_rule_judgments from public;
grant select, insert, update, delete on table public.stock_rule_judgments to service_role;

create table if not exists public.stock_industry_benchmarks (
  market text not null check (market in ('US', 'KR')),
  sector text not null default '',
  industry text not null default '',
  metric text not null check (metric in ('per', 'forward_per', 'pbr', 'psr', 'ev_revenue', 'roe', 'profit_margin')),
  median numeric not null,
  p25 numeric,
  p75 numeric,
  p10 numeric,
  p90 numeric,
  sample_count integer not null default 0,
  source text not null default 'snapshot_job',
  as_of_date date not null default current_date,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  primary key (market, sector, industry, metric, as_of_date),
  constraint stock_industry_benchmarks_sample_count_check check (sample_count >= 0),
  constraint stock_industry_benchmarks_expiry_check check (expires_at > updated_at - interval '1 minute')
);

create index if not exists stock_industry_benchmarks_lookup_idx
on public.stock_industry_benchmarks (market, metric, industry, sector, expires_at desc, sample_count desc);

create index if not exists stock_industry_benchmarks_expires_at_idx
on public.stock_industry_benchmarks (expires_at);

drop trigger if exists set_stock_industry_benchmarks_updated_at
on public.stock_industry_benchmarks;

create trigger set_stock_industry_benchmarks_updated_at
before update on public.stock_industry_benchmarks
for each row
execute function public.set_updated_at();

alter table public.stock_industry_benchmarks enable row level security;

revoke all on table public.stock_industry_benchmarks from public;
grant select, insert, update, delete on table public.stock_industry_benchmarks to service_role;

create or replace function public.stock_parse_numeric_text(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  cleaned := nullif(regexp_replace(coalesce(p_value, ''), '[^0-9.\-]+', '', 'g'), '');
  if cleaned is null or cleaned in ('-', '.', '-.') then
    return null;
  end if;
  return cleaned::numeric;
exception
  when others then
    return null;
end;
$$;

create or replace function public.stock_json_labeled_text(p_items jsonb, p_labels text[])
returns text
language sql
immutable
as $$
  select nullif(entry.item ->> 'value', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as entry(item)
  where exists (
    select 1
    from unnest(p_labels) as label
    where lower(coalesce(entry.item ->> 'label', '')) = lower(label)
  )
    and nullif(entry.item ->> 'value', '') is not null
    and entry.item ->> 'value' <> '-'
  limit 1
$$;

create or replace function public.stock_metric_numeric(p_payload jsonb, p_label text)
returns numeric
language sql
immutable
as $$
  select public.stock_parse_numeric_text(
    coalesce(
      public.stock_json_labeled_text(p_payload -> 'valuation_rows', array[p_label]),
      public.stock_json_labeled_text(p_payload -> 'key_metrics', array[p_label])
    )
  )
$$;

create or replace function public.stock_profile_text(p_payload jsonb, p_labels text[])
returns text
language sql
immutable
as $$
  select nullif(public.stock_json_labeled_text(p_payload -> 'stock_profile', p_labels), '-')
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

  with base as (
    select
      upper(coalesce(nullif(payload ->> 'market', ''), case when ticker ~ '^[0-9]{6}$' then 'KR' else 'US' end)) as market,
      coalesce(
        nullif(payload ->> 'sector', ''),
        public.stock_profile_text(payload, array['섹터', 'Sector']),
        ''
      ) as sector,
      coalesce(
        nullif(payload ->> 'industry', ''),
        public.stock_profile_text(payload, array['산업', 'Industry']),
        ''
      ) as industry,
      payload
    from public.stock_score_snapshots
    where view_mode = 'detail'
      and updated_at >= now() - interval '30 days'
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
