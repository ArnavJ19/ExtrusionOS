begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Company-first list indexes do not cover foreign-key checks by the referenced identity alone.
create index record_discussion_reply_fk_idx on public.record_discussions(reply_to,company_id);
create index record_discussion_actor_fk_idx on public.record_discussions(recorded_by,company_id);
create index operating_procedure_owner_fk_idx on public.operating_procedures(owner_id,company_id);
create index operating_procedure_backup_fk_idx on public.operating_procedures(backup_id,company_id);
create index operating_procedure_creator_fk_idx on public.operating_procedures(created_by,company_id);
create index operating_procedure_event_parent_fk_idx on public.operating_procedure_events(procedure_id,company_id);
create index operating_procedure_event_actor_fk_idx on public.operating_procedure_events(recorded_by,company_id);
create index daily_routine_procedure_fk_idx on public.daily_routine_runs(procedure_id,company_id);
create index daily_routine_starter_fk_idx on public.daily_routine_runs(started_by,company_id);
create index daily_routine_completion_actor_fk_idx on public.daily_routine_completions(recorded_by,company_id);
commit;
