-- R19 local candidate only; not applied. Requires the reconciled prerequisite chain.
begin;

-- Material stock triggers own movement writes; browser roles retain tenant-scoped reads.
revoke insert,update,delete on table public.packaging_material_movements from public,anon,authenticated;
revoke insert(id,company_id,packaging_job_id,material_id,movement_type,quantity,created_by,created_at),
  update(id,company_id,packaging_job_id,material_id,movement_type,quantity,created_by,created_at)
  on table public.packaging_material_movements from public,anon,authenticated;
drop policy if exists "packaging movements tenant insert" on public.packaging_material_movements;

create index if not exists packaging_material_movements_job_company_idx
  on public.packaging_material_movements(packaging_job_id,company_id);
create index if not exists packaging_job_materials_job_company_idx
  on public.packaging_job_materials(job_id,company_id);

create or replace function private.guard_packaging_evidence_delete()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if old.production_job_id is not null then
    perform 1 from public.production_jobs where id=old.production_job_id and company_id=old.company_id for update nowait;
  end if;
  if old.status in ('completed','cancelled')
    or exists(select 1 from public.packaging_material_movements where packaging_job_id=old.id)
    or exists(select 1 from public.packaging_job_materials where job_id=old.id)
    or (old.production_job_id is not null and exists(select 1 from public.packing_list_items where company_id=old.company_id and source_line_id=old.production_job_id)) then
    raise exception 'Packaging with terminal, material or packing evidence cannot be deleted; retain its recorded history' using errcode='23514';
  end if;
  return old;
exception when lock_not_available then
  raise exception 'Production material is being updated; refresh and retry packaging maintenance' using errcode='55P03';
end;
$$;

create or replace function private.guard_packaging_material_movement_evidence()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  raise exception 'Packaging material movements are append-only; retain the posted evidence' using errcode='23514';
end;
$$;

drop trigger if exists guard_packaging_evidence_delete on public.packaging_jobs;
create trigger guard_packaging_evidence_delete before delete on public.packaging_jobs
  for each row execute function private.guard_packaging_evidence_delete();
drop trigger if exists guard_packaging_material_movement_evidence on public.packaging_material_movements;
create trigger guard_packaging_material_movement_evidence before update or delete on public.packaging_material_movements
  for each row execute function private.guard_packaging_material_movement_evidence();

revoke all on function private.guard_packaging_evidence_delete(),private.guard_packaging_material_movement_evidence(),
  public.apply_packaging_material_stock_from_materials(),public.handle_packaging_job_status_change() from public,anon,authenticated;
commit;
