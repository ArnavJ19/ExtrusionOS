-- EXOS-AUD-016: QC-rejected kg, finishing rejects and returned or damaged
-- shipments never became scrap, remelt input or held stock, and every return
-- credit note copied 100% of the invoice.
--
--   * public.record_material_disposition(source_type, source_id, packing_list_item_id,
--     disposition, weight_kg, pieces, reason) records what happened to rejected or
--     returned material, capped by the rejected / returned quantity:
--       source_type  qc_reject (rejected QC inspection), finishing_reject (finishing
--                    job rejection kg), dispatch_return (one packing row of a
--                    returned, damaged or delivered dispatch)
--       disposition  scrap         -> alloy-tagged foundry scrap lot (painted if finished)
--                    return_to_stock (returns only) -> finished stock batch, origin
--                                   customer_return, on QC hold
--                    rework, scrap_sale, write_off -> recorded
--                    quarantine    -> holding decision, not counted against the cap
--     Roles: owner, admin, quality, factory_manager, production_manager,
--     inventory_manager, dispatch_manager.
--   * public.issue_partial_return_credit_note_atomic(dispatch, packing_list_item_ids,
--     reason, idempotency_key) credits only the invoice lines of the selected packing
--     rows (value + GST at each line's rate). A row can be credited once while its
--     note is issued, and each credited row needs a recorded return disposition.
--     The existing full-dispatch credit note is unchanged; a full note and partial
--     notes cannot both be issued for one dispatch.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.material_dispositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_type text not null check (source_type in ('qc_reject','finishing_reject','dispatch_return')),
  quality_inspection_id uuid references public.quality_inspections(id) on delete restrict,
  finishing_job_id uuid references public.finishing_jobs(id) on delete restrict,
  dispatch_id uuid references public.dispatches(id) on delete restrict,
  packing_list_item_id uuid references public.packing_list_items(id) on delete restrict,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  profile_id uuid references public.aluminium_profiles(id) on delete set null,
  disposition text not null check (disposition in ('quarantine','rework','scrap','return_to_stock','scrap_sale','write_off')),
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  pieces integer check (pieces is null or pieces >= 0),
  foundry_scrap_id uuid references public.foundry_aluminium_scrap(id) on delete set null,
  profile_stock_batch_id uuid references public.profile_stock_batches(id) on delete set null,
  reason text not null check (length(btrim(reason)) >= 5),
  decided_by uuid not null references auth.users(id),
  decided_by_role text not null,
  decided_at timestamptz not null default now(),
  check ((source_type = 'qc_reject' and quality_inspection_id is not null)
    or (source_type = 'finishing_reject' and finishing_job_id is not null)
    or (source_type = 'dispatch_return' and dispatch_id is not null and packing_list_item_id is not null))
);
create index if not exists material_dispositions_company_source_idx on public.material_dispositions(company_id, source_type, decided_at desc);
create index if not exists material_dispositions_packing_idx on public.material_dispositions(company_id, packing_list_item_id);
alter table public.material_dispositions enable row level security;
drop policy if exists "material dispositions tenant read" on public.material_dispositions;
create policy "material dispositions tenant read" on public.material_dispositions
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.material_dispositions from public, anon, authenticated;
grant select on public.material_dispositions to authenticated;

create table if not exists public.credit_note_packing_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  packing_list_item_id uuid not null references public.packing_list_items(id) on delete restrict,
  invoice_item_id uuid not null references public.invoice_items(id) on delete restrict,
  quantity_kg numeric(14,3) not null,
  unit_rate numeric(14,2) not null,
  line_total numeric(14,2) not null,
  gst_percent numeric(7,2) not null,
  tax_amount numeric(14,2) not null,
  unique (credit_note_id, packing_list_item_id)
);
create index if not exists credit_note_packing_lines_company_packing_idx on public.credit_note_packing_lines(company_id, packing_list_item_id);
alter table public.credit_note_packing_lines enable row level security;
drop policy if exists "credit note packing lines tenant read" on public.credit_note_packing_lines;
create policy "credit note packing lines tenant read" on public.credit_note_packing_lines
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.credit_note_packing_lines from public, anon, authenticated;
grant select on public.credit_note_packing_lines to authenticated;

