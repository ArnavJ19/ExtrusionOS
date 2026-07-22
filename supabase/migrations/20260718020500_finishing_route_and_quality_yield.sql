begin;

alter table public.order_items
  add column if not exists finishing_type text;
alter table public.production_jobs
  add column if not exists finishing_type text,
  add column if not exists actual_pieces integer not null default 0;
alter table public.quality_inspections
  add column if not exists finishing_job_id uuid references public.finishing_jobs(id) on delete set null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'production_jobs_actual_pieces_nonnegative'
      and conrelid = 'public.production_jobs'::regclass
  ) then
    alter table public.production_jobs
      add constraint production_jobs_actual_pieces_nonnegative
      check (actual_pieces >= 0);
  end if;
end $$;

update public.production_jobs
set actual_pieces = pieces
where status = 'completed' and actual_pieces = 0 and coalesce(pieces, 0) > 0;

create index if not exists quality_inspections_finishing_job_idx
  on public.quality_inspections(company_id, finishing_job_id, status);
create index if not exists finishing_jobs_production_job_idx
  on public.finishing_jobs(company_id, production_job_id, status);

-- Preserve the quoted route on converted order lines and production jobs.
update public.order_items oi
set finishing_type = (
  select qi.finishing_type
  from public.orders o
  join public.quote_items qi
    on qi.company_id = o.company_id
   and qi.quote_id = o.quote_id
   and qi.profile_id = oi.profile_id
  where o.id = oi.order_id and o.company_id = oi.company_id
  order by qi.created_at
  limit 1
)
where oi.finishing_type is null;

create or replace function public.sync_production_finishing_route()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.finishing_type is null or btrim(new.finishing_type) = '' then
    select coalesce(oi.finishing_type, 'mill_finish')
    into new.finishing_type
    from public.order_items oi
    where oi.id = new.source_line_id
      and oi.company_id = new.company_id
      and oi.order_id = new.order_id;
  end if;
  if new.finishing_type is null or btrim(new.finishing_type) = '' then
    select coalesce(qi.finishing_type, 'mill_finish')
    into new.finishing_type
    from public.orders o
    join public.quote_items qi
      on qi.company_id = o.company_id
     and qi.quote_id = o.quote_id
     and qi.profile_id = new.profile_id
    where o.id = new.order_id and o.company_id = new.company_id
    order by qi.created_at
    limit 1;
  end if;
  new.finishing_type := coalesce(nullif(btrim(new.finishing_type), ''), 'mill_finish');
  return new;
end;
$$;

drop trigger if exists sync_production_finishing_route on public.production_jobs;
create trigger sync_production_finishing_route
before insert or update of company_id, order_id, profile_id, source_line_id, finishing_type
on public.production_jobs
for each row execute function public.sync_production_finishing_route();

update public.production_jobs
set finishing_type = coalesce(nullif(btrim(finishing_type), ''), 'mill_finish')
where finishing_type is null or btrim(finishing_type) = '';

