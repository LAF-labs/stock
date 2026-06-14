create table if not exists public.sec_filing_backfill_state (
  job_id text primary key default 'default',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  since date not null,
  cursor integer not null default 0,
  total_tickers integer not null default 0,
  batch_size integer not null default 40,
  max_filings_per_ticker integer not null default 80,
  fetch_doc_limit integer not null default 40,
  processed_tickers integer not null default 0,
  rows_upserted integer not null default 0,
  skipped_tickers integer not null default 0,
  doc_fetches integer not null default 0,
  company_facts_fetches integer not null default 0,
  locked_by text,
  locked_until timestamptz,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_sec_filing_backfill_state_updated_at
on public.sec_filing_backfill_state;

create trigger set_sec_filing_backfill_state_updated_at
before update on public.sec_filing_backfill_state
for each row
execute function public.set_updated_at();

alter table public.sec_filing_backfill_state enable row level security;

revoke all on table public.sec_filing_backfill_state from anon, authenticated;
grant select, insert, update, delete on table public.sec_filing_backfill_state to service_role;
