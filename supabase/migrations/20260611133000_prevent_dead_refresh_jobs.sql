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
  set status = 'queued',
      locked_by = null,
      locked_at = null,
      locked_until = null,
      run_after = now(),
      max_attempts = greatest(jobs.max_attempts, jobs.attempts + 1),
      completed_at = null,
      last_error = coalesce(jobs.last_error, 'worker lock expired'),
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

create or replace function public.claim_stock_refresh_jobs_by_kind(
  p_worker_id text,
  p_kind text,
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
  refresh_kind text := lower(trim(coalesce(p_kind, '')));
begin
  if p_worker_id is null or trim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;

  if refresh_kind not in ('quote', 'score', 'chart') then
    raise exception 'invalid refresh kind';
  end if;

  update public.stock_refresh_jobs jobs
  set status = 'queued',
      locked_by = null,
      locked_at = null,
      locked_until = null,
      run_after = now(),
      max_attempts = greatest(jobs.max_attempts, jobs.attempts + 1),
      completed_at = null,
      last_error = coalesce(jobs.last_error, 'worker lock expired'),
      updated_at = now()
  where jobs.status = 'running'
    and jobs.kind = refresh_kind
    and coalesce(jobs.locked_until, jobs.locked_at + interval '15 minutes') <= now();

  return query
  with next_jobs as (
    select id
    from public.stock_refresh_jobs
    where status = 'queued'
      and kind = refresh_kind
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

create or replace function public.fail_stock_refresh_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_after_seconds integer default 300,
  p_permanent boolean default false
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
  set status = case when coalesce(p_permanent, false) then 'failed' else 'queued' end,
      run_after = case when coalesce(p_permanent, false) then jobs.run_after else now() + make_interval(secs => retry_seconds) end,
      max_attempts = case
        when coalesce(p_permanent, false) then jobs.max_attempts
        else greatest(jobs.max_attempts, jobs.attempts + 1)
      end,
      locked_by = null,
      locked_at = null,
      locked_until = null,
      last_error = left(coalesce(p_error, 'refresh failed'), 1000),
      completed_at = case when coalesce(p_permanent, false) then now() else null end,
      updated_at = now()
  where jobs.id = p_job_id
    and jobs.status = 'running'
    and jobs.locked_by = p_worker_id
  returning * into result;

  return result;
end;
$$;

update public.stock_refresh_jobs jobs
set status = 'queued',
    run_after = now(),
    max_attempts = greatest(jobs.max_attempts, jobs.attempts + 1),
    completed_at = null,
    updated_at = now()
where jobs.status = 'dead'
  and not (
    lower(coalesce(jobs.last_error, '')) like '%invalid_ticker%'
    or lower(coalesce(jobs.last_error, '')) like '%unsupported refresh job kind%'
    or lower(coalesce(jobs.last_error, '')) like '%unsupported score view%'
  );

update public.stock_refresh_jobs jobs
set status = 'failed',
    completed_at = coalesce(jobs.completed_at, now()),
    updated_at = now()
where jobs.status = 'dead';

update public.stock_refresh_jobs jobs
set max_attempts = jobs.attempts + 1,
    updated_at = now()
where jobs.status in ('queued', 'running')
  and jobs.attempts >= jobs.max_attempts;

revoke all on function public.claim_stock_refresh_jobs(text, integer, integer) from public;
revoke all on function public.claim_stock_refresh_jobs_by_kind(text, text, integer, integer) from public;
revoke all on function public.fail_stock_refresh_job(uuid, text, text, integer, boolean) from public;

grant execute on function public.claim_stock_refresh_jobs(text, integer, integer) to service_role;
grant execute on function public.claim_stock_refresh_jobs_by_kind(text, text, integer, integer) to service_role;
grant execute on function public.fail_stock_refresh_job(uuid, text, text, integer, boolean) to service_role;
