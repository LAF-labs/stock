alter table public.stock_refresh_jobs
add column if not exists locked_until timestamptz;

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

drop function if exists public.claim_stock_refresh_jobs(text, integer);

create or replace function public.claim_stock_refresh_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lock_seconds integer default 900
)
returns setof public.stock_refresh_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  lock_seconds integer := least(greatest(coalesce(p_lock_seconds, 900), 60), 3600);
begin
  if p_worker_id is null or trim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;

  update public.stock_refresh_jobs jobs
  set status = case when jobs.attempts >= jobs.max_attempts then 'dead' else 'queued' end,
      locked_by = null,
      locked_at = null,
      locked_until = null,
      run_after = case when jobs.attempts >= jobs.max_attempts then jobs.run_after else now() end,
      completed_at = case when jobs.attempts >= jobs.max_attempts then now() else null end,
      updated_at = now()
  where jobs.status = 'running'
    and coalesce(jobs.locked_until, jobs.locked_at + interval '15 minutes') <= now();

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
      locked_until = now() + make_interval(secs => lock_seconds),
      attempts = jobs.attempts + 1,
      updated_at = now()
  from next_jobs
  where jobs.id = next_jobs.id
  returning jobs.*;
end;
$$;

create or replace function public.complete_stock_refresh_job(
  p_job_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.stock_refresh_jobs
  set status = 'succeeded',
      locked_by = null,
      locked_at = null,
      locked_until = null,
      last_error = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and locked_by = p_worker_id;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.fail_stock_refresh_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_after_seconds integer default 300
)
returns public.stock_refresh_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.stock_refresh_jobs;
  retry_seconds integer := least(greatest(coalesce(p_retry_after_seconds, 300), 60), 86400);
begin
  update public.stock_refresh_jobs jobs
  set status = case when jobs.attempts >= jobs.max_attempts then 'dead' else 'queued' end,
      run_after = case when jobs.attempts >= jobs.max_attempts then jobs.run_after else now() + make_interval(secs => retry_seconds) end,
      locked_by = null,
      locked_at = null,
      locked_until = null,
      last_error = left(coalesce(p_error, 'refresh failed'), 1000),
      completed_at = case when jobs.attempts >= jobs.max_attempts then now() else null end,
      updated_at = now()
  where jobs.id = p_job_id
    and jobs.status = 'running'
    and jobs.locked_by = p_worker_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.enqueue_stock_refresh_job(text, text, text, text, integer, timestamptz, jsonb) from public;
revoke all on function public.claim_stock_refresh_jobs(text, integer, integer) from public;
revoke all on function public.complete_stock_refresh_job(uuid, text) from public;
revoke all on function public.fail_stock_refresh_job(uuid, text, text, integer) from public;

grant execute on function public.enqueue_stock_refresh_job(text, text, text, text, integer, timestamptz, jsonb) to service_role;
grant execute on function public.claim_stock_refresh_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_stock_refresh_job(uuid, text) to service_role;
grant execute on function public.fail_stock_refresh_job(uuid, text, text, integer) to service_role;
