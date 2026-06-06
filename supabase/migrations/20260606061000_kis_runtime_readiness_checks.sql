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
