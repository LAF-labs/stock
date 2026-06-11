create table if not exists public.stock_refresh_targets (
  market text not null check (market in ('US', 'KR')),
  symbol text not null,
  ticker text not null,
  exchange text,
  instrument_type text not null default 'UNKNOWN',
  enabled boolean not null default true,
  tier text not null default 'cold_stock' check (tier in ('hot', 'warm', 'cold_stock', 'etf', 'inactive')),
  quote_interval_seconds integer check (quote_interval_seconds is null or quote_interval_seconds >= 300),
  score_detail_interval_seconds integer check (score_detail_interval_seconds is null or score_detail_interval_seconds >= 900),
  score_compare_interval_seconds integer check (score_compare_interval_seconds is null or score_compare_interval_seconds >= 900),
  score_technical_interval_seconds integer check (score_technical_interval_seconds is null or score_technical_interval_seconds >= 900),
  chart_interval_seconds integer check (chart_interval_seconds is null or chart_interval_seconds >= 900),
  quote_priority integer not null default 80,
  score_detail_priority integer not null default 90,
  score_compare_priority integer not null default 95,
  score_technical_priority integer not null default 85,
  chart_priority integer not null default 90,
  source text not null default 'symbol_master',
  metadata jsonb not null default '{}'::jsonb,
  last_planned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market, symbol),
  constraint stock_refresh_targets_ticker_check check (ticker = market || ':' || symbol)
);

create index if not exists stock_refresh_targets_enabled_tier_idx
on public.stock_refresh_targets (enabled, tier, market, symbol);

create index if not exists stock_refresh_targets_quote_due_idx
on public.stock_refresh_targets (enabled, quote_priority, market, symbol)
where quote_interval_seconds is not null;

create index if not exists stock_refresh_targets_score_due_idx
on public.stock_refresh_targets (enabled, score_detail_priority, score_compare_priority, score_technical_priority, market, symbol)
where score_detail_interval_seconds is not null
   or score_compare_interval_seconds is not null
   or score_technical_interval_seconds is not null;

drop trigger if exists set_stock_refresh_targets_updated_at
on public.stock_refresh_targets;

create trigger set_stock_refresh_targets_updated_at
before update on public.stock_refresh_targets
for each row
execute function public.set_updated_at();

alter table public.stock_refresh_targets enable row level security;

revoke all on table public.stock_refresh_targets from public;
grant select, insert, update, delete on table public.stock_refresh_targets to service_role;

