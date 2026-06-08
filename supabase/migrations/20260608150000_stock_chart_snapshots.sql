create table if not exists public.stock_chart_snapshots (
  ticker text not null,
  market text not null default 'US' check (market in ('US', 'KR')),
  symbol text not null,
  source text not null default 'kis',
  payload jsonb not null,
  last_bar_date date,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stale_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint stock_chart_snapshots_expiry_order check (expires_at <= stale_expires_at),
  constraint stock_chart_snapshots_retention check (stale_expires_at <= fetched_at + interval '180 days'),
  primary key (ticker, source)
);

create unique index if not exists stock_chart_snapshots_market_symbol_source_idx
on public.stock_chart_snapshots (market, symbol, source);

create index if not exists stock_chart_snapshots_expires_at_idx
on public.stock_chart_snapshots (expires_at);

create index if not exists stock_chart_snapshots_stale_expires_at_idx
on public.stock_chart_snapshots (stale_expires_at);

drop trigger if exists set_stock_chart_snapshots_updated_at
on public.stock_chart_snapshots;

create trigger set_stock_chart_snapshots_updated_at
before update on public.stock_chart_snapshots
for each row
execute function public.set_updated_at();

alter table public.stock_chart_snapshots enable row level security;

drop policy if exists "stock_chart_snapshots_public_select" on public.stock_chart_snapshots;

create policy "stock_chart_snapshots_public_select"
on public.stock_chart_snapshots
for select
to anon
using (true);

revoke insert, update on table public.stock_chart_snapshots from anon;
grant select on table public.stock_chart_snapshots to anon;
grant select, insert, update on table public.stock_chart_snapshots to service_role;

alter table public.stock_refresh_jobs
drop constraint if exists stock_refresh_jobs_kind_check;

alter table public.stock_refresh_jobs
add constraint stock_refresh_jobs_kind_check
check (kind in ('quote', 'score', 'chart', 'fundamentals', 'judgment'));

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

  if p_kind is null or p_kind not in ('quote', 'score', 'chart', 'fundamentals', 'judgment') then
    raise exception 'invalid refresh kind';
  end if;

  if p_market is null or p_market not in ('US', 'KR') or p_symbol is null or p_symbol = '' then
    raise exception 'invalid refresh target';
  end if;

  if p_kind = 'score' and p_view_mode is null then
    p_view_mode := 'detail';
  end if;

  if p_kind <> 'score' then
    p_view_mode := null;
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
    'public.stock_chart_snapshots',
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
  required_rpc_signatures jsonb := jsonb_build_array(
    jsonb_build_object('name', 'claim_stock_refresh_jobs', 'identity_arguments', 'p_worker_id text, p_limit integer, p_lock_seconds integer'),
    jsonb_build_object('name', 'claim_stock_refresh_jobs_by_kind', 'identity_arguments', 'p_worker_id text, p_kind text, p_limit integer, p_lock_seconds integer'),
    jsonb_build_object('name', 'complete_stock_refresh_job', 'identity_arguments', 'p_job_id uuid, p_worker_id text'),
    jsonb_build_object('name', 'fail_stock_refresh_job', 'identity_arguments', 'p_job_id uuid, p_worker_id text, p_error text, p_retry_after_seconds integer, p_permanent boolean')
  );
  missing_tables text[];
  missing_rpcs text[];
  missing_rpc_signatures text[];
  missing_rpc_grants text[];
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

  select coalesce(array_agg(item.name || '(' || item.identity_arguments || ')'), '{}'::text[])
  into missing_rpc_signatures
  from jsonb_to_recordset(required_rpc_signatures) as item(name text, identity_arguments text)
  where not exists (
    select 1
    from pg_proc proc
    join pg_namespace ns
      on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname = item.name
      and pg_get_function_identity_arguments(proc.oid) = item.identity_arguments
  );

  select coalesce(array_agg(item.name || '(' || item.identity_arguments || ')'), '{}'::text[])
  into missing_rpc_grants
  from jsonb_to_recordset(required_rpc_signatures) as item(name text, identity_arguments text)
  join pg_proc proc
    on proc.proname = item.name
   and pg_get_function_identity_arguments(proc.oid) = item.identity_arguments
  join pg_namespace ns
    on ns.oid = proc.pronamespace
   and ns.nspname = 'public'
  where not has_function_privilege('service_role', proc.oid, 'EXECUTE');

  return jsonb_build_object(
    'ok',
    coalesce(array_length(missing_tables, 1), 0) = 0
      and coalesce(array_length(missing_rpcs, 1), 0) = 0
      and coalesce(array_length(missing_rpc_signatures, 1), 0) = 0
      and coalesce(array_length(missing_rpc_grants, 1), 0) = 0,
    'checked_at', now(),
    'required_tables', required_tables,
    'required_rpcs', required_rpcs,
    'required_rpc_signatures', required_rpc_signatures,
    'missing_tables', missing_tables,
    'missing_rpcs', missing_rpcs,
    'missing_rpc_signatures', missing_rpc_signatures,
    'missing_rpc_grants', missing_rpc_grants
  );
end;
$$;

revoke all on function public.enqueue_stock_refresh_job(text, text, text, text, integer, timestamptz, jsonb) from public;
revoke all on function public.claim_stock_refresh_jobs_by_kind(text, text, integer, integer) from public;
revoke all on function public.stock_runtime_readiness() from public;

grant execute on function public.enqueue_stock_refresh_job(text, text, text, text, integer, timestamptz, jsonb) to service_role;
grant execute on function public.claim_stock_refresh_jobs_by_kind(text, text, integer, integer) to service_role;
grant execute on function public.stock_runtime_readiness() to service_role;
