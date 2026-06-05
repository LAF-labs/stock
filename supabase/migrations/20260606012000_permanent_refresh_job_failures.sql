drop function if exists public.fail_stock_refresh_job(uuid, text, text, integer);

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
  set status = case when coalesce(p_permanent, false) or jobs.attempts >= jobs.max_attempts then 'dead' else 'queued' end,
      run_after = case when coalesce(p_permanent, false) or jobs.attempts >= jobs.max_attempts then jobs.run_after else now() + make_interval(secs => retry_seconds) end,
      locked_by = null,
      locked_at = null,
      locked_until = null,
      last_error = left(coalesce(p_error, 'refresh failed'), 1000),
      completed_at = case when coalesce(p_permanent, false) or jobs.attempts >= jobs.max_attempts then now() else null end,
      updated_at = now()
  where jobs.id = p_job_id
    and jobs.status = 'running'
    and jobs.locked_by = p_worker_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.fail_stock_refresh_job(uuid, text, text, integer, boolean) from public;
grant execute on function public.fail_stock_refresh_job(uuid, text, text, integer, boolean) to service_role;
