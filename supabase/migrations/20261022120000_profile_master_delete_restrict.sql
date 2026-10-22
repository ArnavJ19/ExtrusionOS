-- EXOS-AUD2-006: deleting a profile master cascaded into finished-goods stock
-- batches, stock reservations, stock consumptions, QC inspections, dispatch packing
-- rows and specification-change approvals. An owner/admin delete of a profile with
-- 696 kg of released stock silently erased the stock and an order's reservation.
--
-- Transactional and evidence rows now block the delete (NO ACTION is checked at the
-- end of the statement, so a tenant offboarding cascade that removes both sides in
-- one statement still works). Configuration children (defect rules, quality plans,
-- routing steps) keep cascading with their profile. A profile in use is deactivated,
-- not deleted; the guard below says so instead of a raw foreign-key error.
begin;
set local lock_timeout = '5s';

alter table public.profile_stock_batches drop constraint if exists profile_stock_batches_profile_id_fkey;
alter table public.profile_stock_batches add constraint profile_stock_batches_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.profile_stock_batches validate constraint profile_stock_batches_profile_id_fkey;

alter table public.profile_stock_reservations drop constraint if exists profile_stock_reservations_profile_id_fkey;
alter table public.profile_stock_reservations add constraint profile_stock_reservations_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.profile_stock_reservations validate constraint profile_stock_reservations_profile_id_fkey;

alter table public.profile_stock_consumptions drop constraint if exists profile_stock_consumptions_profile_id_fkey;
alter table public.profile_stock_consumptions add constraint profile_stock_consumptions_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.profile_stock_consumptions validate constraint profile_stock_consumptions_profile_id_fkey;

alter table public.quality_inspections drop constraint if exists quality_inspections_profile_id_fkey;
alter table public.quality_inspections add constraint quality_inspections_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.quality_inspections validate constraint quality_inspections_profile_id_fkey;

alter table public.packing_list_items drop constraint if exists packing_list_items_profile_id_fkey;
alter table public.packing_list_items add constraint packing_list_items_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.packing_list_items validate constraint packing_list_items_profile_id_fkey;

alter table public.profile_spec_change_approvals drop constraint if exists profile_spec_change_approvals_profile_id_fkey;
alter table public.profile_spec_change_approvals add constraint profile_spec_change_approvals_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.profile_spec_change_approvals validate constraint profile_spec_change_approvals_profile_id_fkey;

alter table public.material_dispositions drop constraint if exists material_dispositions_profile_id_fkey;
alter table public.material_dispositions add constraint material_dispositions_profile_id_fkey
  foreign key (profile_id) references public.aluminium_profiles(id) not valid;
alter table public.material_dispositions validate constraint material_dispositions_profile_id_fkey;

create or replace function private.guard_profile_master_delete()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_ref record;
  v_found boolean;
begin
  if auth.uid() is null then
    return old;
  end if;
  for v_ref in
    select * from (values
      ('profile_stock_batches', 'finished-goods stock'),
      ('profile_stock_reservations', 'stock reservations'),
      ('profile_stock_consumptions', 'stock consumption history'),
      ('quality_inspections', 'QC inspections'),
      ('packing_list_items', 'dispatch packing rows'),
      ('material_dispositions', 'material dispositions'),
      ('profile_spec_change_approvals', 'specification approvals'),
      ('order_items', 'order lines'),
      ('quote_items', 'quote lines'),
      ('production_jobs', 'production jobs'),
      ('invoice_items', 'invoice lines'),
      ('dies', 'dies')
    ) as refs(table_name, label)
  loop
    execute format('select exists (select 1 from public.%I where company_id = $1 and profile_id = $2)', v_ref.table_name)
      into v_found using old.company_id, old.id;
    if v_found then
      raise exception 'Profile % has %; deactivate it instead of deleting it', old.profile_code, v_ref.label
        using errcode = '23503';
    end if;
  end loop;
  return old;
end;
$$;

revoke all on function private.guard_profile_master_delete() from public, anon, authenticated;

drop trigger if exists a_guard_profile_master_delete on public.aluminium_profiles;
create trigger a_guard_profile_master_delete
before delete on public.aluminium_profiles
for each row execute function private.guard_profile_master_delete();

commit;
