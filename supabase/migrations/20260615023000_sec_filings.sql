create table if not exists public.sec_filings (
  ticker text not null,
  symbol text not null,
  cik text not null,
  accession_number text primary key,
  form_type text not null,
  company_name text not null,
  filed_at timestamptz not null,
  accepted_at timestamptz,
  summary_ko text not null,
  source_url text not null,
  category text not null default 'other',
  importance text not null default 'medium'
    check (importance in ('low', 'medium', 'high')),
  tags text[] not null default '{}'::text[],
  facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_filings_ticker_check check (ticker <> '' and symbol <> '' and cik <> ''),
  constraint sec_filings_source_url_check check (source_url like 'https://www.sec.gov/%')
);

create index if not exists sec_filings_ticker_filed_at_idx
on public.sec_filings (ticker, filed_at desc);

create index if not exists sec_filings_cik_filed_at_idx
on public.sec_filings (cik, filed_at desc);

drop trigger if exists set_sec_filings_updated_at
on public.sec_filings;

create trigger set_sec_filings_updated_at
before update on public.sec_filings
for each row
execute function public.set_updated_at();

alter table public.sec_filings enable row level security;

drop policy if exists sec_filings_public_select on public.sec_filings;

create policy sec_filings_public_select
on public.sec_filings
for select
to anon, authenticated
using (true);

revoke insert, update, delete on table public.sec_filings from anon, authenticated;
grant select on table public.sec_filings to anon, authenticated;
grant select, insert, update, delete on table public.sec_filings to service_role;
