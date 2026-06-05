alter table public.stock_symbol_profiles
add column if not exists listing_status text not null default 'listed';

alter table public.stock_symbol_profiles
add column if not exists listed_at date;

alter table public.stock_symbol_profiles
add column if not exists delisted_at date;

do $$
begin
  alter table public.stock_symbol_profiles
  add constraint stock_symbol_profiles_listing_status_check
  check (listing_status in ('listed', 'delisted', 'newly_listed', 'pending_data'));
exception
  when duplicate_object then null;
end $$;

create index if not exists stock_symbol_profiles_search_status_idx
on public.stock_symbol_profiles (market, listing_status, symbol);

create index if not exists stock_symbol_profiles_symbol_prefix_idx
on public.stock_symbol_profiles (market, symbol text_pattern_ops);

create or replace function public.stock_symbol_search_norm(p_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(p_text, '')), '[[:space:]._/(),\[\]-]+', '', 'g')
$$;

create or replace function public.search_stock_symbols(
  p_query text default '',
  p_limit integer default 8,
  p_market text default null
)
returns table (
  market text,
  ticker text,
  exchange text,
  exchange_name text,
  korean_name text,
  english_name text,
  instrument_type text,
  currency text,
  standard_code text,
  provider_sector_code text,
  listing_status text,
  listed_at date,
  delisted_at date
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      public.stock_symbol_search_norm(p_query) as q,
      case when upper(coalesce(p_market, '')) in ('US', 'KR') then upper(p_market) else null end as market_filter,
      least(greatest(coalesce(p_limit, 8), 1), 20) as result_limit
  ),
  base as (
    select
      profile.market,
      profile.symbol as ticker,
      profile.exchange,
      coalesce(nullif(profile.metadata ->> 'exchange_name', ''), profile.exchange) as exchange_name,
      case when profile.market = 'KR' then profile.name else coalesce(nullif(profile.metadata ->> 'korean_name', ''), '') end as korean_name,
      case when profile.market = 'US' then profile.name else coalesce(nullif(profile.metadata ->> 'english_name', ''), '') end as english_name,
      case when profile.asset_class = 'etf' then 'ETF' else 'STOCK' end as instrument_type,
      coalesce(nullif(profile.metadata ->> 'currency', ''), case when profile.market = 'KR' then 'KRW' else 'USD' end) as currency,
      coalesce(nullif(profile.metadata ->> 'standard_code', ''), nullif(profile.metadata ->> 'isin', '')) as standard_code,
      profile.primary_industry_key as provider_sector_code,
      profile.listing_status,
      profile.listed_at,
      profile.delisted_at,
      public.stock_symbol_search_norm(profile.symbol) as symbol_norm,
      public.stock_symbol_search_norm(profile.name) as name_norm,
      public.stock_symbol_search_norm(coalesce(profile.metadata ->> 'english_name', '')) as english_norm,
      (profile.market || ':' || profile.symbol) as full_key,
      params.q,
      params.result_limit
    from public.stock_symbol_profiles profile
    cross join params
    where profile.listing_status <> 'delisted'
      and (params.market_filter is null or profile.market = params.market_filter)
  ),
  ranked as (
    select
      base.*,
      case
        when base.q = '' and base.full_key = 'US:KO' then 0
        when base.q = '' and base.full_key = 'US:NVDA' then 1
        when base.q = '' and base.full_key = 'US:AAPL' then 2
        when base.q = '' and base.full_key = 'US:MSFT' then 3
        when base.q = '' and base.full_key = 'KR:005930' then 4
        when base.q = '' and base.full_key = 'KR:000660' then 5
        when base.q = '' and base.full_key = 'KR:035420' then 6
        when base.q = '' and base.full_key = 'KR:005380' then 7
        when base.q = '' then 999
        when base.symbol_norm = base.q then 0
        when base.name_norm = base.q then 2
        when base.english_norm = base.q then 4
        when base.symbol_norm like base.q || '%' then 10 + length(base.symbol_norm)
        when base.name_norm like base.q || '%' then 30 + length(base.name_norm)
        when base.english_norm like base.q || '%' then 45 + length(base.english_norm)
        when position(base.q in base.symbol_norm) > 0 then 60 + position(base.q in base.symbol_norm)
        when position(base.q in base.name_norm) > 0 then 80 + position(base.q in base.name_norm)
        when position(base.q in base.english_norm) > 0 then 100 + position(base.q in base.english_norm)
        else 999
      end as search_rank
    from base
  )
  select
    ranked.market,
    ranked.ticker,
    ranked.exchange,
    ranked.exchange_name,
    ranked.korean_name,
    ranked.english_name,
    ranked.instrument_type,
    ranked.currency,
    ranked.standard_code,
    ranked.provider_sector_code,
    ranked.listing_status,
    ranked.listed_at,
    ranked.delisted_at
  from ranked
  where ranked.search_rank < 999
  order by ranked.search_rank, ranked.market, ranked.ticker
  limit (select result_limit from params)
$$;

grant execute on function public.search_stock_symbols(text, integer, text) to anon;
grant execute on function public.search_stock_symbols(text, integer, text) to service_role;
