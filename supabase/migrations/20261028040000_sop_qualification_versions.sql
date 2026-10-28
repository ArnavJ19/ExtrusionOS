-- Feature 77 integration: qualification refers to released instructions, not
-- only to the separate procedure ownership-metadata revision (feature 76).
begin;
alter table public.employee_competencies add column instruction_version_id uuid references public.procedure_versions(id);
create index employee_competencies_instruction_version on public.employee_competencies(instruction_version_id);
create function private.capture_competency_instructions() returns trigger language plpgsql security definer set search_path=public,private as $$
declare procedure uuid;
begin
  select procedure_id into procedure from public.competencies where id=new.competency_id and company_id=new.company_id;
  new.instruction_version_id:=(private.procedure_applicable_version(procedure,private.ist_today())).id;
  return new;
end $$;
create trigger a_capture_competency_instructions before insert on public.employee_competencies for each row execute function private.capture_competency_instructions();
create or replace function private.competency_standing(p_employee uuid,p_competency uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare g public.employee_competencies;v_revision integer;v_procedure uuid;v_version public.procedure_versions;
begin
  select * into g from public.employee_competencies where employee_id=p_employee and competency_id=p_competency and revoked_at is null;
  if not found then return jsonb_build_object('granted',null,'effective','none','reason','not_granted');end if;
  if g.expires_at is not null and g.expires_at<=now() then return jsonb_build_object('granted',g.level,'effective','none','reason','expired','expires_at',g.expires_at);end if;
  select op.revision,op.id into v_revision,v_procedure from public.competencies c join public.operating_procedures op on op.id=c.procedure_id where c.id=p_competency;
  v_version:=private.procedure_applicable_version(v_procedure,private.ist_today());
  if g.level='independent' and ((v_revision is not null and coalesce(g.procedure_revision,0)<v_revision) or g.instruction_version_id is distinct from v_version.id) then
    return jsonb_build_object('granted',g.level,'effective','supervised','reason','procedure_revised','granted_revision',g.procedure_revision,'current_revision',coalesce(v_version.version_no,v_revision));
  end if;
  return jsonb_build_object('granted',g.level,'effective',g.level,'reason',null,'expires_at',g.expires_at);
end $$;
revoke all on function private.capture_competency_instructions(),private.competency_standing(uuid,uuid) from public,anon,authenticated;
commit;
