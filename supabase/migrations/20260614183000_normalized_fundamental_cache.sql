alter table if exists public.stock_fundamental_snapshots
  add column if not exists provider text,
  add column if not exists source_filing_id text,
  add column if not exists period_end date,
  add column if not exists fiscal_year integer,
  add column if not exists fiscal_period text,
  add column if not exists report_type text,
  add column if not exists currency text,
  add column if not exists is_consolidated boolean,
  add column if not exists normalized_facts jsonb not null default '{}'::jsonb,
  add column if not exists coverage jsonb not null default '{}'::jsonb,
  add column if not exists raw_ref jsonb not null default '{}'::jsonb,
  add column if not exists accepted_at timestamptz;

create index if not exists stock_fundamental_snapshots_normalized_idx
on public.stock_fundamental_snapshots (market, symbol, period_end desc, fetched_at desc)
where normalized_facts <> '{}'::jsonb;

create table if not exists public.stock_fundamental_latest (
  market text not null default 'US',
  symbol text not null,
  provider text not null default 'unknown',
  source text not null,
  source_filing_id text,
  period_end date,
  fiscal_year integer,
  fiscal_period text,
  report_type text,
  currency text,
  is_consolidated boolean,
  normalized_facts jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  raw_ref jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stale_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint stock_fundamental_latest_expiry_order check (expires_at <= stale_expires_at),
  constraint stock_fundamental_latest_ticker_check check (market <> '' and symbol <> ''),
  primary key (market, symbol)
);

create index if not exists stock_fundamental_latest_expires_at_idx
on public.stock_fundamental_latest (expires_at);

create index if not exists stock_fundamental_latest_period_idx
on public.stock_fundamental_latest (market, symbol, period_end desc, fetched_at desc);

drop trigger if exists set_stock_fundamental_latest_updated_at
on public.stock_fundamental_latest;

create trigger set_stock_fundamental_latest_updated_at
before update on public.stock_fundamental_latest
for each row
execute function public.set_stock_fundamental_snapshots_updated_at();

alter table public.stock_fundamental_latest enable row level security;

drop policy if exists stock_fundamental_latest_public_select on public.stock_fundamental_latest;

create policy stock_fundamental_latest_public_select
on public.stock_fundamental_latest
for select
to anon, authenticated
using (true);

revoke insert, update, delete on table public.stock_fundamental_latest from anon, authenticated;
grant select on table public.stock_fundamental_latest to anon, authenticated;
grant select, insert, update, delete on table public.stock_fundamental_latest to service_role;

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
    'public.stock_refresh_targets',
    'public.stock_api_rate_limits',
    'public.stock_refresh_leases',
    'public.stock_refresh_cooldowns',
    'public.stock_rule_judgments',
    'public.stock_industry_benchmarks',
    'public.stock_symbol_profiles',
    'public.stock_fundamental_latest',
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
    'plan_stock_refresh_jobs',
    'refresh_stock_industry_benchmarks',
    'acquire_kis_token_issue_lock'
  ];
  required_rpc_signatures jsonb := jsonb_build_array(
    jsonb_build_object('name', 'claim_stock_refresh_jobs', 'identity_arguments', 'p_worker_id text, p_limit integer, p_lock_seconds integer'),
    jsonb_build_object('name', 'claim_stock_refresh_jobs_by_kind', 'identity_arguments', 'p_worker_id text, p_kind text, p_limit integer, p_lock_seconds integer'),
    jsonb_build_object('name', 'complete_stock_refresh_job', 'identity_arguments', 'p_job_id uuid, p_worker_id text'),
    jsonb_build_object('name', 'fail_stock_refresh_job', 'identity_arguments', 'p_job_id uuid, p_worker_id text, p_error text, p_retry_after_seconds integer, p_permanent boolean'),
    jsonb_build_object('name', 'plan_stock_refresh_jobs', 'identity_arguments', 'p_kind text, p_limit integer, p_now timestamp with time zone')
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

revoke all on function public.stock_runtime_readiness() from public;
grant execute on function public.stock_runtime_readiness() to service_role;
