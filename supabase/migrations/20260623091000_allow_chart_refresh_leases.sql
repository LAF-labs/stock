alter table public.stock_refresh_leases
drop constraint if exists stock_refresh_leases_kind_check;

alter table public.stock_refresh_leases
add constraint stock_refresh_leases_kind_check
check (kind in ('quote', 'score', 'chart', 'fundamentals', 'judgment'));

create or replace function public.acquire_stock_refresh_lease(
  p_kind text,
  p_market text,
  p_symbol text,
  p_view_mode text default null,
  p_lock_seconds integer default 30,
  p_locked_by text default null
)
returns table(acquired boolean, lease_until timestamptz, locked_by text)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  normalized_kind text := lower(trim(coalesce(p_kind, '')));
  normalized_market text := upper(trim(coalesce(p_market, '')));
  normalized_symbol text := upper(trim(coalesce(p_symbol, '')));
  normalized_view text := nullif(lower(trim(coalesce(p_view_mode, ''))), '');
  lock_seconds integer := least(greatest(coalesce(p_lock_seconds, 30), 5), 300);
  owner text := left(coalesce(nullif(trim(p_locked_by), ''), 'anonymous'), 160);
  acquired_until timestamptz := now_ts + make_interval(secs => lock_seconds);
  row_lease_until timestamptz;
  row_locked_by text;
begin
  if normalized_kind not in ('quote', 'score', 'chart', 'fundamentals', 'judgment') then
    raise exception 'invalid refresh lease kind';
  end if;

  if normalized_market not in ('US', 'KR') or normalized_symbol = '' then
    raise exception 'invalid refresh lease target';
  end if;

  if normalized_kind = 'score' and normalized_view is null then
    normalized_view := 'detail';
  end if;

  if normalized_kind <> 'score' then
    normalized_view := null;
  end if;

  if normalized_view is not null and normalized_view not in ('detail', 'compare', 'technical') then
    raise exception 'invalid refresh lease view';
  end if;

  if random() < 0.01 then
    delete from public.stock_refresh_leases
    where lease_until < now_ts - interval '1 day';
  end if;

  insert into public.stock_refresh_leases (
    kind,
    market,
    symbol,
    view_mode,
    lease_until,
    locked_by
  )
  values (
    normalized_kind,
    normalized_market,
    normalized_symbol,
    coalesce(normalized_view, ''),
    acquired_until,
    owner
  )
  on conflict (kind, market, symbol, view_mode) do update
    set lease_until = excluded.lease_until,
        locked_by = excluded.locked_by,
        updated_at = now_ts
    where public.stock_refresh_leases.lease_until <= now_ts
  returning public.stock_refresh_leases.lease_until, public.stock_refresh_leases.locked_by
  into row_lease_until, row_locked_by;

  if row_lease_until is not null then
    return query select true, row_lease_until, row_locked_by;
    return;
  end if;

  select leases.lease_until, leases.locked_by
  into row_lease_until, row_locked_by
  from public.stock_refresh_leases leases
  where leases.kind = normalized_kind
    and leases.market = normalized_market
    and leases.symbol = normalized_symbol
    and leases.view_mode = coalesce(normalized_view, '');

  return query select false, row_lease_until, row_locked_by;
end;
$$;

revoke all on function public.acquire_stock_refresh_lease(text, text, text, text, integer, text) from public;
grant execute on function public.acquire_stock_refresh_lease(text, text, text, text, integer, text) to service_role;
