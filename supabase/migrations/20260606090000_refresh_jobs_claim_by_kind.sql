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

  if refresh_kind not in ('quote', 'score') then
    raise exception 'invalid refresh kind';
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

revoke all on function public.claim_stock_refresh_jobs_by_kind(text, text, integer, integer) from public;
grant execute on function public.claim_stock_refresh_jobs_by_kind(text, text, integer, integer) to service_role;

create or replace function public.stock_runtime_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  required_tables text[] := array[
    'public.stock_score_snapshots',
    'public.stock_quote_snapshots',
    'public.stock_refresh_jobs',
    'public.stock_api_rate_limits',
    'public.stock_refresh_leases',
    'public.stock_refresh_cooldowns',
    'public.stock_rule_judgments',
    'public.stock_industry_benchmarks',
    'public.stock_symbol_profiles',
    'public.market_calendar',
    'public.kis_access_tokens'
  ];
  required_rpcs text[] := array[
    'acquire_stock_api_rate_limit',
    'acquire_stock_refresh_cooldown',
    'acquire_stock_refresh_lease',
    'enqueue_stock_refresh_job',
    'claim_stock_refresh_jobs',
    'claim_stock_refresh_jobs_by_kind',
    'complete_stock_refresh_job',
    'fail_stock_refresh_job',
    'refresh_stock_industry_benchmarks',
    'acquire_kis_token_issue_lock'
  ];
  missing_tables text[];
  missing_rpcs text[];
begin
  select coalesce(array_agg(item.name), '{}'::text[])
  into missing_tables
  from unnest(required_tables) as item(name)
  where to_regclass(item.name) is null;

  select coalesce(array_agg(item.name), '{}'::text[])
  into missing_rpcs
  from unnest(required_rpcs) as item(name)
  where not exists (
    select 1
    from pg_proc proc
    join pg_namespace ns
      on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname = item.name
  );

  return jsonb_build_object(
    'ok',
    coalesce(array_length(missing_tables, 1), 0) = 0
      and coalesce(array_length(missing_rpcs, 1), 0) = 0,
    'checked_at', now(),
    'required_tables', required_tables,
    'required_rpcs', required_rpcs,
    'missing_tables', missing_tables,
    'missing_rpcs', missing_rpcs
  );
end;
$$;

revoke all on function public.stock_runtime_readiness() from public;
grant execute on function public.stock_runtime_readiness() to service_role;
