-- Order lifecycle orchestration, Phase 4 (directive section 19; Phase 3 section G open items).
--
--   * QC reversal: QA corrects an earlier approval that turned out wrong. The approval itself is never edited: it is
--     marked "reversed" and two child records carry its quantity forward — the reversed kilograms as rejected (or
--     rework) and, when only part is reversed, the remainder as approved. Every reader of approved kilograms (dispatch
--     readiness, packaging caps, supply to the order, stock moves, handoffs, the order ledger) already counts only
--     status 'approved', so all of them honour the reversal without being rewritten. A reversal is refused for
--     material that has already moved on to packaging, ageing, stock or dispatch: it must be recalled first. Under an
--     open containment only an approval QA has revoked can be reversed; reversing all of it closes the revocation.
--     The rejected kilograms then follow the existing remelt approval (factory manager or owner).
--   * The validity of a dispatch finance release (48 h) is a setting. The delivery-confirmation days and the
--     reproduction tolerance of batch 2, which had no save path, are saved with it.
--   * The customer-update queue no longer lists dispatches of opening-balance orders, which never get a task.
-- Additive: one new status value, new tables, new column, guards and wrappers. Six existing functions are redefined
-- with one added condition each (marked "Phase 4"); their earlier behaviour is otherwise unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------
alter table public.olo_settings
  add column if not exists dispatch_release_hours smallint not null default 48 check (dispatch_release_hours between 4 and 168);

create or replace function private.olo_settings_for(p_company uuid) returns public.olo_settings
language plpgsql stable security definer set search_path = public, private as $$
declare s public.olo_settings;
begin
  select * into s from public.olo_settings where company_id = p_company;
  if not found then
    s.company_id := p_company; s.billet_rank_threshold := 5; s.die_rank_threshold := 3; s.material_risk_horizon_days := 21;
    s.ack_sla_hours := 4; s.action_sla_hours := 24; s.enforce_die_preparation := false; s.enforce_preheat := false;
    s.delivery_confirmation_days := 3; s.reproduction_tolerance_kg := 1; s.dispatch_release_hours := 48;
  end if;
  return s;
end;
$$;

-- The batch 1 command keeps every command; the wrapper adds the settings it never saved.
alter function public.olo_command(text, jsonb) rename to olo_command_b1;
alter function public.olo_command_b1(text, jsonb) set schema private;
revoke all on function private.olo_command_b1(text, jsonb) from public, anon, authenticated;

create or replace function public.olo_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_payload jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_extra jsonb; v_before public.olo_settings; v_days integer; v_tol numeric; v_hours integer;
begin
  if p_command <> 'settings.save' or jsonb_typeof(v_payload) is distinct from 'object'
     or not (v_payload ?| array['delivery_confirmation_days','reproduction_tolerance_kg','dispatch_release_hours']) then
    return private.olo_command_b1(p_command, v_payload);
  end if;
  a := private.olo_actor(private.olo_reader_roles());
  if (a ->> 'role') not in ('owner','admin','factory_manager') then
    raise exception 'Only the owner, admin or factory manager can change orchestration settings' using errcode = '42501';
  end if;
  v_extra := jsonb_strip_nulls(jsonb_build_object('delivery_confirmation_days', v_payload -> 'delivery_confirmation_days',
    'reproduction_tolerance_kg', v_payload -> 'reproduction_tolerance_kg', 'dispatch_release_hours', v_payload -> 'dispatch_release_hours'));
  begin
    v_days := (v_extra ->> 'delivery_confirmation_days')::integer;
    v_tol := (v_extra ->> 'reproduction_tolerance_kg')::numeric;
    v_hours := (v_extra ->> 'dispatch_release_hours')::integer;
  exception when others then
    raise exception 'Settings must be numbers' using errcode = '22023';
  end;
  if v_days is not null and v_days not between 1 and 60 then raise exception 'Delivery confirmation must be 1 to 60 days after dispatch' using errcode = '23514'; end if;
  if v_tol is not null and (v_tol < 0 or v_tol > 1000) then raise exception 'The reproduction tolerance must be 0 to 1000 kg' using errcode = '23514'; end if;
  if v_hours is not null and v_hours not between 4 and 168 then raise exception 'A finance release must last 4 to 168 hours' using errcode = '23514'; end if;
  v_before := private.olo_settings_for((a ->> 'company')::uuid);
  -- The batch 1 save writes and logs its own fields; when only these settings change, the row is created if missing.
  if (v_payload - array['delivery_confirmation_days','reproduction_tolerance_kg','dispatch_release_hours']) <> '{}'::jsonb then
    perform private.olo_command_b1('settings.save', v_payload - array['delivery_confirmation_days','reproduction_tolerance_kg','dispatch_release_hours']);
  else
    insert into public.olo_settings(company_id, updated_by) values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid) on conflict (company_id) do nothing;
  end if;
  update public.olo_settings set delivery_confirmation_days = coalesce(v_days, delivery_confirmation_days),
    reproduction_tolerance_kg = coalesce(round(v_tol, 3), reproduction_tolerance_kg), dispatch_release_hours = coalesce(v_hours, dispatch_release_hours),
    updated_by = (a ->> 'actor')::uuid, updated_at = now()
    where company_id = (a ->> 'company')::uuid;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid, 'olo_settings.updated', 'olo_settings', (a ->> 'company')::uuid,
      jsonb_build_object('before', jsonb_build_object('delivery_confirmation_days', v_before.delivery_confirmation_days, 'reproduction_tolerance_kg', v_before.reproduction_tolerance_kg,
        'dispatch_release_hours', v_before.dispatch_release_hours), 'changes', v_extra));
  return to_jsonb(private.olo_settings_for((a ->> 'company')::uuid)) - 'company_id';
end;
$$;
revoke all on function public.olo_command(text, jsonb) from public, anon;
grant execute on function public.olo_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Finance release validity
-- ---------------------------------------------------------------------------------------------------------------
alter function public.dispatch_finance_command(text, jsonb) rename to olo_dispatch_finance_command_b3;
alter function public.olo_dispatch_finance_command_b3(text, jsonb) set schema private;
revoke all on function private.olo_dispatch_finance_command_b3(text, jsonb) from public, anon, authenticated;