-- Route completed output to finishing when required. Mill-finish output can
-- enter the packaging queue directly; both paths still require QC release.
create or replace function public.link_billets_to_production_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    if coalesce(new.actual_quantity_kg, 0) <= 0 then
      raise exception 'Capture actual production output before completing the job'
        using errcode = '23514';
    end if;

    update public.foundry_billets
    set status = 'consumed', updated_at = now()
    where company_id = new.company_id
      and production_job_id = new.id
      and status in ('allocated','issued');

    if coalesce(new.finishing_type, 'mill_finish') = 'mill_finish' then
      insert into public.packaging_jobs(
        company_id, packaging_number, order_id, production_job_id,
        scheduled_date, pieces, profile_weight_kg, profile_length_m,
        status, notes, created_by
      )
      select
        new.company_id,
        concat('PKG-', to_char(current_date, 'YYYY'), '-', substring(new.id::text, 1, 8)),
        new.order_id,
        new.id,
        current_date,
        coalesce(nullif(new.actual_pieces, 0), new.pieces, 0),
        new.actual_quantity_kg,
        coalesce(nullif(new.actual_meters, 0), coalesce(new.length_per_piece_m, 0) * coalesce(nullif(new.actual_pieces, 0), new.pieces, 0)),
        'scheduled',
        'Mill-finish output queued after extrusion. Complete QC release and issue packaging materials.',
        auth.uid()
      where not exists (
        select 1 from public.packaging_jobs existing
        where existing.company_id = new.company_id
          and existing.production_job_id = new.id
      )
      on conflict (company_id, packaging_number) do nothing;
    else
      insert into public.finishing_jobs(
        company_id, order_id, production_job_id, finishing_type,
        planned_date, input_weight_kg, output_weight_kg,
        rejection_weight_kg, status, remarks
      )
      select
        new.company_id,
        new.order_id,
        new.id,
        new.finishing_type,
        current_date,
        new.actual_quantity_kg,
        0,
        0,
        'planned',
        'Auto-created after extrusion. Record send, receipt, accepted output, and finishing QC.'
      where not exists (
        select 1 from public.finishing_jobs existing
        where existing.company_id = new.company_id
          and existing.production_job_id = new.id
          and existing.status <> 'rejected'
      );
    end if;

    perform private.advance_order_stage(
      new.company_id,
      new.order_id,
      'extruded',
      concat('Production job ', coalesce(new.job_number, new.id::text), ' completed with ', new.actual_quantity_kg, ' kg actual output; route ', coalesce(new.finishing_type, 'mill_finish'), '.')
    );
  end if;
  return new;
end;
$$;

create or replace function public.validate_finishing_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.production_job_id is null then
    raise exception 'Finishing must link to a production job' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.production_jobs pj
    where pj.id = new.production_job_id
      and pj.company_id = new.company_id
      and pj.order_id = new.order_id
      and pj.status = 'completed'
  ) then
    raise exception 'Finishing production job must be completed and belong to this order/company'
      using errcode = '23514';
  end if;
  if new.status = 'completed' then
    if coalesce(new.rejection_weight_kg, 0) < 0 then
      raise exception 'Finishing rejection weight cannot be negative'
        using errcode = '23514';
    end if;
    if coalesce(new.output_weight_kg, 0) <= 0 then
      raise exception 'Capture accepted finishing output before completion'
        using errcode = '23514';
    end if;
    if coalesce(new.output_weight_kg, 0) + coalesce(new.rejection_weight_kg, 0)
       > coalesce(new.input_weight_kg, 0) + 0.01 then
      raise exception 'Finishing output plus rejection cannot exceed input weight'
        using errcode = '23514';
    end if;
    if new.received_date is null then
      raise exception 'Record finishing receipt date before completion'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_finishing_completion on public.finishing_jobs;
create trigger validate_finishing_completion
before insert or update of company_id, order_id, production_job_id, status,
  input_weight_kg, output_weight_kg, rejection_weight_kg, received_date
on public.finishing_jobs
for each row execute function public.validate_finishing_completion();