create or replace function public.plan_stock_refresh_jobs(
  p_kind text default 'all',
  p_limit integer default 50,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refresh_kind text := lower(trim(coalesce(p_kind, 'all')));
  plan_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  inserted_count integer := 0;
  candidate_count integer := 0;
  by_kind jsonb := '{}'::jsonb;
begin
  if refresh_kind not in ('all', 'quote', 'score', 'chart') then
    raise exception 'invalid refresh planner kind';
  end if;

  create temporary table if not exists pg_temp.stock_refresh_plan_candidates (
    kind text not null,
    market text not null,
    symbol text not null,
    view_mode text,
    priority integer not null,
    due_at timestamptz not null,
    interval_seconds integer not null,
    snapshot_fetched_at timestamptz,
    reason text not null
  ) on commit drop;

  truncate table pg_temp.stock_refresh_plan_candidates;

  if refresh_kind in ('all', 'quote') then
    insert into pg_temp.stock_refresh_plan_candidates (
      kind,
      market,
      symbol,
      view_mode,
      priority,
      due_at,
      interval_seconds,
      snapshot_fetched_at,
      reason
    )
    select
      'quote',
      targets.market,
      targets.symbol,
      null,
      targets.quote_priority,
      coalesce(quotes.stale_expires_at, quotes.fetched_at + make_interval(secs => targets.quote_interval_seconds), '-infinity'::timestamptz),
      targets.quote_interval_seconds,
      quotes.fetched_at,
      case when quotes.ticker is null then 'target_quote_missing' else 'target_quote_stale' end
    from public.stock_refresh_targets targets
    left join public.stock_quote_snapshots quotes
      on quotes.ticker = targets.market || ':' || targets.symbol
    where targets.enabled
      and targets.quote_interval_seconds is not null
      and (
        quotes.ticker is null
        or quotes.fetched_at <= p_now - make_interval(secs => targets.quote_interval_seconds)
        or quotes.stale_expires_at <= p_now
      );
  end if;

  if refresh_kind in ('all', 'score') then
    insert into pg_temp.stock_refresh_plan_candidates (
      kind,
      market,
      symbol,
      view_mode,
      priority,
      due_at,
      interval_seconds,
      snapshot_fetched_at,
      reason
    )
    select
      'score',
      targets.market,
      targets.symbol,
      lanes.view_mode,
      lanes.priority,
      coalesce(scores.expires_at, scores.fetched_at + make_interval(secs => lanes.interval_seconds), '-infinity'::timestamptz),
      lanes.interval_seconds,
      scores.fetched_at,
      case when scores.ticker is null then 'target_score_missing' else 'target_score_stale' end
    from public.stock_refresh_targets targets
    cross join lateral (
      values
        ('detail'::text, targets.score_detail_interval_seconds, targets.score_detail_priority),
        ('compare'::text, targets.score_compare_interval_seconds, targets.score_compare_priority),
        ('technical'::text, targets.score_technical_interval_seconds, targets.score_technical_priority)
    ) as lanes(view_mode, interval_seconds, priority)
    left join public.stock_score_snapshots scores
      on scores.ticker = targets.market || ':' || targets.symbol
     and scores.view_mode = lanes.view_mode
    where targets.enabled
      and lanes.interval_seconds is not null
      and (
        scores.ticker is null
        or scores.fetched_at <= p_now - make_interval(secs => lanes.interval_seconds)
        or scores.expires_at <= p_now
      );
  end if;

  if refresh_kind in ('all', 'chart') then
    insert into pg_temp.stock_refresh_plan_candidates (
      kind,
      market,
      symbol,
      view_mode,
      priority,
      due_at,
      interval_seconds,
      snapshot_fetched_at,
      reason
    )
    select
      'chart',
      targets.market,
      targets.symbol,
      null,
      targets.chart_priority,
      coalesce(charts.stale_expires_at, charts.fetched_at + make_interval(secs => targets.chart_interval_seconds), '-infinity'::timestamptz),
      targets.chart_interval_seconds,
      charts.fetched_at,
      case when charts.ticker is null then 'target_chart_missing' else 'target_chart_stale' end
    from public.stock_refresh_targets targets
    left join public.stock_chart_snapshots charts
      on charts.ticker = targets.market || ':' || targets.symbol
    where targets.enabled
      and targets.chart_interval_seconds is not null
      and (
        charts.ticker is null
        or charts.fetched_at <= p_now - make_interval(secs => targets.chart_interval_seconds)
        or charts.stale_expires_at <= p_now
      );
  end if;

  select count(*) into candidate_count from pg_temp.stock_refresh_plan_candidates;

  with ranked as (
    select *
    from pg_temp.stock_refresh_plan_candidates
    where not exists (
      select 1
      from public.stock_refresh_jobs jobs
      where jobs.status in ('queued', 'running')
        and jobs.kind = stock_refresh_plan_candidates.kind
        and jobs.market = stock_refresh_plan_candidates.market
        and jobs.symbol = stock_refresh_plan_candidates.symbol
        and coalesce(jobs.view_mode, '') = coalesce(stock_refresh_plan_candidates.view_mode, '')
    )
    order by priority asc, due_at asc, market asc, symbol asc, view_mode asc nulls first
    limit plan_limit
  ),
  inserted as (
    insert into public.stock_refresh_jobs (
      kind,
      market,
      symbol,
      view_mode,
      priority,
      run_after,
      payload
    )
    select
      ranked.kind,
      ranked.market,
      ranked.symbol,
      ranked.view_mode,
      ranked.priority,
      p_now,
      jsonb_build_object(
        'reason', ranked.reason,
        'reason_bucket', ranked.reason,
        'requested_ticker', ranked.market || ':' || ranked.symbol,
        'target_interval_seconds', ranked.interval_seconds,
        'snapshot_fetched_at', ranked.snapshot_fetched_at
      )
    from ranked
    on conflict do nothing
    returning kind, market, symbol
  ),
  touched as (
    update public.stock_refresh_targets targets
    set last_planned_at = p_now,
        updated_at = p_now
    from inserted
    where targets.market = inserted.market
      and targets.symbol = inserted.symbol
    returning inserted.kind
  )
  select
    coalesce(sum(jobs), 0),
    coalesce(jsonb_object_agg(kind, jobs), '{}'::jsonb)
  into inserted_count, by_kind
  from (
    select kind, count(*) as jobs
    from touched
    group by kind
  ) grouped;

  return jsonb_build_object(
    'ok', true,
    'kind', refresh_kind,
    'limit', plan_limit,
    'candidates', candidate_count,
    'inserted', coalesce(inserted_count, 0),
    'by_kind', coalesce(by_kind, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.plan_stock_refresh_jobs(text, integer, timestamptz) from public;
grant execute on function public.plan_stock_refresh_jobs(text, integer, timestamptz) to service_role;

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
