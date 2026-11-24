-- Order lifecycle orchestration: fixes from the review of batches 2 and 3.
--
--   1. Containment at gate-out. The batch 2 guards stop held material from being packed, but a bundle packed onto a
--      pending dispatch before QA opened the containment was never checked again. A dispatch now cannot leave
--      (pending -> any later status) while any of its bundles comes from a production job under open containment,
--      whether the bundle came straight from production or through a stock batch made from that job.
--   2. Finance-held dispatches are kept. The dispatch writer inserts the dispatch and activates it in one transaction,
--      so the batch 3 finance guard rolled the whole dispatch back and accounts never saw it to release. The writer
--      now keeps a dispatch whose payment terms are not yet met as pending (bundles, weights and logistics recorded,
--      stock not consumed); it leaves through the normal pending -> dispatched step once receipts cover it or accounts
--      record a release, and the finance guard still refuses that step until then.
--   3. A revoked approval cannot be dropped by cancelling. Cancelling a containment that still has an open revocation
--      is refused (the revocation needs the factory manager or owner, or a QC reversal), and the detail view no longer
--      offers it.
-- Additive: one new guard; two functions are redefined (the dispatch writer, with the finance check added before
-- activation; the containment command wrapper of Phase 4, with the cancel rule added).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Containment at gate-out
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_dispatch_contained_material(p_company uuid, p_dispatch uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('containment_number', x.containment_number, 'job_number', x.job_number, 'bundles', x.bundles)
  from (select private.olo_job_containment(p_company, src.job_id) containment_number, j.job_number, count(*) bundles
        from (select coalesce(case when p.source_kind = 'production' then p.source_line_id end, b.production_job_id) job_id
              from public.packing_list_items p
              left join public.profile_stock_batches b on b.id = p.profile_stock_batch_id and b.company_id = p.company_id
              where p.company_id = p_company and p.dispatch_id = p_dispatch) src
        join public.production_jobs j on j.id = src.job_id and j.company_id = p_company
        where private.olo_job_containment(p_company, src.job_id) is not null
        group by src.job_id, j.job_number order by j.job_number limit 1) x
$$;

create or replace function private.olo_guard_dispatch_containment() returns trigger language plpgsql security definer set search_path = public, private as $$
declare k jsonb;
begin
  if old.delivery_status <> 'pending' or new.delivery_status = 'pending' then return new; end if;
  k := private.olo_dispatch_contained_material(new.company_id, new.id);
  if k is not null then
    raise exception 'Dispatch % cannot leave: % bundle(s) come from job % under QC containment %. Take those bundles off the dispatch, or wait until QA releases the lot.',
      coalesce(new.dispatch_number, ''), k ->> 'bundles', coalesce(k ->> 'job_number', '-'), k ->> 'containment_number' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.olo_dispatch_contained_material(uuid, uuid), private.olo_guard_dispatch_containment() from public, anon, authenticated;
create trigger b_olo_guard_dispatch_containment before update of delivery_status on public.dispatches for each row execute function private.olo_guard_dispatch_containment();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The dispatch writer keeps a finance-held dispatch as pending (finance check added before activation)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.save_ready_dispatch_atomic(
  p_dispatch_id uuid,
  p_dispatch jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_current record;
  v_payload jsonb := p_dispatch;
  v_dispatch_id uuid;
  v_tare_weight numeric := round(coalesce(nullif(p_dispatch ->> 'total_tare_weight_kg', '')::numeric, 0), 3);
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  if v_tare_weight < 0 then raise exception 'Total tare weight cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dispatch requires at least one physical bundle';
  end if;
  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object('delivery_status', 'pending');
  else
    select order_id, delivery_status into v_current from public.dispatches
    where id = p_dispatch_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    if v_current.delivery_status <> 'pending' then raise exception 'Activated dispatch packing cannot be edited; use the delivery workflow for status and logistics updates'; end if;
    if nullif(v_payload ->> 'order_id', '')::uuid <> v_current.order_id then raise exception 'Dispatch order cannot be changed after creation'; end if;
    v_payload := v_payload || jsonb_build_object('delivery_status', v_current.delivery_status);
  end if;

  v_payload := v_payload || jsonb_build_object('number_of_bundles', jsonb_array_length(p_items));
  v_dispatch_id := private.save_dispatch_atomic(p_dispatch_id, v_payload, p_items, null);
  update public.dispatches set total_tare_weight_kg = v_tare_weight, updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  -- Review fix: a dispatch whose payment terms are not yet met stays pending, so accounts can confirm the payment or
  -- record a release; it leaves through the pending -> dispatched step, where the finance guard checks it again.
  if private.olo_dispatch_clearance(v_company_id, v_dispatch_id) ->> 'state' = 'blocked' then
    return v_dispatch_id;
  end if;
  insert into private.dispatch_activation_authorizations(dispatch_id, transaction_id)
  values (v_dispatch_id, txid_current());
  update public.dispatches set delivery_status = 'dispatched', updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.consume_dispatch_reservations(v_dispatch_id);
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.sync_order_delivery_stage(v_company_id, nullif(v_payload ->> 'order_id', '')::uuid,
    'Dispatch created from exact physical bundles and source-linked stock.');
  return v_dispatch_id;
end;
$$;
revoke all on function private.save_ready_dispatch_atomic(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. An open revocation blocks cancelling the containment
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.quality_containment_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; a jsonb; v_open integer; v_id uuid;
begin
  if p_command = 'cancel' then
    a := private.olo_actor(private.olo_reader_roles());
    begin v_id := (coalesce(p_payload, '{}'::jsonb) ->> 'id')::uuid; exception when others then v_id := null; end;
    -- Same row lock the review and closure commands take, so a revocation cannot be recorded in between.
    perform 1 from public.quality_containments where id = v_id and company_id = (a ->> 'company')::uuid for update;
    select count(*) into v_open from public.containment_prior_reviews r join public.quality_containments c on c.id = r.containment_id
      where c.id = v_id and c.company_id = (a ->> 'company')::uuid and r.outcome = 'revoked' and r.closed_at is null;
    if v_open > 0 then
      raise exception '% revoked earlier approval(s) are still open, so this containment cannot be cancelled. The factory manager or owner closes each revocation with re-verification evidence, or QA reverses the approval.', v_open
        using errcode = '23514';
    end if;
  end if;
  v := private.olo_containment_command_b3(p_command, p_payload);
  if p_command <> 'get' or v is null then return v; end if;
  a := private.olo_actor(private.olo_reader_roles());
  select count(*) into v_open from public.containment_prior_reviews r where r.containment_id = (v ->> 'id')::uuid and r.outcome = 'revoked' and r.closed_at is null;
  return v || jsonb_build_object('reversals', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reversal_number', r.reversal_number, 'inspection_id', r.quality_inspection_id,
      'reversed_kg', r.reversed_kg, 'retained_kg', r.retained_kg, 'reversed_as', r.reversed_as, 'reversed_at', r.reversed_at) order by r.reversed_at), '[]'::jsonb)
    from public.quality_reversals r join public.quality_containments c on c.id = (v ->> 'id')::uuid
    where r.company_id = (a ->> 'company')::uuid and r.production_job_id = c.production_job_id),
    'can_reverse', (a ->> 'role') in ('owner','quality') and v ->> 'status' in ('open','partially_resolved'),
    'can_cancel', coalesce((v ->> 'can_cancel')::boolean, false) and v_open = 0, 'open_revocations', v_open);
end;
$$;
revoke all on function public.quality_containment_command(text, jsonb) from public, anon;
grant execute on function public.quality_containment_command(text, jsonb) to authenticated;

commit;
