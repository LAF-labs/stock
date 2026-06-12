create unique index if not exists stock_symbol_industry_tags_one_primary_finviz_level_idx
on public.stock_symbol_industry_tags (market, symbol, taxonomy, level)
where taxonomy = 'finviz_canonical'
  and is_primary;
