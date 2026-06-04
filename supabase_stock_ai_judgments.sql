create table if not exists public.stock_ai_judgments (
  ticker text not null,
  cache_date date not null,
  model text not null,
  judgment jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticker, cache_date, model)
);

alter table public.stock_ai_judgments add column if not exists model text;
alter table public.stock_ai_judgments add column if not exists updated_at timestamptz not null default now();
update public.stock_ai_judgments set model = 'legacy' where model is null;
alter table public.stock_ai_judgments alter column model set not null;

alter table public.stock_ai_judgments drop constraint if exists stock_ai_judgments_pkey;
alter table public.stock_ai_judgments add primary key (ticker, cache_date, model);

create index if not exists stock_ai_judgments_cache_date_idx
on public.stock_ai_judgments (cache_date);

create or replace function public.set_stock_ai_judgments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_stock_ai_judgments_updated_at
on public.stock_ai_judgments;

create trigger set_stock_ai_judgments_updated_at
before update on public.stock_ai_judgments
for each row
execute function public.set_stock_ai_judgments_updated_at();

alter table public.stock_ai_judgments enable row level security;

drop policy if exists "stock_ai_judgments_public_select" on public.stock_ai_judgments;
drop policy if exists "stock_ai_judgments_public_insert" on public.stock_ai_judgments;
drop policy if exists "stock_ai_judgments_public_update" on public.stock_ai_judgments;
drop policy if exists "stock_ai_judgments_public_delete" on public.stock_ai_judgments;

create policy "stock_ai_judgments_public_select"
on public.stock_ai_judgments
for select
to anon
using (true);

revoke insert, update, delete on table public.stock_ai_judgments from anon;
grant select on table public.stock_ai_judgments to anon;
grant select, insert, update, delete on table public.stock_ai_judgments to service_role;
