alter table public.stock_quote_snapshots
  add column if not exists market text,
  add column if not exists symbol text,
  add column if not exists source text,
  add column if not exists stale_expires_at timestamptz;

update public.stock_quote_snapshots
set
  market = coalesce(nullif(market, ''), split_part(ticker, ':', 1), 'US'),
  symbol = coalesce(nullif(symbol, ''), split_part(ticker, ':', 2), ticker),
  source = coalesce(nullif(source, ''), 'kis'),
  stale_expires_at = coalesce(stale_expires_at, greatest(expires_at, fetched_at + interval '1 day'))
where market is null
  or symbol is null
  or source is null
  or stale_expires_at is null;

alter table public.stock_quote_snapshots
  alter column market set default 'US',
  alter column market set not null,
  alter column symbol set not null,
  alter column source set default 'kis',
  alter column source set not null,
  alter column stale_expires_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_quote_snapshots_market_check'
  ) then
    alter table public.stock_quote_snapshots
      add constraint stock_quote_snapshots_market_check check (market in ('US', 'KR'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'stock_quote_snapshots_expiry_order'
  ) then
    alter table public.stock_quote_snapshots
      add constraint stock_quote_snapshots_expiry_order check (expires_at <= stale_expires_at);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'stock_quote_snapshots_retention'
  ) then
    alter table public.stock_quote_snapshots
      add constraint stock_quote_snapshots_retention check (stale_expires_at <= fetched_at + interval '30 days');
  end if;
end;
$$;

create unique index if not exists stock_quote_snapshots_market_symbol_source_idx
on public.stock_quote_snapshots (market, symbol, source);

create index if not exists stock_quote_snapshots_stale_expires_at_idx
on public.stock_quote_snapshots (stale_expires_at);
