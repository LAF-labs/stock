delete from public.stock_industry_benchmarks
where expires_at <= now();
