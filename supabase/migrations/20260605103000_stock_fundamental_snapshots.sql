create table if not exists public.stock_fundamental_snapshots (
  market text not null default 'US',
  symbol text not null,
  source text not null default 'yfinance',
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stale_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint stock_fundamental_snapshots_expiry_order check (expires_at <= stale_expires_at),
  constraint stock_fundamental_snapshots_retention check (stale_expires_at <= fetched_at + interval '30 days'),
  primary key (market, symbol, source)
);

create index if not exists stock_fundamental_snapshots_expires_at_idx
on public.stock_fundamental_snapshots (expires_at);

create index if not exists stock_fundamental_snapshots_stale_expires_at_idx
on public.stock_fundamental_snapshots (stale_expires_at);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_fundamental_snapshots_expiry_order'
  ) then
    alter table public.stock_fundamental_snapshots
    add constraint stock_fundamental_snapshots_expiry_order check (expires_at <= stale_expires_at);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'stock_fundamental_snapshots_retention'
  ) then
    alter table public.stock_fundamental_snapshots
    add constraint stock_fundamental_snapshots_retention check (stale_expires_at <= fetched_at + interval '30 days');
  end if;
end;
$$;

create or replace function public.set_stock_fundamental_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_stock_fundamental_snapshots_updated_at
on public.stock_fundamental_snapshots;

create trigger set_stock_fundamental_snapshots_updated_at
before update on public.stock_fundamental_snapshots
for each row
execute function public.set_stock_fundamental_snapshots_updated_at();

alter table public.stock_fundamental_snapshots enable row level security;

drop policy if exists "stock_fundamental_snapshots_public_select" on public.stock_fundamental_snapshots;
drop policy if exists "stock_fundamental_snapshots_public_insert" on public.stock_fundamental_snapshots;
drop policy if exists "stock_fundamental_snapshots_public_update" on public.stock_fundamental_snapshots;

create policy "stock_fundamental_snapshots_public_select"
on public.stock_fundamental_snapshots
for select
to anon
using (true);

revoke insert, update on table public.stock_fundamental_snapshots from anon;
grant select on table public.stock_fundamental_snapshots to anon;
grant select, insert, update on table public.stock_fundamental_snapshots to service_role;
