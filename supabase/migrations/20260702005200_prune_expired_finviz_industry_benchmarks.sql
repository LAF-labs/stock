delete from public.stock_industry_benchmarks
where source = 'finviz_industry'
  and expires_at <= now();
