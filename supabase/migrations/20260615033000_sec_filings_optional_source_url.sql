alter table public.sec_filings
  alter column source_url drop not null;

alter table public.sec_filings
  drop constraint if exists sec_filings_source_url_check;

alter table public.sec_filings
  add constraint sec_filings_source_url_check
  check (source_url is null or source_url like 'https://www.sec.gov/%');
