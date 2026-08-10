-- Billet audit M4: close the scrap recovery loop. Production completion records extrusion
-- process loss into public.scrap_records ('process_scrap'), but that in-house scrap never
-- re-entered the foundry charge inventory (foundry_aluminium_scrap), so it was invisible to
-- the furnace mix / recovery workflow. This additive trigger creates a matching in-house
-- foundry scrap intake (clean, available) for every process-scrap record, so recovered metal
-- flows back into the melt inventory with full traceability to the originating job.

create or replace function public.sync_process_scrap_to_foundry()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(new.scrap_type, '') = 'process_scrap' and coalesce(new.weight_kg, 0) > 0 then
    insert into public.foundry_aluminium_scrap (
      company_id, scrap_number, scrap_source, weight_kg, available_weight_kg,
      scrap_quality, status, received_date, origin_reference, created_by
    ) values (
      new.company_id,
      private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', new.company_id, 'SCR', current_date),
      'in_house',
      new.weight_kg,
      new.weight_kg,
      'clean',
      'available',
      coalesce(new.recorded_date, current_date),
      concat('Process scrap from production job ', coalesce(new.production_job_id::text, new.id::text)),
      new.recorded_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sync_process_scrap_to_foundry on public.scrap_records;
create trigger sync_process_scrap_to_foundry
  after insert on public.scrap_records
  for each row execute function public.sync_process_scrap_to_foundry();

revoke all on function public.sync_process_scrap_to_foundry() from public, anon, authenticated;
