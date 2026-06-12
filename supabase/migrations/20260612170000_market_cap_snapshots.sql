create table if not exists public.market_cap_snapshots (
  scope text primary key check (scope in ('all', 'domestic', 'overseas')),
  payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists market_cap_snapshots_expires_at_idx
  on public.market_cap_snapshots (expires_at);

alter table public.market_cap_snapshots enable row level security;

drop policy if exists "market_cap_snapshots_public_read" on public.market_cap_snapshots;
create policy "market_cap_snapshots_public_read"
  on public.market_cap_snapshots
  for select
  using (true);

drop policy if exists "market_cap_snapshots_service_role_write" on public.market_cap_snapshots;
create policy "market_cap_snapshots_service_role_write"
  on public.market_cap_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