create or replace function public.dispatch_finance_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.olo_dispatch_finance_command_b3(p_command, p_payload); v_hours integer; r public.dispatch_finance_releases%rowtype;
begin
  if p_command not in ('release','status') or v is null then return v; end if;
  v_hours := (private.olo_settings_for(private.get_current_user_company_id())).dispatch_release_hours;
  if p_command = 'status' then return v || jsonb_build_object('release_hours', v_hours); end if;
  -- The release was just written by this transaction; only its validity window changes.
  update public.dispatch_finance_releases set expires_at = released_at + make_interval(hours => v_hours)
    where id = (v ->> 'id')::uuid and consumed_at is null and revoked_at is null returning * into r;
  if r.id is null then return v; end if;
  return v || jsonb_build_object('expires_at', r.expires_at, 'release_hours', v_hours,
    'state', private.olo_dispatch_clearance(r.company_id, r.dispatch_id) ->> 'state');
end;
$$;
revoke all on function public.dispatch_finance_command(text, jsonb) from public, anon;
grant execute on function public.dispatch_finance_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Customer-update queue: opening-balance orders never get a task, so they are not listed either
-- ---------------------------------------------------------------------------------------------------------------
alter function public.dispatch_comm_command(text, jsonb) rename to olo_dispatch_comm_command_b3;
alter function public.olo_dispatch_comm_command_b3(text, jsonb) set schema private;
revoke all on function private.olo_dispatch_comm_command_b3(text, jsonb) from public, anon, authenticated;

create or replace function public.dispatch_comm_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_payload jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_company uuid; v_page integer; v_rows jsonb; v_total bigint;
  v_senders text[] := array['owner','admin','dispatch_manager','dispatch','sales_manager','sales','factory_manager'];
begin
  if p_command <> 'queue' or coalesce(nullif(v_payload ->> 'view', ''), 'pending') <> 'pending' then
    return private.olo_dispatch_comm_command_b3(p_command, v_payload);
  end if;
  a := private.olo_actor(private.olo_reader_roles());
  perform private.olo_keys(v_payload, array['view','page']);
  v_company := (a ->> 'company')::uuid; v_page := private.olo_page(v_payload);
  select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
    select jsonb_build_object('dispatch_id', x2.id, 'dispatch_number', x2.dispatch_number, 'dispatched_at', x2.actual_dispatched_at, 'order_id', od.id, 'order_number', od.order_number,
        'customer_name', (select coalesce(nullif(c.company_name, ''), c.customer_name) from public.customers c where c.id = od.customer_id), 'vehicle_number', x2.vehicle_number,
        'lr_number', x2.lr_number, 'failed_attempts', (select count(*) from public.dispatch_communications m2 where m2.dispatch_id = x2.id and m2.status = 'failed')) r,
      count(*) over () total, row_number() over (order by x2.actual_dispatched_at, x2.id) ord
    from public.dispatches x2 join public.orders od on od.id = x2.order_id
    where x2.company_id = v_company and x2.actual_dispatched_at is not null and x2.actual_dispatched_at > now() - interval '14 days' and od.customer_id is not null
      and od.opening_cutover_id is null
      and not exists (select 1 from public.dispatch_communications m2 where m2.dispatch_id = x2.id and m2.status in ('sent','delivered','read'))
    order by ord offset (v_page - 1) * 10 limit 10) x;
  return jsonb_build_object('view', 'pending', 'page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'can_send', (a ->> 'role') = any(v_senders));
end;
$$;
revoke all on function public.dispatch_comm_command(text, jsonb) from public, anon;
grant execute on function public.dispatch_comm_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- QC reversal
-- ---------------------------------------------------------------------------------------------------------------
alter table public.quality_inspections drop constraint if exists quality_status_check;
alter table public.quality_inspections add constraint quality_status_check check (status = any (array['pending','approved','rejected','rework','reversed']));

create table public.quality_reversals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  reversal_number text not null,
  quality_inspection_id uuid not null references public.quality_inspections(id),
  production_job_id uuid not null references public.production_jobs(id),
  finishing_job_id uuid references public.finishing_jobs(id),
  order_id uuid references public.orders(id),
  profile_id uuid references public.aluminium_profiles(id),
  original_kg numeric(14,3) not null check (original_kg > 0),
  reversed_kg numeric(14,3) not null check (reversed_kg > 0),
  retained_kg numeric(14,3) not null check (retained_kg >= 0),
  reversed_as text not null check (reversed_as in ('rejected','rework')),
  method text not null check (length(btrim(method)) between 2 and 120),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  reference text check (reference is null or length(btrim(reference)) between 2 and 80),
  job_approved_kg numeric(14,3) not null,
  moved_on_kg numeric(14,3) not null,
  containment_id uuid references public.quality_containments(id),
  prior_review_id uuid references public.containment_prior_reviews(id),
  revocation_closed boolean not null default false,
  reversed_inspection_id uuid not null,
  retained_inspection_id uuid,
  reversed_by uuid not null references public.app_users(id),
  reversed_by_role text not null,
  reversed_at timestamptz not null default clock_timestamp(),
  unique (company_id, reversal_number),
  unique (quality_inspection_id),
  check (round(reversed_kg + retained_kg, 3) = round(original_kg, 3)),
  check ((retained_kg > 0) = (retained_inspection_id is not null)),
  check (job_approved_kg - reversed_kg >= moved_on_kg - 0.001),
  check (not revocation_closed or prior_review_id is not null)
);
create index quality_reversals_list_idx on public.quality_reversals(company_id, reversed_at desc);
create index quality_reversals_job_idx on public.quality_reversals(production_job_id);
create index quality_reversals_order_idx on public.quality_reversals(order_id);
create index quality_reversals_finishing_idx on public.quality_reversals(finishing_job_id);
create index quality_reversals_profile_idx on public.quality_reversals(profile_id);
create index quality_reversals_containment_idx on public.quality_reversals(containment_id);
create index quality_reversals_review_idx on public.quality_reversals(prior_review_id);
create index quality_reversals_reversed_idx on public.quality_reversals(reversed_inspection_id);
create index quality_reversals_retained_idx on public.quality_reversals(retained_inspection_id);
create index quality_reversals_people_idx on public.quality_reversals(reversed_by);

