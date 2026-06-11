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
