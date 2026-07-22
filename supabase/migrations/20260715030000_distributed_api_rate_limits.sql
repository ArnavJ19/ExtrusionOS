-- Shared rate limiting for sensitive API routes in multi-instance deployments.
-- Only the server-side service role can invoke the function.

create schema if not exists private;

create table if not exists private.api_rate_limits (
  identifier text primary key,
  request_count integer not null check (request_count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limits_reset_at_idx
  on private.api_rate_limits (reset_at);

revoke all on table private.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_identifier text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  current_entry private.api_rate_limits%rowtype;
  current_time timestamptz := clock_timestamp();
begin
  if length(trim(coalesce(p_identifier, ''))) = 0
    or p_limit < 1
    or p_window_seconds < 1
    or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;

  if random() < 0.01 then
    delete from private.api_rate_limits
    where reset_at < current_time - interval '1 day';
  end if;

  insert into private.api_rate_limits (identifier, request_count, reset_at, updated_at)
  values (p_identifier, 0, current_time + make_interval(secs => p_window_seconds), current_time)
  on conflict (identifier) do nothing;

  select * into current_entry
  from private.api_rate_limits
  where identifier = p_identifier
  for update;

  if current_entry.reset_at <= current_time then
    update private.api_rate_limits
    set request_count = 1,
        reset_at = current_time + make_interval(secs => p_window_seconds),
        updated_at = current_time
    where identifier = p_identifier
    returning * into current_entry;
  elsif current_entry.request_count >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'resetAt', (extract(epoch from current_entry.reset_at) * 1000)::bigint
    );
  else
    update private.api_rate_limits
    set request_count = request_count + 1,
        updated_at = current_time
    where identifier = p_identifier
    returning * into current_entry;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_limit - current_entry.request_count, 0),
    'resetAt', (extract(epoch from current_entry.reset_at) * 1000)::bigint
  );
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