-- Child records name the reversal they came from.
alter table public.quality_inspections add column if not exists reversal_id uuid references public.quality_reversals(id);
create index if not exists quality_inspections_reversal_idx on public.quality_inspections(reversal_id) where reversal_id is not null;
-- The reversal names its children before they exist (both are written in one transaction).
alter table public.quality_reversals
  add constraint quality_reversals_reversed_fk foreign key (reversed_inspection_id) references public.quality_inspections(id) deferrable initially deferred,
  add constraint quality_reversals_retained_fk foreign key (retained_inspection_id) references public.quality_inspections(id) deferrable initially deferred;

-- A reversal is evidence: it is never changed or deleted.
create or replace function private.olo_guard_quality_reversal_row() returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception 'Recorded QC reversals cannot be changed or deleted' using errcode = '42501';
end;
$$;
revoke all on function private.olo_guard_quality_reversal_row() from public, anon, authenticated;
create trigger quality_reversals_evidence before update or delete on public.quality_reversals for each row execute function private.olo_guard_quality_reversal_row();

-- Transaction-scoped permission for the reversal command, in the same pattern as rework resolutions.
create table private.quality_reversal_authorizations (
  transaction_id bigint not null,
  inspection_id uuid not null,
  reversal_id uuid not null,
  primary key (transaction_id, inspection_id)
);
revoke all on private.quality_reversal_authorizations from public, anon, authenticated;

create or replace function private.qc_reversal_authorized(p_inspection uuid, p_reversal uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.quality_reversal_authorizations a
    where a.transaction_id = txid_current() and ((p_inspection is not null and a.inspection_id = p_inspection) or (p_reversal is not null and a.reversal_id = p_reversal)))
$$;
revoke all on function private.qc_reversal_authorized(uuid, uuid) from public, anon;
grant execute on function private.qc_reversal_authorized(uuid, uuid) to authenticated;

-- Only the reversal command marks an approval reversed (status alone changes) or writes child records; a reversed
-- record is final.
create or replace function private.olo_guard_quality_reversal() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'reversed' or old.reversal_id is not null then raise exception 'Reversed QC records and their reversal records are evidence and cannot be deleted' using errcode = '23514'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'reversed' then raise exception 'Only the QC reversal action marks an approval reversed' using errcode = '42501'; end if;
    if new.reversal_id is not null and not private.qc_reversal_authorized(null, new.reversal_id) then
      raise exception 'QC reversal records must use the QC reversal action' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.reversal_id is distinct from old.reversal_id then raise exception 'The reversal link of a QC record cannot be changed' using errcode = '42501'; end if;
  if old.status = 'reversed' then raise exception 'A reversed QC approval is final; its reversal record carries the correction' using errcode = '23514'; end if;
  if new.status = 'reversed' then
    if old.status <> 'approved' or not private.qc_reversal_authorized(old.id, null) then
      raise exception 'Only the QC reversal action marks an approval reversed' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['status','updated_at']) is distinct from (to_jsonb(old) - array['status','updated_at']) then
      raise exception 'Reversing an approval changes only its status; the recorded values stay as they were' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_quality_reversal() from public, anon, authenticated;
create trigger guard_quality_reversal before insert or update or delete on public.quality_inspections for each row execute function private.olo_guard_quality_reversal();

-- Phase 4: the immutability guard admits the authorised approved -> reversed step; 'reversed' is final as well.
create or replace function public.guard_terminal_quality_inspection()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'reversed' and private.qc_reversal_authorized(old.id, null) then
    return new;
  end if;
  if old.status in ('approved', 'rejected', 'rework', 'reversed') then
    raise exception 'Final quality dispositions are immutable; record a new inspection for corrections'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- Phase 4: the approved child of a rework resolution can be reversed through the reversal action.
create or replace function private.guard_quality_resolution_immutability()
 returns trigger language plpgsql security definer set search_path to 'public', 'private' as $function$
begin
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'reversed' and private.qc_reversal_authorized(old.id, null) then
    return new;
  end if;
  if old.resolution_id is not null or exists (
    select 1 from public.quality_rework_resolutions resolution
    where resolution.company_id = old.company_id and resolution.source_inspection_id = old.id
  ) then
    raise exception 'Resolved rework source and disposition evidence are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- Phase 4: the retained part of a reversed approval carries the earlier approval (its plan results stay on the
-- original record), so it is not re-tested against the plan.
create or replace function private.guard_inspection_plan_approval()
 returns trigger language plpgsql security definer set search_path to 'public', 'private' as $function$
declare v_eval jsonb;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') or new.resolution_id is not null then return new; end if;
  if tg_op = 'INSERT' and new.reversal_id is not null and private.qc_reversal_authorized(null, new.reversal_id) then return new; end if;
  if private.applicable_inspection_plan(new.company_id, new.profile_id) is null then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'Record the inspection plan results before approving this inspection' using errcode = '23514';
  end if;
  v_eval := private.inspection_plan_evaluation(new.id);
  if v_eval ->> 'state' = 'incomplete' then
    raise exception 'Inspection cannot be approved: % of % planned results are missing', v_eval ->> 'missing', v_eval ->> 'total' using errcode = '23514';
  elsif v_eval ->> 'state' = 'fail' then
    raise exception 'Inspection cannot be approved: % result(s) are outside the plan limits. Record a rework or rejection instead', v_eval ->> 'failed' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- Phase 4: likewise for the in-process sample requirement, which the earlier approval already satisfied.
create or replace function private.ap2_guard_sampling_release()
 returns trigger language plpgsql security definer set search_path to 'public', 'private' as $function$