create or replace function private.record_material_disposition(
  p_source_type text, p_source_id uuid, p_packing_list_item_id uuid, p_disposition text,
  p_weight_kg numeric, p_pieces integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_cap numeric;
  v_used numeric;
  v_job uuid;
  v_profile uuid;
  v_finish text;
  v_alloy text;
  v_temper text;
  v_kg numeric := round(coalesce(p_weight_kg, 0), 3);
  v_lot uuid;
  v_stock uuid;
  v_id uuid;
  v_dispatch public.dispatches%rowtype;
  v_packing public.packing_list_items%rowtype;
  v_label text;
  v_kg_m numeric;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','quality','factory_manager','production_manager','inventory_manager','dispatch_manager') then
    raise exception 'Permission denied to disposition rejected or returned material' using errcode = '42501';
  end if;
  if v_kg <= 0 then raise exception 'Give the dispositioned weight' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the disposition reason' using errcode = '23514'; end if;
  if p_disposition not in ('quarantine','rework','scrap','return_to_stock','scrap_sale','write_off') then
    raise exception 'Unknown disposition %', p_disposition using errcode = '23514';
  end if;

  if p_source_type = 'qc_reject' then
    select q.quantity_checked_kg, q.production_job_id, q.profile_id into v_cap, v_job, v_profile
    from public.quality_inspections q where q.id = p_source_id and q.company_id = v_company_id and q.status = 'rejected' for update;
    if not found then raise exception 'Rejected QC inspection not found for this company' using errcode = '23514'; end if;
    select coalesce(sum(weight_kg), 0) into v_used from public.material_dispositions
    where company_id = v_company_id and quality_inspection_id = p_source_id and disposition <> 'quarantine';
    v_label := 'qc_reject';
  elsif p_source_type = 'finishing_reject' then
    select f.rejection_weight_kg, f.production_job_id, f.finishing_type into v_cap, v_job, v_finish
    from public.finishing_jobs f where f.id = p_source_id and f.company_id = v_company_id for update;
    if not found then raise exception 'Finishing job not found for this company' using errcode = '23514'; end if;
    select profile_id into v_profile from public.production_jobs where id = v_job;
    select coalesce(sum(weight_kg), 0) into v_used from public.material_dispositions
    where company_id = v_company_id and finishing_job_id = p_source_id and disposition <> 'quarantine';
    v_label := 'finishing_reject';
  elsif p_source_type = 'dispatch_return' then
    select * into v_dispatch from public.dispatches where id = p_source_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company' using errcode = '23514'; end if;
    if v_dispatch.delivery_status not in ('returned','damaged','delivered') then
      raise exception 'Returned material is dispositioned after the dispatch is delivered, returned or damaged' using errcode = '23514';
    end if;
    select * into v_packing from public.packing_list_items where id = p_packing_list_item_id and company_id = v_company_id and dispatch_id = p_source_id for update;
    if not found then raise exception 'Select a packing row of this dispatch' using errcode = '23514'; end if;
    v_cap := v_packing.net_weight_kg;
    v_profile := v_packing.profile_id;
    v_finish := v_packing.finishing_type;
    if v_packing.source_kind = 'production' then v_job := v_packing.source_line_id; end if;
    select coalesce(sum(weight_kg), 0) into v_used from public.material_dispositions
    where company_id = v_company_id and packing_list_item_id = p_packing_list_item_id and disposition <> 'quarantine';
    v_label := 'returned_goods';
  else
    raise exception 'Unknown disposition source %', p_source_type using errcode = '23514';
  end if;

  if p_disposition <> 'quarantine' and v_kg > coalesce(v_cap, 0) - v_used + 0.001 then
    raise exception 'Only % kg of this material is left to disposition', greatest(coalesce(v_cap, 0) - v_used, 0) using errcode = '23514';
  end if;
  if p_disposition = 'return_to_stock' and p_source_type <> 'dispatch_return' then
    raise exception 'Rejected material cannot go back to sellable stock; use rework, scrap or scrap sale' using errcode = '23514';
  end if;
  if p_disposition = 'write_off' and p_source_type <> 'dispatch_return' then
    raise exception 'Write-off applies to lost or destroyed shipments' using errcode = '23514';
  end if;

  if v_job is not null then
    v_alloy := private.production_job_alloy(v_company_id, v_job);
    if v_finish is null then select finishing_type into v_finish from public.production_jobs where id = v_job; end if;
  end if;
  if v_profile is not null then
    select coalesce(v_alloy, alloy), temper, section_weight_kg_per_m into v_alloy, v_temper, v_kg_m from public.aluminium_profiles where id = v_profile;
  end if;

  if p_disposition = 'scrap' then
    insert into public.foundry_aluminium_scrap(company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status,
      received_date, origin_reference, created_by, alloy, scrap_category)
    values (v_company_id, private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', v_company_id, 'SCR', current_date),
      'in_house', v_kg, v_kg, case when coalesce(v_finish, 'mill_finish') = 'mill_finish' then 'clean' else 'painted' end, 'available', current_date,
      concat('Disposition of ', replace(v_label, '_', ' '), ': ', btrim(p_reason)), auth.uid(), v_alloy, v_label)
    returning id into v_lot;
  elsif p_disposition = 'return_to_stock' then
    insert into public.profile_stock_batches(company_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, bundle_number, location,
      status, origin_type, production_job_id, source_dispatch_id, alloy, temper, qc_status, origin_reference, notes)
    values (v_company_id, v_profile, coalesce(v_finish, 'mill_finish'),
      case when coalesce(v_kg_m, 0) > 0 then round(v_kg / v_kg_m, 3) else coalesce(v_packing.net_length_m, 0) end,
      case when coalesce(p_pieces, 0) > 0 and coalesce(v_kg_m, 0) > 0 then round(v_kg / v_kg_m / p_pieces, 3) end,
      coalesce(nullif(p_pieces, 0), v_packing.number_of_pieces, 0), v_kg, v_packing.bundle_number, 'Returns bay',
      'available', 'customer_return', v_job, p_source_id, v_alloy, v_temper, 'on_hold',
      concat('Returned from dispatch ', v_dispatch.dispatch_number), btrim(p_reason))
    returning id into v_stock;
  end if;

  insert into public.material_dispositions(company_id, source_type, quality_inspection_id, finishing_job_id, dispatch_id, packing_list_item_id,
    production_job_id, profile_id, disposition, weight_kg, pieces, foundry_scrap_id, profile_stock_batch_id, reason, decided_by, decided_by_role)
  values (v_company_id, p_source_type,
    case when p_source_type = 'qc_reject' then p_source_id end,
    case when p_source_type = 'finishing_reject' then p_source_id end,
    case when p_source_type = 'dispatch_return' then p_source_id end,
    case when p_source_type = 'dispatch_return' then p_packing_list_item_id end,
    v_job, v_profile, p_disposition, v_kg, p_pieces, v_lot, v_stock, btrim(p_reason), auth.uid(), v_role)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.record_material_disposition(text, uuid, uuid, text, numeric, integer, text) from public, anon, authenticated;
create or replace function public.record_material_disposition(
  p_source_type text, p_source_id uuid, p_packing_list_item_id uuid, p_disposition text,
  p_weight_kg numeric, p_pieces integer, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.record_material_disposition(p_source_type, p_source_id, p_packing_list_item_id, p_disposition, p_weight_kg, p_pieces, p_reason) $$;
revoke all on function public.record_material_disposition(text, uuid, uuid, text, numeric, integer, text) from public, anon;
grant execute on function public.record_material_disposition(text, uuid, uuid, text, numeric, integer, text) to authenticated;

create or replace function private.issue_partial_return_credit_note_atomic(
  p_dispatch_id uuid, p_packing_list_item_ids uuid[], p_reason text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dispatch public.dispatches%rowtype;
  v_invoice public.invoices%rowtype;
  v_existing public.credit_notes%rowtype;
  v_credit_id uuid;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_items jsonb;
  v_count integer;
  v_ids uuid[];
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for credit notes' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'Credit note idempotency key is required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear return or damage reason'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_packing_list_item_ids, array[]::uuid[])) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Select the returned packing rows to credit'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':dispatch-credit-note:' || p_idempotency_key::text, 0));
  select * into v_existing from public.credit_notes where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.dispatch_id is distinct from p_dispatch_id or trim(v_existing.reason) is distinct from trim(p_reason) then
      raise exception 'This retry key is already used for different credit note details.';
    end if;
    return v_existing.id;
  end if;

  select * into v_dispatch from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  if v_dispatch.delivery_status not in ('returned','damaged','delivered') then
    raise exception 'A return credit note needs a delivered, returned or damaged dispatch';
  end if;
  select * into v_invoice from public.invoices where company_id = v_company_id and dispatch_id = p_dispatch_id and status <> 'cancelled' for update;
  if not found then raise exception 'No issued invoice is linked to this dispatch'; end if;
  if v_invoice.status = 'draft' then raise exception 'Cancel the draft invoice instead of issuing a credit note'; end if;
  if exists (select 1 from public.credit_notes n where n.company_id = v_company_id and n.dispatch_id = p_dispatch_id and n.status = 'issued'
      and not exists (select 1 from public.credit_note_packing_lines l where l.credit_note_id = n.id)) then
    raise exception 'A full credit note is already issued for this dispatch';
  end if;

  select count(*) into v_count from public.invoice_items item
  where item.company_id = v_company_id and item.invoice_id = v_invoice.id and item.source_line_id = any(v_ids);
  if v_count <> cardinality(v_ids) then raise exception 'Every selected packing row must be a line of this dispatch invoice'; end if;
  if exists (select 1 from public.credit_note_packing_lines l join public.credit_notes n on n.id = l.credit_note_id
      where l.company_id = v_company_id and n.status = 'issued' and l.packing_list_item_id = any(v_ids)) then
    raise exception 'One or more selected packing rows are already credited';
  end if;
  if exists (select 1 from unnest(v_ids) pid where not exists (select 1 from public.material_dispositions d
      where d.company_id = v_company_id and d.packing_list_item_id = pid and d.disposition <> 'quarantine')) then
    raise exception 'Record the return disposition (stock, scrap, rework or write-off) of every credited packing row first';
  end if;

  select coalesce(sum(item.line_total), 0), coalesce(sum(round(item.line_total * coalesce(item.gst_percent, 0) / 100.0, 2)), 0),
    coalesce(jsonb_agg(to_jsonb(item) - array['company_id','invoice_id']), '[]'::jsonb)
  into v_subtotal, v_tax, v_items
  from public.invoice_items item where item.company_id = v_company_id and item.invoice_id = v_invoice.id and item.source_line_id = any(v_ids);
  if v_subtotal <= 0 then raise exception 'Selected lines have no value to credit'; end if;
  if (select coalesce(sum(note.grand_total), 0) from public.credit_notes note where note.company_id = v_company_id and note.invoice_id = v_invoice.id and note.status = 'issued')
      + v_subtotal + v_tax > v_invoice.grand_total + 0.05 then
    raise exception 'Credit notes would exceed the invoice total';
  end if;

  insert into public.credit_notes(company_id, invoice_id, dispatch_id, credit_note_number, credit_date, reason, subtotal, tax_total, grand_total,
    item_snapshot, idempotency_key, created_by)
  values (v_company_id, v_invoice.id, p_dispatch_id,
    private.next_business_number_locked('public.credit_notes'::regclass, 'credit_note_number', v_company_id, 'CN', (now() at time zone 'Asia/Kolkata')::date),
    (now() at time zone 'Asia/Kolkata')::date, trim(p_reason), round(v_subtotal, 2), round(v_tax, 2), round(v_subtotal + v_tax, 2),
    v_items, p_idempotency_key, auth.uid())
  returning id into v_credit_id;
  insert into public.credit_note_packing_lines(company_id, credit_note_id, packing_list_item_id, invoice_item_id, quantity_kg, unit_rate, line_total, gst_percent, tax_amount)
  select v_company_id, v_credit_id, item.source_line_id, item.id, item.quantity, item.unit_rate, item.line_total, coalesce(item.gst_percent, 0),
    round(item.line_total * coalesce(item.gst_percent, 0) / 100.0, 2)
  from public.invoice_items item where item.company_id = v_company_id and item.invoice_id = v_invoice.id and item.source_line_id = any(v_ids);

  update public.invoices set credited_amount = (select coalesce(sum(note.grand_total), 0) from public.credit_notes note
      where note.company_id = v_company_id and note.invoice_id = v_invoice.id and note.status = 'issued'), updated_at = now()
  where id = v_invoice.id and company_id = v_company_id;
  perform private.recalculate_invoice_collection_state(v_invoice.id, v_company_id);
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'dispatch_partial_credit_note_issued', 'credit_note', v_credit_id,
    jsonb_build_object('invoice_id', v_invoice.id, 'dispatch_id', p_dispatch_id, 'packing_rows', to_jsonb(v_ids), 'amount', round(v_subtotal + v_tax, 2), 'reason', trim(p_reason)));
  return v_credit_id;
end;
$$;
revoke all on function private.issue_partial_return_credit_note_atomic(uuid, uuid[], text, uuid) from public, anon, authenticated;
create or replace function public.issue_partial_return_credit_note_atomic(p_dispatch_id uuid, p_packing_list_item_ids uuid[], p_reason text, p_idempotency_key uuid)
returns uuid language sql security definer set search_path = public, private
as $$ select private.issue_partial_return_credit_note_atomic(p_dispatch_id, p_packing_list_item_ids, p_reason, p_idempotency_key) $$;
revoke all on function public.issue_partial_return_credit_note_atomic(uuid, uuid[], text, uuid) from public, anon;
grant execute on function public.issue_partial_return_credit_note_atomic(uuid, uuid[], text, uuid) to authenticated;

commit;
