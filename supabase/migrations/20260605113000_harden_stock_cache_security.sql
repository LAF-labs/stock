revoke insert, update on table public.stock_score_snapshots from anon;
grant select on table public.stock_score_snapshots to anon;
grant select, insert, update on table public.stock_score_snapshots to service_role;

revoke insert, update on table public.stock_fundamental_snapshots from anon;
grant select on table public.stock_fundamental_snapshots to anon;
grant select, insert, update on table public.stock_fundamental_snapshots to service_role;

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

revoke insert, update on table public.stock_quote_snapshots from anon;
grant select on table public.stock_quote_snapshots to anon;
grant select, insert, update on table public.stock_quote_snapshots to service_role;

revoke select, insert, update on table public.stock_refresh_cooldowns from anon;
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

create table if not exists public.stock_ai_judgments (
  ticker text not null,
  cache_date date not null,
  model text not null default 'legacy',
  judgment jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticker, cache_date, model)
);

alter table public.stock_ai_judgments add column if not exists model text;
alter table public.stock_ai_judgments add column if not exists updated_at timestamptz not null default now();
update public.stock_ai_judgments set model = 'legacy' where model is null;
alter table public.stock_ai_judgments alter column model set not null;

alter table public.stock_ai_judgments drop constraint if exists stock_ai_judgments_pkey;
alter table public.stock_ai_judgments add primary key (ticker, cache_date, model);

create index if not exists stock_ai_judgments_cache_date_idx
on public.stock_ai_judgments (cache_date);

alter table public.stock_ai_judgments enable row level security;

drop policy if exists "stock_ai_judgments_public_select" on public.stock_ai_judgments;
drop policy if exists "stock_ai_judgments_public_insert" on public.stock_ai_judgments;
drop policy if exists "stock_ai_judgments_public_update" on public.stock_ai_judgments;
drop policy if exists "stock_ai_judgments_public_delete" on public.stock_ai_judgments;

create policy "stock_ai_judgments_public_select"
on public.stock_ai_judgments
for select
to anon
using (true);

revoke insert, update, delete on table public.stock_ai_judgments from anon;
grant select on table public.stock_ai_judgments to anon;
grant select, insert, update, delete on table public.stock_ai_judgments to service_role;
