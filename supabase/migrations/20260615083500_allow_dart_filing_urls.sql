alter table public.sec_filings
  drop constraint if exists sec_filings_source_url_check;

alter table public.sec_filings
  add constraint sec_filings_source_url_check
  check (
    source_url is null
    or source_url like 'https://www.sec.gov/%'
    or source_url like 'https://dart.fss.or.kr/%'
  );