declare v_n integer;
begin
  if new.status = 'approved' and new.production_job_id is not null and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if tg_op = 'INSERT' and new.reversal_id is not null and private.qc_reversal_authorized(null, new.reversal_id) then return new; end if;
    select count(*) into v_n from public.qc_sample_requirements r
      where r.company_id = new.company_id and r.production_job_id = new.production_job_id and r.blocks_release and r.status in ('open', 'missed');
    if v_n > 0 then
      raise exception 'AP: % required in-process sample(s) are not recorded for this job. Record or waive them before QC release.', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

-- Phase 4: the rework-resolution match applies to the approved and rejected children it wrote, not to a child that a
-- later reversal marks reversed.
create or replace function public.validate_quality_production_link()
 returns trigger language plpgsql security definer set search_path to 'public', 'private' as $function$
declare
  v_job record;
  v_finishing record;
  v_source_kg numeric;
  v_disposed_kg numeric;
begin
  if new.production_job_id is null then
    if tg_op = 'INSERT' or new.status in ('approved','rejected','rework') then raise exception 'Select the completed production job inspected by this QC record' using errcode = '23514'; end if;
    return new;
  end if;
  select id, company_id, order_id, profile_id, status, actual_quantity_kg, finishing_type
  into v_job from public.production_jobs where id = new.production_job_id for update nowait;
  if not found or v_job.company_id <> new.company_id or v_job.profile_id <> new.profile_id or v_job.status <> 'completed' then
    raise exception 'QC must link to completed production for the same company/profile' using errcode = '23514';
  end if;
  v_source_kg := v_job.actual_quantity_kg;
  if coalesce(v_job.finishing_type,'mill_finish') <> 'mill_finish' then
    if new.finishing_job_id is null then raise exception 'Post-finishing QC must link a final accepted finishing receipt' using errcode = '23514'; end if;
    select id, company_id, production_job_id, status, output_weight_kg into v_finishing from public.finishing_jobs where id = new.finishing_job_id;
    if not found or v_finishing.company_id <> new.company_id or v_finishing.production_job_id <> new.production_job_id or v_finishing.status not in ('completed','rejected') then
      raise exception 'QC requires a final accepted finishing receipt for this production job' using errcode = '23514';
    end if;
    v_source_kg := private.finishing_accepted_output_kg(new.company_id,new.production_job_id,new.finishing_job_id);
    if v_source_kg<=0 then raise exception 'QC requires a final accepted finishing receipt'; end if;
  elsif new.finishing_job_id is not null then raise exception 'Mill-finish QC must not link an unrelated finishing job' using errcode = '23514'; end if;

  if new.status in ('approved','rejected','rework') then
    if coalesce(new.quantity_checked_kg,0) <= 0 then raise exception 'QC disposition quantity must be greater than zero' using errcode = '23514'; end if;
    perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || new.company_id::text || ':' || new.production_job_id::text || ':' || coalesce(new.finishing_job_id::text,'mill-finish'),0));
    select coalesce(sum(q.quantity_checked_kg),0) into v_disposed_kg from public.quality_inspections q
    where q.company_id=new.company_id and q.production_job_id=new.production_job_id
      and coalesce(q.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(new.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and q.status in ('approved','rejected','rework') and q.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and not exists(select 1 from public.quality_rework_resolutions resolution where resolution.source_inspection_id=q.id);
    if v_disposed_kg + new.quantity_checked_kg > v_source_kg + 0.01 then raise exception 'QC disposition exceeds available source output (%)',v_source_kg using errcode='23514'; end if;
  end if;
  if new.status='approved' then
    if coalesce(btrim(new.inspector_name),'')='' then raise exception 'Approved QC requires an inspector name' using errcode='23514'; end if;
    if new.surface_finish_ok is distinct from true then raise exception 'QC cannot be approved while surface finish is marked failed' using errcode='23514'; end if;
  end if;
  if new.resolution_id is not null and new.status in ('approved','rejected') and not exists(select 1 from public.quality_rework_resolutions r where r.id=new.resolution_id
    and r.company_id=new.company_id and r.production_job_id=new.production_job_id and r.finishing_job_id is not distinct from new.finishing_job_id and r.profile_id=new.profile_id
    and ((new.status='approved' and new.quantity_checked_kg <= r.approved_weight_kg) or (new.status='rejected' and new.quantity_checked_kg <= r.rejected_weight_kg))) then
    raise exception 'Resolved QC disposition must match its immutable rework resolution';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being corrected; retry quality disposition after refresh' using errcode='55P03';
end;
$function$;

-- Phase 4: workflow tasks are closed only by the engine re-verifying the current records, so a change to a source
-- they mention is not a reason to hold them for review (and holding them would stop the engine from closing them).
-- Every other task related to the changed source is still held for independent review, as before.
create or replace function private.capture_important_source_change() returns trigger language plpgsql security definer set search_path=public,private as $$
declare a jsonb:=private.assurance_basis(tg_table_name,to_jsonb(old));b jsonb:=private.assurance_basis(tg_table_name,to_jsonb(new));v_order uuid;v_job uuid;v_invoice uuid;v_task uuid;
begin
  if a is not distinct from b then return new; end if;
  if tg_table_name='quality_inspections' then v_job:=new.production_job_id;select order_id into v_order from public.production_jobs where id=v_job and company_id=new.company_id;
  elsif tg_table_name='payments' then v_invoice:=(to_jsonb(new)->>'invoice_id')::uuid;select order_id into v_order from public.invoices where id=v_invoice and company_id=new.company_id;
  elsif tg_table_name='task_criterion_evidence' then v_task:=new.task_id;end if;
  insert into public.source_change_reviews(company_id,task_id,source_type,source_id,before_snapshot,after_snapshot,source_fingerprint,previous_task_status,previous_completed_at,changed_by)
    select new.company_id,t.id,tg_table_name,new.id,a,b,md5(b::text),t.status,t.completed_at,auth.uid() from public.tasks t where t.company_id=new.company_id and t.dealership_id is null and t.status<>'cancelled'
      and t.workflow_key is null and (
      t.id=v_task or (t.related_entity_type in ('order','orders') and t.related_entity_id=v_order) or (t.related_entity_type in ('invoice','invoices') and t.related_entity_id=v_invoice) or (t.related_entity_type in ('production_job','production') and t.related_entity_id=v_job)
      or (tg_table_name='aluminium_profiles' and ((t.related_entity_type in ('profile','aluminium_profile') and t.related_entity_id=new.id)
        or (t.related_entity_type in ('production_job','production') and exists(select 1 from public.production_jobs j where j.id=t.related_entity_id and j.company_id=new.company_id and j.profile_id=new.id))
        or (t.related_entity_type in ('order','orders') and exists(select 1 from public.order_items i where i.order_id=t.related_entity_id and i.company_id=new.company_id and i.profile_id=new.id)))));
  return new;
end $$;

-- Job material committed past QC: packaging jobs, packed and prepared bundles plus stock moved from the job, or
-- ageing loads — the largest of those stages.
create or replace function private.olo_qc_committed_kg(p_company uuid, p_job uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select greatest(private.olo_job_consumed_kg(p_company, p_job),
    coalesce((select sum(x.net_weight_kg) from public.packing_list_items x where x.company_id = p_company and x.source_kind = 'production' and x.source_line_id = p_job), 0)
      + coalesce((select sum(x.gross_weight_kg - x.tare_weight_kg) from public.prepared_physical_bundles x where x.company_id = p_company and x.source_kind = 'production'
          and x.source_line_id = p_job and x.dispatch_id is null), 0)
      + coalesce((select sum(b.total_weight_kg) from public.profile_stock_batches b where b.company_id = p_company and b.production_job_id = p_job and b.origin_type = 'production_surplus'
          and not exists (select 1 from public.bundle_transformation_lines l where l.company_id = b.company_id and l.stock_batch_id = b.id and l.direction = 'output')), 0))
$$;

create or replace function private.olo_reversal_number(p_company uuid) returns text language plpgsql security definer set search_path = public, private as $$
declare v_fy text := private.ap_fy_label(private.ist_today()); v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':olo-reversal-number', 0));
  select count(*) + 1 into v_n from public.quality_reversals where company_id = p_company and reversal_number like 'QCR/' || v_fy || '/%';
  return 'QCR/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;

-- What a reversal of one approval would do, and whether it is allowed now.
create or replace function private.olo_reversal_preview(p_company uuid, p_inspection uuid, p_role text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare q public.quality_inspections%rowtype; j public.production_jobs%rowtype; v_approved numeric; v_committed numeric; v_max numeric; c public.quality_containments%rowtype;
  pr public.containment_prior_reviews%rowtype; v_blocker text; v_reversal uuid;
begin
  select * into q from public.quality_inspections where id = p_inspection and company_id = p_company;
  if not found then return null; end if;
  select * into j from public.production_jobs where id = q.production_job_id and company_id = p_company;
  select id into v_reversal from public.quality_reversals where quality_inspection_id = q.id;
  v_approved := coalesce((select sum(x.quantity_checked_kg) from public.quality_inspections x where x.company_id = p_company and x.production_job_id = q.production_job_id and x.status = 'approved'), 0);
  v_committed := case when j.id is null then 0 else round(private.olo_qc_committed_kg(p_company, j.id), 3) end;
  v_max := round(greatest(least(q.quantity_checked_kg, v_approved - v_committed), 0), 3);
  select * into c from public.quality_containments x where x.company_id = p_company and x.production_job_id = q.production_job_id and x.status in ('open','partially_resolved');
  if c.id is not null then
    select * into pr from public.containment_prior_reviews r where r.containment_id = c.id and r.quality_inspection_id = q.id;
  end if;
  v_blocker := case
    when q.status = 'reversed' then 'This approval is already reversed.'
    when q.status <> 'approved' then 'Only an approved QC record can be reversed.'
    when j.id is null then 'This QC record is not linked to a production job.'
    when p_role not in ('owner','quality') then 'Only QA/QC reverses a QC approval.'
    when c.id is not null and pr.id is null then format('Job output is under containment %s. Review this approval there first (reconfirm or revoke it); only a revoked approval can be reversed while the lot is held.', c.containment_number)
    when c.id is not null and (pr.outcome <> 'revoked' or pr.closed_at is not null) then format('Under containment %s this approval was %s. Only an open revocation can be reversed while the lot is held.', c.containment_number, case when pr.outcome = 'reconfirmed' then 'reconfirmed' else 'already closed' end)
    when v_max <= 0.0005 then format('All %s approved for this job has already moved to packaging, ageing, stock or dispatch. Recall the material first (cancel the packaging job, unpack the bundles or reverse the stock move), then reverse.', private.olo_fmt_kg(v_approved))
    else null end;
  return jsonb_build_object('inspection_id', q.id, 'status', q.status, 'batch_number', q.batch_number, 'quantity_kg', q.quantity_checked_kg, 'inspection_date', q.inspection_date,
    'inspector_name', q.inspector_name, 'stage', case when q.finishing_job_id is null then 'production' else 'after_finishing' end,
    'job_id', j.id, 'job_number', j.job_number, 'order_id', j.order_id, 'order_number', (select order_number from public.orders o where o.id = j.order_id),
    'profile_code', (select profile_code from public.aluminium_profiles p where p.id = q.profile_id),
    'job_approved_kg', v_approved, 'moved_on_kg', v_committed, 'max_reversible_kg', v_max,
    'containment', case when c.id is null then null else jsonb_build_object('id', c.id, 'containment_number', c.containment_number,
      'review_id', pr.id, 'review_outcome', pr.outcome, 'review_closed', pr.closed_at is not null) end,
    'reversal_id', v_reversal, 'can_reverse', v_blocker is null, 'blocker', v_blocker);
end;
$$;

create or replace function private.olo_reversal_json(p_company uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', r.id, 'reversal_number', r.reversal_number, 'inspection_id', r.quality_inspection_id, 'batch_number', q.batch_number,
    'inspection_date', q.inspection_date, 'inspector_name', q.inspector_name, 'stage', case when r.finishing_job_id is null then 'production' else 'after_finishing' end,
    'job_id', r.production_job_id, 'job_number', j.job_number, 'order_id', r.order_id, 'order_number', o.order_number,
    'profile_code', (select profile_code from public.aluminium_profiles p where p.id = r.profile_id),
    'original_kg', r.original_kg, 'reversed_kg', r.reversed_kg, 'retained_kg', r.retained_kg, 'reversed_as', r.reversed_as, 'method', r.method, 'reason', r.reason,
    'reference', r.reference, 'job_approved_kg', r.job_approved_kg, 'moved_on_kg', r.moved_on_kg,
    'containment_id', r.containment_id, 'containment_number', (select containment_number from public.quality_containments c where c.id = r.containment_id),
    'revocation_closed', r.revocation_closed, 'reversed_inspection_id', r.reversed_inspection_id, 'retained_inspection_id', r.retained_inspection_id,
    'reversed_by_name', (select full_name from public.app_users u where u.id = r.reversed_by), 'reversed_at', r.reversed_at)
  from public.quality_reversals r join public.quality_inspections q on q.id = r.quality_inspection_id
  left join public.production_jobs j on j.id = r.production_job_id left join public.orders o on o.id = r.order_id
  where r.id = p_id and r.company_id = p_company
$$;

create or replace function public.quality_reversal_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb)); v_rows jsonb; v_total bigint;
  q public.quality_inspections%rowtype; j public.production_jobs%rowtype; c public.quality_containments%rowtype; pr public.containment_prior_reviews%rowtype;
  k jsonb; v_kg numeric; v_retained numeric; v_as text; v_id uuid := gen_random_uuid(); v_rev uuid := gen_random_uuid(); v_ret uuid; v_number text;
  v_order uuid; v_order_number text; v_closed boolean := false; v_handoff_done boolean; v_full boolean; v_cancelled integer := 0;
