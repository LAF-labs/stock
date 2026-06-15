create table if not exists public.admin_page_views (
  id uuid primary key default gen_random_uuid(),
  visitor_key text not null,
  ticker text,
  path text not null,
  user_agent text,
  occurred_at timestamptz not null default now()
);

create index if not exists admin_page_views_occurred_at_idx
on public.admin_page_views (occurred_at desc);

create index if not exists admin_page_views_ticker_occurred_at_idx
on public.admin_page_views (ticker, occurred_at desc)
where ticker is not null;

alter table public.admin_page_views enable row level security;

revoke all on table public.admin_page_views from public;
grant select, insert, delete on table public.admin_page_views to service_role;
