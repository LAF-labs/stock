alter table public.stock_score_snapshots
drop constraint if exists stock_score_snapshots_view_mode_check;

alter table public.stock_score_snapshots
add constraint stock_score_snapshots_view_mode_check
check (view_mode in ('detail', 'compare', 'technical'));

alter table public.stock_refresh_jobs
drop constraint if exists stock_refresh_jobs_view_mode_check;

alter table public.stock_refresh_jobs
add constraint stock_refresh_jobs_view_mode_check
check (view_mode is null or view_mode in ('detail', 'compare', 'technical'));

alter table public.stock_refresh_leases
drop constraint if exists stock_refresh_leases_view_mode_check;

alter table public.stock_refresh_leases
add constraint stock_refresh_leases_view_mode_check
check (view_mode in ('', 'detail', 'compare', 'technical'));

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

  if p_view_mode is not null and p_view_mode not in ('detail', 'compare', 'technical') then
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
    update public.stock_refresh_jobs jobs
    set priority = least(jobs.priority, coalesce(p_priority, 100)),
        run_after = least(jobs.run_after, coalesce(p_run_after, now())),
        payload = jobs.payload || coalesce(p_payload, '{}'::jsonb),
        updated_at = now()
    where kind = p_kind
      and market = p_market
      and symbol = p_symbol
      and coalesce(view_mode, '') = coalesce(p_view_mode, '')
      and status in ('queued', 'running')
    returning * into result;

    return result;
end;
$$;

create or replace function public.acquire_stock_refresh_lease(
  p_kind text,
  p_market text,
  p_symbol text,
  p_view_mode text default null,
  p_lock_seconds integer default 30,
  p_locked_by text default null
)
returns table(acquired boolean, lease_until timestamptz, locked_by text)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  normalized_kind text := lower(trim(coalesce(p_kind, '')));
  normalized_market text := upper(trim(coalesce(p_market, '')));
  normalized_symbol text := upper(trim(coalesce(p_symbol, '')));
  normalized_view text := nullif(lower(trim(coalesce(p_view_mode, ''))), '');
  lock_seconds integer := least(greatest(coalesce(p_lock_seconds, 30), 5), 300);
  owner text := left(coalesce(nullif(trim(p_locked_by), ''), 'anonymous'), 160);
  acquired_until timestamptz := now_ts + make_interval(secs => lock_seconds);
  row_lease_until timestamptz;
  row_locked_by text;
begin
  if normalized_kind not in ('quote', 'score', 'fundamentals', 'judgment') then
    raise exception 'invalid refresh lease kind';
  end if;

  if normalized_market not in ('US', 'KR') or normalized_symbol = '' then
    raise exception 'invalid refresh lease target';
  end if;

  if normalized_kind = 'score' and normalized_view is null then
    normalized_view := 'detail';
  end if;

  if normalized_view is not null and normalized_view not in ('detail', 'compare', 'technical') then
    raise exception 'invalid refresh lease view';
  end if;

  if random() < 0.01 then
    delete from public.stock_refresh_leases
    where lease_until < now_ts - interval '1 day';
  end if;

  insert into public.stock_refresh_leases (
    kind,
    market,
    symbol,
    view_mode,
    lease_until,
    locked_by
  )
  values (
    normalized_kind,
    normalized_market,
    normalized_symbol,
    coalesce(normalized_view, ''),
    acquired_until,
    owner
  )
  on conflict (kind, market, symbol, view_mode) do update
    set lease_until = excluded.lease_until,
        locked_by = excluded.locked_by,
        updated_at = now_ts
    where public.stock_refresh_leases.lease_until <= now_ts
  returning public.stock_refresh_leases.lease_until, public.stock_refresh_leases.locked_by
  into row_lease_until, row_locked_by;

  if row_lease_until is not null then
    return query select true, row_lease_until, row_locked_by;
    return;
  end if;

  select leases.lease_until, leases.locked_by
  into row_lease_until, row_locked_by
  from public.stock_refresh_leases leases
  where leases.kind = normalized_kind
    and leases.market = normalized_market
    and leases.symbol = normalized_symbol
    and leases.view_mode = coalesce(normalized_view, '');

  return query select false, row_lease_until, row_locked_by;
end;
$$;
