alter table public.stock_fundamental_snapshots
drop constraint if exists stock_fundamental_snapshots_retention;

alter table public.stock_fundamental_snapshots
add constraint stock_fundamental_snapshots_retention
check (stale_expires_at <= fetched_at + interval '180 days');
