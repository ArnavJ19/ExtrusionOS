begin;

create or replace function private.validate_production_job_source_line()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order_line public.order_items%rowtype;
  v_has_order_lines boolean;
  v_requires_billets boolean;
begin
  if tg_op = 'UPDATE'
     and old.status not in ('planned', 'ready')
     and (
       old.order_id is distinct from new.order_id
       or old.profile_id is distinct from new.profile_id
       or old.source_line_id is distinct from new.source_line_id
     ) then
    raise exception 'Production lineage cannot change after the job leaves planning'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.order_items item
    where item.company_id = new.company_id
      and item.order_id = new.order_id
  ) into v_has_order_lines;

  if v_has_order_lines and new.source_line_id is null then
    raise exception 'Select the exact order line before planning production'
      using errcode = '23514';
  end if;

  if new.source_line_id is not null then
    select * into v_order_line
    from public.order_items item
    where item.id = new.source_line_id
      and item.company_id = new.company_id
      and item.order_id = new.order_id;

    if not found or v_order_line.profile_id is distinct from new.profile_id then
      raise exception 'Production source line must belong to the selected order and profile'
        using errcode = '23514';
    end if;
  end if;

  new.source_record_id := new.order_id;

  if new.status = 'in_progress'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select exists (
      select 1
      from public.order_billet_requirements requirement
      where requirement.company_id = new.company_id
        and requirement.order_id = new.order_id
        and requirement.profile_id = new.profile_id
        and requirement.status <> 'cancelled'
        and requirement.billets_required > 0
    ) into v_requires_billets;

    if v_requires_billets and not exists (
      select 1
      from public.foundry_billets billet
      where billet.company_id = new.company_id
        and billet.order_id = new.order_id
        and billet.production_job_id = new.id
        and billet.status in ('issued', 'consumed')
    ) then
      raise exception 'Link at least one allocated billet before starting production'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists production_job_source_line_guard on public.production_jobs;
create trigger production_job_source_line_guard
before insert or update of company_id, order_id, profile_id, source_line_id, source_record_id, status
on public.production_jobs
for each row execute function private.validate_production_job_source_line();

revoke all on function private.validate_production_job_source_line() from public, anon, authenticated;

commit;