begin
  if p_command = 'list' then
    perform private.olo_keys(v_payload, array['page','job_id','order_id']);
    select coalesce(jsonb_agg(private.olo_reversal_json(v_company, x.id) order by x.reversed_at desc, x.id), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select r.id, r.reversed_at, count(*) over () total from public.quality_reversals r where r.company_id = v_company
        and (v_payload ->> 'job_id' is null or r.production_job_id = (v_payload ->> 'job_id')::uuid)
        and (v_payload ->> 'order_id' is null or r.order_id = (v_payload ->> 'order_id')::uuid)
      order by r.reversed_at desc, r.id offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'can_reverse', v_role in ('owner','quality'));
  end if;

  if p_command = 'get' then
    perform private.olo_keys(v_payload, array['id']);
    k := private.olo_reversal_json(v_company, (v_payload ->> 'id')::uuid);
    if k is null then raise exception 'QC reversal not found' using errcode = '23514'; end if;
    return k;
  end if;

  if p_command = 'preview' then
    perform private.olo_keys(v_payload, array['inspection_id']);
    k := private.olo_reversal_preview(v_company, (v_payload ->> 'inspection_id')::uuid, v_role);
    if k is null then raise exception 'QC record not found' using errcode = '23514'; end if;
    return k;
  end if;

  if p_command <> 'reverse' then raise exception 'Unknown QC reversal command' using errcode = '22023'; end if;
  if v_role not in ('owner','quality') then raise exception 'Only QA/QC reverses a QC approval' using errcode = '42501'; end if;
  perform private.olo_keys(v_payload, array['inspection_id','reversed_kg','reversed_as','method','reason','reference']);
  select * into q from public.quality_inspections where id = (v_payload ->> 'inspection_id')::uuid and company_id = v_company for update;
  if not found then raise exception 'QC record not found' using errcode = '23514'; end if;
  -- One QC decision on this job at a time (the same lock the QC disposition check takes), and the job row itself, so
  -- the moved-on quantity is measured against a stable job; under a containment its row is locked before the review
  -- state is read, so a revocation cannot be closed between the check and the reversal.
  perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || q.company_id::text || ':' || coalesce(q.production_job_id::text, '') || ':' || coalesce(q.finishing_job_id::text,'mill-finish'), 0));
  perform 1 from public.production_jobs where id = q.production_job_id and company_id = v_company for update;
  perform 1 from public.quality_containments x where x.company_id = v_company and x.production_job_id = q.production_job_id and x.status in ('open','partially_resolved') for update;
  k := private.olo_reversal_preview(v_company, q.id, v_role);
  if not (k ->> 'can_reverse')::boolean then raise exception '%', k ->> 'blocker' using errcode = '23514'; end if;
  begin
    v_kg := round((v_payload ->> 'reversed_kg')::numeric, 3);
  exception when others then raise exception 'Record the kilograms to reverse as a number' using errcode = '22023';
  end;
  if v_kg is null or v_kg <= 0 then raise exception 'Record the kilograms to reverse (more than 0)' using errcode = '23514'; end if;
  if v_kg > q.quantity_checked_kg + 0.0005 then raise exception 'At most % kg of this approval can be reversed', trim_scale(q.quantity_checked_kg) using errcode = '23514'; end if;
  if v_kg > (k ->> 'max_reversible_kg')::numeric + 0.0005 then
    raise exception '% of this job has already moved to packaging, ageing, stock or dispatch, so at most % can be reversed now. Recall the rest first, then reverse it.',
      private.olo_fmt_kg((k ->> 'moved_on_kg')::numeric), trim_scale((k ->> 'max_reversible_kg')::numeric) || ' kg' using errcode = '23514';
  end if;
  v_full := abs(q.quantity_checked_kg - v_kg) < 0.0005;
  if v_full then v_kg := q.quantity_checked_kg; end if;
  v_retained := round(q.quantity_checked_kg - v_kg, 3);
  v_as := coalesce(nullif(v_payload ->> 'reversed_as', ''), 'rejected');
  if v_as not in ('rejected','rework') then raise exception 'Choose whether the reversed material is rejected or sent for rework' using errcode = '23514'; end if;
  if length(btrim(coalesce(v_payload ->> 'method', ''))) < 2 then raise exception 'Record how the material was re-checked' using errcode = '23514'; end if;
  if length(btrim(coalesce(v_payload ->> 'reason', ''))) < 10 then raise exception 'Record why the approval is reversed (at least 10 characters)' using errcode = '23514'; end if;
  if v_payload ->> 'reference' is not null and length(btrim(v_payload ->> 'reference')) not between 2 and 80 then
    raise exception 'The reference (NCR, complaint or test report) must be 2 to 80 characters' using errcode = '23514';
  end if;
  if (btrim(coalesce(v_payload ->> 'method', '')) || btrim(coalesce(v_payload ->> 'reason', '')) || coalesce(v_payload ->> 'reference', '')) ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'Remove control characters from the reversal details' using errcode = '23514';
  end if;

  select * into j from public.production_jobs where id = q.production_job_id and company_id = v_company;
  v_order := coalesce(j.order_id, (select fj.order_id from public.finishing_jobs fj where fj.id = q.finishing_job_id));
  select order_number into v_order_number from public.orders where id = v_order;
  if k -> 'containment' ->> 'id' is not null then
    select * into c from public.quality_containments where id = (k -> 'containment' ->> 'id')::uuid for update;
    select * into pr from public.containment_prior_reviews where id = (k -> 'containment' ->> 'review_id')::uuid for update;
    if pr.id is null or pr.outcome <> 'revoked' or pr.closed_at is not null then
      raise exception 'The review of this approval under containment % changed; refresh and check it again', c.containment_number using errcode = '23514';
    end if;
  end if;
  v_ret := case when v_retained > 0 then gen_random_uuid() end;
  v_number := private.olo_reversal_number(v_company);

  insert into public.quality_reversals(id, company_id, reversal_number, quality_inspection_id, production_job_id, finishing_job_id, order_id, profile_id, original_kg, reversed_kg,
    retained_kg, reversed_as, method, reason, reference, job_approved_kg, moved_on_kg, containment_id, prior_review_id, revocation_closed, reversed_inspection_id, retained_inspection_id,
    reversed_by, reversed_by_role)
  values (v_id, v_company, v_number, q.id, q.production_job_id, q.finishing_job_id, v_order, q.profile_id, q.quantity_checked_kg, v_kg, v_retained, v_as,
    btrim(v_payload ->> 'method'), btrim(v_payload ->> 'reason'), nullif(btrim(coalesce(v_payload ->> 'reference', '')), ''), (k ->> 'job_approved_kg')::numeric,
    (k ->> 'moved_on_kg')::numeric, c.id, pr.id, v_full and pr.id is not null, v_rev, v_ret, v_actor, v_role);

  insert into private.quality_reversal_authorizations(transaction_id, inspection_id, reversal_id) values (txid_current(), q.id, v_id);
  update public.quality_inspections set status = 'reversed', updated_at = now() where id = q.id;
  insert into public.quality_inspections(id, company_id, production_job_id, finishing_job_id, profile_id, inspection_date, batch_number, quantity_checked_kg, dimensional_variance,
      hardness_webster, surface_finish_ok, weight_per_meter_actual, status, inspector_name, notes, branch_id, plant_id, reversal_id)
    values (v_rev, v_company, q.production_job_id, q.finishing_job_id, q.profile_id, now(), q.batch_number, v_kg, q.dimensional_variance, q.hardness_webster, false,
      q.weight_per_meter_actual, v_as, a ->> 'name', left(format('%s under QC reversal %s of the approval of %s: %s', case when v_as = 'rejected' then 'Rejected' else 'Sent for rework' end,
        v_number, to_char(q.inspection_date at time zone 'Asia/Kolkata', 'DD Mon YYYY'), btrim(v_payload ->> 'reason')), 1000), q.branch_id, q.plant_id, v_id);
  if v_ret is not null then
    -- The retained part keeps the earlier approval; a held lot stays held through the containment itself.
    perform set_config('olo.containment_release', 'on', true);
    insert into public.quality_inspections(id, company_id, production_job_id, finishing_job_id, profile_id, inspection_date, batch_number, quantity_checked_kg, dimensional_variance,
        hardness_webster, surface_finish_ok, weight_per_meter_actual, status, inspector_name, notes, branch_id, plant_id, reversal_id)
      values (v_ret, v_company, q.production_job_id, q.finishing_job_id, q.profile_id, now(), q.batch_number, v_retained, q.dimensional_variance, q.hardness_webster, q.surface_finish_ok,
        q.weight_per_meter_actual, 'approved', q.inspector_name, left(format('Retained from the approval of %s under QC reversal %s (%s re-checked: %s)',
          to_char(q.inspection_date at time zone 'Asia/Kolkata', 'DD Mon YYYY'), v_number, private.olo_fmt_kg(v_retained), btrim(v_payload ->> 'method')), 1000), q.branch_id, q.plant_id, v_id);
    perform set_config('olo.containment_release', '', true);
  end if;
  delete from private.quality_reversal_authorizations where transaction_id = txid_current() and reversal_id = v_id;

  -- The packing handoff of the original release no longer stands; the retained part gets its own, unless the
  -- original was already handed over.
  select exists (select 1 from public.tasks t where t.company_id = v_company and t.handoff_key = 'inspection_release:' || q.id and t.status = 'completed') into v_handoff_done;
  update public.tasks set status = 'cancelled', resolved_by_system_at = clock_timestamp(), system_resolution = left(format('Withdrawn: QC approval reversed under %s', v_number), 300)
    where company_id = v_company and handoff_key = 'inspection_release:' || q.id and status in ('open','in_progress');
  get diagnostics v_cancelled = row_count;
  if v_ret is not null and v_handoff_done then
    update public.tasks set status = 'cancelled', resolved_by_system_at = clock_timestamp(),
      system_resolution = left(format('Not needed: the original release was already handed over to packaging; %s keeps %s of it', v_number, private.olo_fmt_kg(v_retained)), 300)
      where company_id = v_company and handoff_key = 'inspection_release:' || v_ret and status in ('open','in_progress');
  end if;

  -- Reversing all of a revoked approval leaves nothing of it to re-verify, so its revocation closes with this record.
  if v_full and pr.id is not null then
    update public.containment_prior_reviews set closed_by = v_actor, closed_by_role = v_role, closed_at = clock_timestamp(), close_method = left('QC reversal ' || v_number, 120),
      close_note = left(format('Reversed in full (%s %s): %s', private.olo_fmt_kg(v_kg), v_as, btrim(v_payload ->> 'reason')), 500) where id = pr.id;
    update public.quality_containments set suspended_approved_kg = greatest(suspended_approved_kg - pr.quantity_kg, 0) where id = c.id;
    update public.notifications set resolved_at = clock_timestamp(), resolution = left('Resolved: approval reversed under ' || v_number, 300), is_read = true, read_at = coalesce(read_at, now())
      where company_id = v_company and condition_key = 'olo-prior-revoked:' || q.id and resolved_at is null;
    v_closed := true;
  end if;

  perform private.olo_event(v_company, 'qc.approval_reversed', v_order, q.production_job_id, 'quality',
    format('%s: approval of %s (%s) reversed — %s %s%s. %s', v_number, coalesce(q.batch_number, 'QC'), private.olo_fmt_kg(q.quantity_checked_kg), private.olo_fmt_kg(v_kg),
      case when v_as = 'rejected' then 'rejected' else 'sent for rework' end, case when v_retained > 0 then format(', %s stays approved', private.olo_fmt_kg(v_retained)) else '' end,
      btrim(v_payload ->> 'reason')),
    jsonb_build_object('reversal_id', v_id, 'inspection_id', q.id, 'reversed_kg', v_kg, 'retained_kg', v_retained, 'reversed_as', v_as), 'qc-reversal:' || v_id);
  perform private.ap3_notify_roles(v_company, private.olo_uniq(private.olo_roles(v_company, 'factory_management', 0) || private.olo_roles(v_company, 'production_planning', 0)
      || private.olo_roles(v_company, 'quality', 0)), 'olo_qc_reversal', 'warning', format('QC approval reversed: %s', v_number),
    format('QA reversed %s of an earlier approval for order %s (job %s): %s. It is now %s%s; the order''s approved quantity is reduced, and production planning gets a reproduction task if the order is now short.',
      private.olo_fmt_kg(v_kg), coalesce(v_order_number, '-'), coalesce(j.job_number, '-'), btrim(v_payload ->> 'reason'),
      case when v_as = 'rejected' then 'rejected and can be proposed for remelt' else 'waiting for rework' end,
      case when v_retained > 0 then format('; %s of the approval stays approved', private.olo_fmt_kg(v_retained)) else '' end),
    'quality_reversal', v_id, '/quality/reversals/' || v_id, 'olo-qc-reversed:' || v_id, v_actor);
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (v_company, v_actor, 'quality_inspection.reversed', 'quality_inspection', q.id, jsonb_build_object('reversal_id', v_id, 'reversal_number', v_number,
      'reversed_kg', v_kg, 'retained_kg', v_retained, 'reversed_as', v_as, 'reversed_inspection_id', v_rev, 'retained_inspection_id', v_ret, 'moved_on_kg', k ->> 'moved_on_kg'));
  perform set_config('olo.engine', 'running', true);
  perform private.olo_evaluate_reproduction(v_company);
  perform private.olo_verify_tasks(v_company);
  perform set_config('olo.engine', '', true);
  return jsonb_build_object('id', v_id, 'reversal_number', v_number, 'reversed_kg', v_kg, 'retained_kg', v_retained, 'reversed_as', v_as,
    'reversed_inspection_id', v_rev, 'retained_inspection_id', v_ret, 'revocation_closed', v_closed, 'handoffs_withdrawn', v_cancelled);
