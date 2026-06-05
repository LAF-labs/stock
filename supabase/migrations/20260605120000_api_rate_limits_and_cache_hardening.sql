create table if not exists public.stock_api_rate_limits (
  bucket text not null,
  identity_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, identity_key)
);

create index if not exists stock_api_rate_limits_expires_at_idx
on public.stock_api_rate_limits (expires_at);

alter table public.stock_api_rate_limits enable row level security;

revoke all on table public.stock_api_rate_limits from public;
grant select, insert, update, delete on table public.stock_api_rate_limits to service_role;

create or replace function public.acquire_stock_api_rate_limit(
  p_bucket text,
  p_identity_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  current_count integer;
  current_reset timestamptz;
begin
  if p_bucket is null or p_bucket = '' or p_identity_key is null or p_identity_key = '' or p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'invalid rate limit request';
  end if;

  if random() < 0.01 then
    delete from public.stock_api_rate_limits
    where expires_at < now_ts - interval '1 day';
  end if;

  insert into public.stock_api_rate_limits (bucket, identity_key, window_start, request_count, expires_at)
  values (p_bucket, p_identity_key, now_ts, 1, now_ts + make_interval(secs => p_window_seconds))
  on conflict (bucket, identity_key) do update
    set window_start = case
          when public.stock_api_rate_limits.expires_at <= now_ts then now_ts
          else public.stock_api_rate_limits.window_start
        end,
        request_count = case
          when public.stock_api_rate_limits.expires_at <= now_ts then 1
          else public.stock_api_rate_limits.request_count + 1
        end,
        expires_at = case
          when public.stock_api_rate_limits.expires_at <= now_ts then now_ts + make_interval(secs => p_window_seconds)
          else public.stock_api_rate_limits.expires_at
        end,
        updated_at = now_ts
  returning public.stock_api_rate_limits.request_count, public.stock_api_rate_limits.expires_at
  into current_count, current_reset;

  return query select current_count <= p_limit, greatest(0, p_limit - current_count), current_reset;
end;
$$;

revoke all on function public.acquire_stock_api_rate_limit(text, text, integer, integer) from public;
grant execute on function public.acquire_stock_api_rate_limit(text, text, integer, integer) to service_role;

drop policy if exists "stock_score_snapshots_public_select" on public.stock_score_snapshots;
drop policy if exists "stock_fundamental_snapshots_public_select" on public.stock_fundamental_snapshots;
drop policy if exists "stock_quote_snapshots_public_select" on public.stock_quote_snapshots;
drop policy if exists "stock_ai_judgments_public_select" on public.stock_ai_judgments;

revoke select on table public.stock_score_snapshots from anon;
revoke select on table public.stock_fundamental_snapshots from anon;
revoke select on table public.stock_quote_snapshots from anon;
revoke select on table public.stock_ai_judgments from anon;

grant select, insert, update on table public.stock_score_snapshots to service_role;
grant select, insert, update on table public.stock_fundamental_snapshots to service_role;
grant select, insert, update on table public.stock_quote_snapshots to service_role;
grant select, insert, update, delete on table public.stock_ai_judgments to service_role;
