grant usage on schema public to anon, authenticated;

alter table if exists public.stock_score_snapshots enable row level security;
drop policy if exists stock_score_snapshots_public_select on public.stock_score_snapshots;
create policy stock_score_snapshots_public_select
on public.stock_score_snapshots
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_score_snapshots from anon, authenticated;
grant select on table public.stock_score_snapshots to anon, authenticated;
grant select, insert, update, delete on table public.stock_score_snapshots to service_role;

alter table if exists public.stock_quote_snapshots enable row level security;
drop policy if exists stock_quote_snapshots_public_select on public.stock_quote_snapshots;
create policy stock_quote_snapshots_public_select
on public.stock_quote_snapshots
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_quote_snapshots from anon, authenticated;
grant select on table public.stock_quote_snapshots to anon, authenticated;
grant select, insert, update, delete on table public.stock_quote_snapshots to service_role;

alter table if exists public.stock_fundamental_snapshots enable row level security;
drop policy if exists stock_fundamental_snapshots_public_select on public.stock_fundamental_snapshots;
create policy stock_fundamental_snapshots_public_select
on public.stock_fundamental_snapshots
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_fundamental_snapshots from anon, authenticated;
grant select on table public.stock_fundamental_snapshots to anon, authenticated;
grant select, insert, update, delete on table public.stock_fundamental_snapshots to service_role;

alter table if exists public.market_calendar enable row level security;
drop policy if exists market_calendar_public_select on public.market_calendar;
create policy market_calendar_public_select
on public.market_calendar
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.market_calendar from anon, authenticated;
grant select on table public.market_calendar to anon, authenticated;
grant select, insert, update, delete on table public.market_calendar to service_role;

alter table if exists public.stock_industry_benchmarks enable row level security;
drop policy if exists stock_industry_benchmarks_public_select on public.stock_industry_benchmarks;
create policy stock_industry_benchmarks_public_select
on public.stock_industry_benchmarks
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_industry_benchmarks from anon, authenticated;
grant select on table public.stock_industry_benchmarks to anon, authenticated;
grant select, insert, update, delete on table public.stock_industry_benchmarks to service_role;

alter table if exists public.stock_symbol_profiles enable row level security;
drop policy if exists stock_symbol_profiles_public_select on public.stock_symbol_profiles;
create policy stock_symbol_profiles_public_select
on public.stock_symbol_profiles
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_symbol_profiles from anon, authenticated;
grant select on table public.stock_symbol_profiles to anon, authenticated;
grant select, insert, update, delete on table public.stock_symbol_profiles to service_role;

alter table if exists public.stock_symbol_industry_tags enable row level security;
drop policy if exists stock_symbol_industry_tags_public_select on public.stock_symbol_industry_tags;
create policy stock_symbol_industry_tags_public_select
on public.stock_symbol_industry_tags
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_symbol_industry_tags from anon, authenticated;
grant select on table public.stock_symbol_industry_tags to anon, authenticated;
grant select, insert, update, delete on table public.stock_symbol_industry_tags to service_role;

alter table if exists public.industry_taxonomy_map enable row level security;
drop policy if exists industry_taxonomy_map_public_select on public.industry_taxonomy_map;
create policy industry_taxonomy_map_public_select
on public.industry_taxonomy_map
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.industry_taxonomy_map from anon, authenticated;
grant select on table public.industry_taxonomy_map to anon, authenticated;
grant select, insert, update, delete on table public.industry_taxonomy_map to service_role;

alter table if exists public.stock_rule_judgments enable row level security;
drop policy if exists stock_rule_judgments_public_select on public.stock_rule_judgments;
create policy stock_rule_judgments_public_select
on public.stock_rule_judgments
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_rule_judgments from anon, authenticated;
grant select on table public.stock_rule_judgments to anon, authenticated;
grant select, insert, update, delete on table public.stock_rule_judgments to service_role;

alter table if exists public.stock_ai_judgments enable row level security;
drop policy if exists stock_ai_judgments_public_select on public.stock_ai_judgments;
create policy stock_ai_judgments_public_select
on public.stock_ai_judgments
for select
to anon, authenticated
using (true);
revoke insert, update, delete on table public.stock_ai_judgments from anon, authenticated;
grant select on table public.stock_ai_judgments to anon, authenticated;
grant select, insert, update, delete on table public.stock_ai_judgments to service_role;

grant execute on function public.search_stock_symbols(text, integer, text) to anon, authenticated;
