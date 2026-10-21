-- EXOS-AUD-029: metal receipts had no plausibility limit (a live ingot receipt
-- is 100,000,000 kg; two scrap receipts are 1,000,000 kg each).
--
--   * company_settings.metal_receipt_max_kg (default 60,000 kg, roughly two
--     truckloads) caps a single vendor receipt of ingot/external aluminium,
--     purchased scrap and outsourced billets.
--   * company_settings.metal_receipt_weighbridge_threshold_kg (default
--     10,000 kg): a receipt at or above it needs a weighbridge slip reference
--     (new weighbridge_reference column on the three receipt tables).
--   * Process scrap created in-house by the completion workflow is exempt.
-- Only inserts and weight changes are checked, so existing rows are untouched;
-- the oversized live rows are reconciled separately.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.company_settings
  add column if not exists metal_receipt_max_kg numeric(14,3) not null default 60000,
  add column if not exists metal_receipt_weighbridge_threshold_kg numeric(14,3) not null default 10000;
alter table public.company_settings drop constraint if exists company_settings_metal_receipt_limits;
alter table public.company_settings add constraint company_settings_metal_receipt_limits
  check (metal_receipt_max_kg > 0 and metal_receipt_weighbridge_threshold_kg > 0
    and metal_receipt_weighbridge_threshold_kg <= metal_receipt_max_kg);

alter table public.foundry_external_aluminium_sources add column if not exists weighbridge_reference text;
alter table public.foundry_aluminium_scrap add column if not exists weighbridge_reference text;
alter table public.outsourced_billet_batches add column if not exists weighbridge_reference text;

create or replace function private.enforce_metal_receipt_plausibility()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_max numeric;
  v_threshold numeric;
begin
  if tg_table_name = 'foundry_aluminium_scrap' and coalesce(to_jsonb(new) ->> 'scrap_source', '') = 'in_house' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.weight_kg is not distinct from old.weight_kg
    and new.weighbridge_reference is not distinct from old.weighbridge_reference then
    return new;
  end if;
  select coalesce(s.metal_receipt_max_kg, 60000), coalesce(s.metal_receipt_weighbridge_threshold_kg, 10000)
    into v_max, v_threshold
  from public.company_settings s where s.company_id = new.company_id;
  v_max := coalesce(v_max, 60000);
  v_threshold := coalesce(v_threshold, 10000);
  if coalesce(new.weight_kg, 0) > v_max then
    raise exception 'Receipt of % kg exceeds the company limit of % kg per receipt; split it or ask the owner to raise the limit', new.weight_kg, v_max
      using errcode = '23514';
  end if;
  if coalesce(new.weight_kg, 0) >= v_threshold and nullif(btrim(coalesce(new.weighbridge_reference, '')), '') is null then
    raise exception 'Receipts of % kg or more need a weighbridge slip reference', v_threshold using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_metal_receipt_plausibility() from public, anon, authenticated;

drop trigger if exists a_metal_receipt_plausibility on public.foundry_external_aluminium_sources;
create trigger a_metal_receipt_plausibility before insert or update of weight_kg, weighbridge_reference on public.foundry_external_aluminium_sources
  for each row execute function private.enforce_metal_receipt_plausibility();
drop trigger if exists a_metal_receipt_plausibility on public.foundry_aluminium_scrap;
create trigger a_metal_receipt_plausibility before insert or update of weight_kg, weighbridge_reference on public.foundry_aluminium_scrap
  for each row execute function private.enforce_metal_receipt_plausibility();
drop trigger if exists a_metal_receipt_plausibility on public.outsourced_billet_batches;
create trigger a_metal_receipt_plausibility before insert or update of weight_kg, weighbridge_reference on public.outsourced_billet_batches
  for each row execute function private.enforce_metal_receipt_plausibility();

commit;
