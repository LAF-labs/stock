create table if not exists public.kis_access_tokens (
  cache_key text primary key,
  access_token text,
  expires_at timestamptz,
  issued_at timestamptz,
  locked_until timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kis_access_tokens_cache_key_check check (cache_key ~ '^[a-f0-9]{16,64}$'),
  constraint kis_access_tokens_token_expiry_pair_check check (
    (access_token is null and expires_at is null)
    or
    (access_token is not null and expires_at is not null)
  )
);

create index if not exists kis_access_tokens_expires_at_idx
on public.kis_access_tokens (expires_at);

create index if not exists kis_access_tokens_locked_until_idx
on public.kis_access_tokens (locked_until);

drop trigger if exists set_kis_access_tokens_updated_at
on public.kis_access_tokens;

create trigger set_kis_access_tokens_updated_at
before update on public.kis_access_tokens
for each row
execute function public.set_updated_at();

alter table public.kis_access_tokens enable row level security;

revoke all on table public.kis_access_tokens from public;
grant select, insert, update, delete on table public.kis_access_tokens to service_role;

create or replace function public.acquire_kis_token_issue_lock(
  p_cache_key text,
  p_lock_seconds integer default 30,
  p_locked_by text default null
)
returns table(acquired boolean, locked_until timestamptz, locked_by text)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  normalized_cache_key text := lower(trim(coalesce(p_cache_key, '')));
  lock_seconds integer := least(greatest(coalesce(p_lock_seconds, 30), 5), 300);
  owner text := left(coalesce(nullif(trim(p_locked_by), ''), 'anonymous'), 160);
  acquired_until timestamptz := now_ts + make_interval(secs => lock_seconds);
  row_locked_until timestamptz;
  row_locked_by text;
begin
  if normalized_cache_key !~ '^[a-f0-9]{16,64}$' then
    raise exception 'invalid KIS token cache key';
  end if;

  if random() < 0.01 then
    delete from public.kis_access_tokens
    where coalesce(expires_at, '-infinity'::timestamptz) < now_ts - interval '7 days'
      and coalesce(locked_until, '-infinity'::timestamptz) < now_ts;
  end if;

  insert into public.kis_access_tokens (
    cache_key,
    locked_until,
    locked_by
  )
  values (
    normalized_cache_key,
    acquired_until,
    owner
  )
  on conflict (cache_key) do update
    set locked_until = excluded.locked_until,
        locked_by = excluded.locked_by,
        updated_at = now_ts
    where coalesce(public.kis_access_tokens.expires_at, '-infinity'::timestamptz) <= now_ts + interval '5 minutes'
      and coalesce(public.kis_access_tokens.locked_until, '-infinity'::timestamptz) <= now_ts
  returning public.kis_access_tokens.locked_until, public.kis_access_tokens.locked_by
  into row_locked_until, row_locked_by;

  if row_locked_until is not null then
    return query select true, row_locked_until, row_locked_by;
    return;
  end if;

  select tokens.locked_until, tokens.locked_by
  into row_locked_until, row_locked_by
  from public.kis_access_tokens tokens
  where tokens.cache_key = normalized_cache_key;

  return query select false, row_locked_until, row_locked_by;
end;
$$;

revoke all on function public.acquire_kis_token_issue_lock(text, integer, text) from public;
grant execute on function public.acquire_kis_token_issue_lock(text, integer, text) to service_role;