create or replace function public.route_completed_finishing_to_packaging()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job record;
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select * into v_job
    from public.production_jobs
    where id = new.production_job_id and company_id = new.company_id;

    insert into public.packaging_jobs(
      company_id, packaging_number, order_id, production_job_id,
      scheduled_date, pieces, profile_weight_kg, profile_length_m,
      status, notes, created_by
    )
    select
      new.company_id,
      concat('PKG-', to_char(current_date, 'YYYY'), '-', substring(new.production_job_id::text, 1, 8)),
      new.order_id,
      new.production_job_id,
      current_date,
      case when coalesce(v_job.actual_quantity_kg, 0) > 0
        then round(coalesce(nullif(v_job.actual_pieces, 0), v_job.pieces, 0) * new.output_weight_kg / v_job.actual_quantity_kg)::integer
        else 0
      end,
      new.output_weight_kg,
      case when coalesce(v_job.actual_quantity_kg, 0) > 0
        then coalesce(nullif(v_job.actual_meters, 0), coalesce(v_job.length_per_piece_m, 0) * coalesce(nullif(v_job.actual_pieces, 0), v_job.pieces, 0)) * new.output_weight_kg / v_job.actual_quantity_kg
        else 0
      end,
      'scheduled',
      concat('Queued after completed ', replace(new.finishing_type, '_', ' '), '. Complete post-finishing QC release and issue materials.'),
      auth.uid()
    where not exists (
      select 1 from public.packaging_jobs existing
      where existing.company_id = new.company_id
        and existing.production_job_id = new.production_job_id
    )
    on conflict (company_id, packaging_number) do nothing;

    perform private.advance_order_stage(
      new.company_id,
      new.order_id,
      'finishing',
      concat('Finishing completed with ', new.output_weight_kg, ' kg accepted output.')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists route_completed_finishing_to_packaging on public.finishing_jobs;
create trigger route_completed_finishing_to_packaging
after insert or update of status on public.finishing_jobs
for each row execute function public.route_completed_finishing_to_packaging();

-- A terminal QC row is a quantity disposition, not an overlapping sample.
-- The total approved/rejected/rework quantity cannot exceed the source output.
create or replace function public.validate_quality_production_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_job record;
  v_finishing record;
  v_source_kg numeric;
  v_disposed_kg numeric;
begin
  if new.production_job_id is null then
    if tg_op = 'INSERT' or new.status in ('approved','rejected','rework') then
      raise exception 'Select the completed production job inspected by this QC record'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select id, company_id, order_id, profile_id, status, actual_quantity_kg, finishing_type
  into v_job from public.production_jobs where id = new.production_job_id;
  if not found or v_job.company_id <> new.company_id or v_job.profile_id <> new.profile_id
     or v_job.status <> 'completed' then
    raise exception 'QC must link to completed production for the same company/profile'
      using errcode = '23514';
  end if;
  v_source_kg := v_job.actual_quantity_kg;

  if coalesce(v_job.finishing_type, 'mill_finish') <> 'mill_finish' then
    if new.finishing_job_id is null then
      raise exception 'Post-finishing QC must link the completed finishing job'
        using errcode = '23514';
    end if;
    select id, company_id, production_job_id, status, output_weight_kg
    into v_finishing from public.finishing_jobs where id = new.finishing_job_id;
    if not found or v_finishing.company_id <> new.company_id
       or v_finishing.production_job_id <> new.production_job_id
       or v_finishing.status <> 'completed' then
      raise exception 'QC finishing job must be completed and match this production job'
        using errcode = '23514';
    end if;
    v_source_kg := v_finishing.output_weight_kg;
  elsif new.finishing_job_id is not null then
    raise exception 'Mill-finish QC must not link an unrelated finishing job'
      using errcode = '23514';
  end if;

  if new.status in ('approved','rejected','rework') then
    if coalesce(new.quantity_checked_kg, 0) <= 0 then
      raise exception 'QC disposition quantity must be greater than zero'
        using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'qc-disposition:' || new.company_id::text || ':'
        || new.production_job_id::text || ':'
        || coalesce(new.finishing_job_id::text, 'mill-finish'),
      0
    ));
    select coalesce(sum(quantity_checked_kg), 0)
    into v_disposed_kg
    from public.quality_inspections
    where company_id = new.company_id
      and production_job_id = new.production_job_id
      and coalesce(finishing_job_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(new.finishing_job_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and status in ('approved','rejected','rework')
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
    if v_disposed_kg + new.quantity_checked_kg > v_source_kg + 0.01 then
      raise exception 'QC disposition exceeds available source output (%)', v_source_kg
        using errcode = '23514';
    end if;
  end if;
  if new.status = 'approved' then
    if coalesce(btrim(new.inspector_name), '') = '' then
      raise exception 'Approved QC requires an inspector name' using errcode = '23514';
    end if;
    if new.surface_finish_ok is distinct from true then
      raise exception 'QC cannot be approved while surface finish is marked failed'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_quality_production_link on public.quality_inspections;
create trigger validate_quality_production_link
before insert or update of company_id, production_job_id, finishing_job_id,
  profile_id, status, quantity_checked_kg, inspector_name, surface_finish_ok
on public.quality_inspections
for each row execute function public.validate_quality_production_link();

create or replace function public.guard_terminal_quality_inspection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('approved', 'rejected', 'rework') then
    raise exception 'Final quality dispositions are immutable; record a new inspection for corrections'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_terminal_quality_inspection on public.quality_inspections;
create trigger guard_terminal_quality_inspection
before update or delete on public.quality_inspections
for each row execute function public.guard_terminal_quality_inspection();

commit;
