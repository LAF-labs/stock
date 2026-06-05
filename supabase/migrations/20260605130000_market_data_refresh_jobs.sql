alter table public.stock_quote_snapshots
add column if not exists market text not null default 'US';

alter table public.stock_quote_snapshots
add column if not exists symbol text;

update public.stock_quote_snapshots
set market = 'KR'
where ticker ~ '^[0-9]{6}$';

update public.stock_quote_snapshots
set symbol = coalesce(nullif(symbol, ''), ticker)
where symbol is null or symbol = '';

alter table public.stock_quote_snapshots
alter column symbol set not null;

alter table public.stock_quote_snapshots
add column if not exists source text not null default 'kis';

alter table public.stock_quote_snapshots
add column if not exists stale_expires_at timestamptz;

update public.stock_quote_snapshots
set stale_expires_at = expires_at
where stale_expires_at is null;

alter table public.stock_quote_snapshots
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

create table if not exists public.stock_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quote', 'score', 'fundamentals', 'judgment')),
  market text not null check (market in ('US', 'KR')),
  symbol text not null,
  view_mode text check (view_mode is null or view_mode in ('detail', 'compare')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint stock_refresh_jobs_attempts_check check (attempts >= 0 and max_attempts > 0),
  constraint stock_refresh_jobs_running_lock_check check (
    status <> 'running' or (locked_by is not null and locked_at is not null)
  )
);

create unique index if not exists stock_refresh_jobs_dedupe_pending_idx
on public.stock_refresh_jobs (kind, market, symbol, coalesce(view_mode, ''))
where status in ('queued', 'running');

create index if not exists stock_refresh_jobs_ready_idx
on public.stock_refresh_jobs (status, run_after, priority, created_at);

create index if not exists stock_refresh_jobs_symbol_idx
on public.stock_refresh_jobs (market, symbol, created_at desc);

drop trigger if exists set_stock_refresh_jobs_updated_at
on public.stock_refresh_jobs;

create trigger set_stock_refresh_jobs_updated_at
before update on public.stock_refresh_jobs
for each row
execute function public.set_updated_at();

alter table public.stock_refresh_jobs enable row level security;

revoke all on table public.stock_refresh_jobs from public;
grant select, insert, update, delete on table public.stock_refresh_jobs to service_role;

create or replace function public.enqueue_stock_refresh_job(
  p_kind text,
  p_market text,
  p_symbol text,
  p_view_mode text default null,
  p_priority integer default 100,
  p_run_after timestamptz default now(),
  p_payload jsonb default '{}'::jsonb
)
returns public.stock_refresh_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.stock_refresh_jobs;
begin
  p_kind := lower(trim(p_kind));
  p_market := upper(trim(p_market));
  p_symbol := upper(trim(p_symbol));
  p_view_mode := nullif(lower(trim(coalesce(p_view_mode, ''))), '');

  if p_kind is null or p_kind not in ('quote', 'score', 'fundamentals', 'judgment') then
    raise exception 'invalid refresh kind';
  end if;

  if p_market is null or p_market not in ('US', 'KR') or p_symbol is null or p_symbol = '' then
    raise exception 'invalid refresh target';
  end if;

  if p_kind = 'score' and p_view_mode is null then
    p_view_mode := 'detail';
  end if;

  if p_view_mode is not null and p_view_mode not in ('detail', 'compare') then
    raise exception 'invalid refresh view';
  end if;

  insert into public.stock_refresh_jobs (
    kind,
    market,
    symbol,
    view_mode,
    priority,
    run_after,
    payload
  )
  values (
    p_kind,
    p_market,
    p_symbol,
    p_view_mode,
    coalesce(p_priority, 100),
    coalesce(p_run_after, now()),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning * into result;

  return result;
exception
  when unique_violation then
    select *
    into result
    from public.stock_refresh_jobs
    where kind = p_kind
      and market = p_market
      and symbol = p_symbol
      and coalesce(view_mode, '') = coalesce(p_view_mode, '')
      and status in ('queued', 'running')
    order by created_at asc
    limit 1;

    return result;
end;
$$;

create or replace function public.claim_stock_refresh_jobs(
  p_worker_id text,
  p_limit integer default 10
)
returns setof public.stock_refresh_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
begin
  if p_worker_id is null or trim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;

  return query
  with next_jobs as (
    select id
    from public.stock_refresh_jobs
    where status = 'queued'
      and run_after <= now()
      and attempts < max_attempts
    order by priority asc, run_after asc, created_at asc
    limit claim_limit
    for update skip locked
  )
  update public.stock_refresh_jobs jobs
  set status = 'running',
      locked_by = p_worker_id,
      locked_at = now(),
      attempts = jobs.attempts + 1,
      updated_at = now()
  from next_jobs
  where jobs.id = next_jobs.id
  returning jobs.*;
end;
$$;

revoke all on function public.enqueue_stock_refresh_job(text, text, text, text, integer, timestamptz, jsonb) from public;
revoke all on function public.claim_stock_refresh_jobs(text, integer) from public;

grant execute on function public.enqueue_stock_refresh_job(text, text, text, text, integer, timestamptz, jsonb) to service_role;
grant execute on function public.claim_stock_refresh_jobs(text, integer) to service_role;