end;
$$;
revoke all on function private.olo_qc_committed_kg(uuid, uuid), private.olo_reversal_number(uuid), private.olo_reversal_preview(uuid, uuid, text),
  private.olo_reversal_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quality_reversal_command(text, jsonb) from public, anon;
grant execute on function public.quality_reversal_command(text, jsonb) to authenticated;

-- Containment detail: which earlier approvals have been reversed.
alter function public.quality_containment_command(text, jsonb) rename to olo_containment_command_b3;
alter function public.olo_containment_command_b3(text, jsonb) set schema private;
revoke all on function private.olo_containment_command_b3(text, jsonb) from public, anon, authenticated;

create or replace function public.quality_containment_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.olo_containment_command_b3(p_command, p_payload); a jsonb;
begin
  if p_command <> 'get' or v is null then return v; end if;
  a := private.olo_actor(private.olo_reader_roles());
  return v || jsonb_build_object('reversals', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reversal_number', r.reversal_number, 'inspection_id', r.quality_inspection_id,
      'reversed_kg', r.reversed_kg, 'retained_kg', r.retained_kg, 'reversed_as', r.reversed_as, 'reversed_at', r.reversed_at) order by r.reversed_at), '[]'::jsonb)
    from public.quality_reversals r join public.quality_containments c on c.id = (v ->> 'id')::uuid
    where r.company_id = (a ->> 'company')::uuid and r.production_job_id = c.production_job_id),
    'can_reverse', (a ->> 'role') in ('owner','quality') and v ->> 'status' in ('open','partially_resolved'));
end;
$$;
revoke all on function public.quality_containment_command(text, jsonb) from public, anon;
grant execute on function public.quality_containment_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security, live screens
-- ---------------------------------------------------------------------------------------------------------------
alter table public.quality_reversals enable row level security;
revoke all on public.quality_reversals from public, anon, authenticated;
grant select on public.quality_reversals to authenticated;
create policy quality_reversals_read on public.quality_reversals for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
       where p.pubname = 'supabase_realtime' and pr.prrelid = 'public.quality_reversals'::regclass) then
    alter publication supabase_realtime add table public.quality_reversals;
  end if;
end;
$$;

commit;
