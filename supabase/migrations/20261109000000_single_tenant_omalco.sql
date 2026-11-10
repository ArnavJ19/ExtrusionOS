-- ExtrusionOS is a single-company deployment: Omalco Extrusion only.
-- Additive guard: the schema keeps company_id + RLS, but only ONE company row may ever exist.

create or replace function private.enforce_single_company()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if exists (select 1 from public.companies) then
    raise exception 'This workspace is dedicated to Omalco Extrusion; additional companies cannot be created'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_single_company() from public, anon, authenticated;

drop trigger if exists trg_enforce_single_company on public.companies;
create trigger trg_enforce_single_company
  before insert on public.companies
  for each row execute function private.enforce_single_company();
