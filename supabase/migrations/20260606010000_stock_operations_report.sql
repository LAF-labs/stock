create or replace function public.stock_operations_report(
  p_score_stale_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_hours integer := least(greatest(coalesce(p_score_stale_hours, 24), 1), 168);
  result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now(),
    'refresh_queue', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'kind', grouped.kind,
          'status', grouped.status,
          'jobs', grouped.jobs,
          'oldest_created_at', grouped.oldest_created_at,
          'oldest_run_after', grouped.oldest_run_after,
          'stale_running_jobs', grouped.stale_running_jobs
        )
        order by grouped.kind, grouped.status
      )
      from (
        select
          kind,
          status,
          count(*)::integer as jobs,
          min(created_at) as oldest_created_at,
          min(run_after) as oldest_run_after,
          count(*) filter (
            where status = 'running'
              and coalesce(locked_until, locked_at + interval '15 minutes') <= now()
          )::integer as stale_running_jobs
        from public.stock_refresh_jobs
        where created_at >= now() - interval '14 days'
        group by kind, status
      ) grouped
    ), '[]'::jsonb),
    'score_snapshots', jsonb_build_object(
      'total', (
        select count(*)::integer
        from public.stock_score_snapshots
        where view_mode = 'detail'
      ),
      'stale', (
        select count(*)::integer
        from public.stock_score_snapshots
        where view_mode = 'detail'
          and (
            expires_at <= now()
            or fetched_at <= now() - make_interval(hours => stale_hours)
          )
      ),
      'by_model', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'score_model_version', coalesce(score_model_version, 'missing'),
            'snapshots', snapshots,
            'newest_fetched_at', newest_fetched_at
          )
          order by newest_fetched_at desc nulls last
        )
        from (
          select
            score_model_version,
            count(*)::integer as snapshots,
            max(fetched_at) as newest_fetched_at
          from public.stock_score_snapshots
          where view_mode = 'detail'
          group by score_model_version
        ) models
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.stock_operations_report(integer) from public;
grant execute on function public.stock_operations_report(integer) to service_role;
