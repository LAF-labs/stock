alter table public.stock_score_snapshots
  add column if not exists score_model_version text
  generated always as (
    coalesce(
      payload ->> 'score_model_version',
      payload #>> '{sia_snapshot,score_model_version}',
      'legacy'
    )
  ) stored;

comment on column public.stock_score_snapshots.score_model_version
is 'Score model version extracted from the cached JSON payload. Used for rollout audits and legacy snapshot cleanup.';

create index if not exists stock_score_snapshots_model_version_idx
on public.stock_score_snapshots (score_model_version, expires_at desc);
