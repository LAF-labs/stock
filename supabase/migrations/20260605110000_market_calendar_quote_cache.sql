create table if not exists public.market_calendar (
  market text not null check (market in ('KR', 'US')),
  trade_date date not null,
  is_open boolean not null,
  open_at timestamptz,
  close_at timestamptz,
  next_open_at timestamptz,
  is_early_close boolean not null default false,
  status text not null default 'regular' check (status in ('regular', 'holiday', 'closed', 'early_close')),
  holiday_name text,
  reason text,
  timezone text,
  source text not null default 'manual',
  source_revision text,
  version text,
  updated_at timestamptz not null default now(),
  constraint market_calendar_open_hours check (not is_open or (open_at is not null and close_at is not null and open_at < close_at)),
  primary key (market, trade_date)
);

alter table public.market_calendar add column if not exists status text not null default 'regular';
alter table public.market_calendar add column if not exists holiday_name text;
alter table public.market_calendar add column if not exists reason text;
alter table public.market_calendar add column if not exists timezone text;
alter table public.market_calendar add column if not exists source_revision text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_calendar_open_hours'
  ) then
    alter table public.market_calendar
    add constraint market_calendar_open_hours check (not is_open or (open_at is not null and close_at is not null and open_at < close_at));
  end if;
end;
$$;

create table if not exists public.stock_quote_snapshots (
  ticker text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists stock_quote_snapshots_expires_at_idx
on public.stock_quote_snapshots (expires_at);

create table if not exists public.stock_refresh_cooldowns (
  user_key text primary key,
  refreshed_at timestamptz not null,
  cooldown_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists stock_refresh_cooldowns_until_idx
on public.stock_refresh_cooldowns (cooldown_until);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_market_calendar_updated_at
on public.market_calendar;

create trigger set_market_calendar_updated_at
before update on public.market_calendar
for each row
execute function public.set_updated_at();

drop trigger if exists set_stock_quote_snapshots_updated_at
on public.stock_quote_snapshots;

create trigger set_stock_quote_snapshots_updated_at
before update on public.stock_quote_snapshots
for each row
execute function public.set_updated_at();

drop trigger if exists set_stock_refresh_cooldowns_updated_at
on public.stock_refresh_cooldowns;

create trigger set_stock_refresh_cooldowns_updated_at
before update on public.stock_refresh_cooldowns
for each row
execute function public.set_updated_at();

alter table public.market_calendar enable row level security;
alter table public.stock_quote_snapshots enable row level security;
alter table public.stock_refresh_cooldowns enable row level security;

drop policy if exists "market_calendar_public_select" on public.market_calendar;
drop policy if exists "stock_quote_snapshots_public_select" on public.stock_quote_snapshots;
drop policy if exists "stock_quote_snapshots_public_insert" on public.stock_quote_snapshots;
drop policy if exists "stock_quote_snapshots_public_update" on public.stock_quote_snapshots;
drop policy if exists "stock_refresh_cooldowns_public_select" on public.stock_refresh_cooldowns;
drop policy if exists "stock_refresh_cooldowns_public_insert" on public.stock_refresh_cooldowns;
drop policy if exists "stock_refresh_cooldowns_public_update" on public.stock_refresh_cooldowns;

create policy "market_calendar_public_select"
on public.market_calendar
for select
to anon
using (true);

create policy "stock_quote_snapshots_public_select"
on public.stock_quote_snapshots
for select
to anon
using (true);

grant select on table public.market_calendar to anon;
revoke insert, update on table public.stock_quote_snapshots from anon;
grant select on table public.stock_quote_snapshots to anon;
revoke select, insert, update on table public.stock_refresh_cooldowns from anon;
grant select, insert, update on table public.stock_quote_snapshots to service_role;
grant select, insert, update on table public.stock_refresh_cooldowns to service_role;

create or replace function public.acquire_stock_refresh_cooldown(
  p_user_key text,
  p_cooldown_seconds integer
)
returns table(acquired boolean, cooldown_until timestamptz, remaining_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  next_until timestamptz;
begin
  if p_user_key is null or p_user_key = '' or p_cooldown_seconds <= 0 then
    raise exception 'invalid cooldown request';
  end if;

  insert into public.stock_refresh_cooldowns (user_key, refreshed_at, cooldown_until)
  values (p_user_key, now_ts, now_ts + make_interval(secs => p_cooldown_seconds))
  on conflict (user_key) do update
    set refreshed_at = excluded.refreshed_at,
        cooldown_until = excluded.cooldown_until,
        updated_at = now_ts
    where public.stock_refresh_cooldowns.cooldown_until <= now_ts
  returning public.stock_refresh_cooldowns.cooldown_until into next_until;

  if next_until is not null then
    return query select true, next_until, p_cooldown_seconds;
    return;
  end if;

  select public.stock_refresh_cooldowns.cooldown_until
  into next_until
  from public.stock_refresh_cooldowns
  where user_key = p_user_key;

  return query select
    false,
    next_until,
    greatest(0, ceil(extract(epoch from (next_until - now_ts)))::integer);
end;
$$;

revoke all on function public.acquire_stock_refresh_cooldown(text, integer) from public;
grant execute on function public.acquire_stock_refresh_cooldown(text, integer) to service_role;
