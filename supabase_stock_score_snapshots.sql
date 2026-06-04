create table if not exists public.stock_score_snapshots (
  ticker text not null,
  view_mode text not null check (view_mode in ('detail', 'compare')),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (ticker, view_mode)
);

create index if not exists stock_score_snapshots_expires_at_idx
on public.stock_score_snapshots (expires_at);

create or replace function public.set_stock_score_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_stock_score_snapshots_updated_at
on public.stock_score_snapshots;

create trigger set_stock_score_snapshots_updated_at
before update on public.stock_score_snapshots
for each row
execute function public.set_stock_score_snapshots_updated_at();

alter table public.stock_score_snapshots enable row level security;

drop policy if exists "stock_score_snapshots_public_select" on public.stock_score_snapshots;
drop policy if exists "stock_score_snapshots_public_insert" on public.stock_score_snapshots;
drop policy if exists "stock_score_snapshots_public_update" on public.stock_score_snapshots;

create policy "stock_score_snapshots_public_select"
on public.stock_score_snapshots
for select
to anon
using (true);

revoke insert, update on table public.stock_score_snapshots from anon;
grant select on table public.stock_score_snapshots to anon;
grant select, insert, update on table public.stock_score_snapshots to service_role;
