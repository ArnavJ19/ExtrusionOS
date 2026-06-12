-- ExtrusionOS Enterprise Phase 2: AI quotation and costing copilot
-- Local/rule-based first. External AI remains disabled unless explicitly configured later.

begin;

alter table public.company_settings
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_provider text not null default 'local_rules',
  add column if not exists ai_model text not null default 'local-rules-v1',
  add column if not exists allow_external_ai boolean not null default false,
  add column if not exists redact_sensitive_data boolean not null default true,
  add column if not exists max_context_records integer not null default 10;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_settings_ai_provider_check'
      and conrelid = 'public.company_settings'::regclass
  ) then
    alter table public.company_settings add constraint company_settings_ai_provider_check
      check (ai_provider in ('local_rules','openai','anthropic','azure_openai','other'));
  end if;
end $$;

create table if not exists public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id),
  interaction_type text not null,
  input_text text not null,
  output_json jsonb not null default '{}'::jsonb,
  related_entity_type text,
  related_entity_id uuid,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  constraint ai_interactions_type_check check (interaction_type in ('quotation_assist','customer_summary','order_summary','payment_followup','production_insight','document_summary')),
  constraint ai_interactions_status_check check (status in ('completed','failed','redacted','external_blocked'))
);

create table if not exists public.quote_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  suggested_by uuid references auth.users(id),
  source_type text not null default 'natural_language',
  source_text text not null,
  suggestion_json jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,2) not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_suggestions_source_type_check check (source_type in ('natural_language','whatsapp_message','drawing_note','past_quote','manual')),
  constraint quote_suggestions_status_check check (status in ('draft','accepted','rejected','converted_to_quote')),
  constraint quote_suggestions_confidence_check check (confidence_score >= 0 and confidence_score <= 100)
);

create index if not exists ai_interactions_company_created_idx on public.ai_interactions(company_id, created_at desc);
create index if not exists ai_interactions_company_type_idx on public.ai_interactions(company_id, interaction_type, created_at desc);
create index if not exists ai_interactions_company_entity_idx on public.ai_interactions(company_id, related_entity_type, related_entity_id);
create index if not exists quote_suggestions_company_created_idx on public.quote_suggestions(company_id, created_at desc);
create index if not exists quote_suggestions_company_customer_idx on public.quote_suggestions(company_id, customer_id, created_at desc);
create index if not exists quote_suggestions_company_status_idx on public.quote_suggestions(company_id, status, created_at desc);

drop trigger if exists set_quote_suggestions_updated_at on public.quote_suggestions;
create trigger set_quote_suggestions_updated_at before update on public.quote_suggestions for each row execute function public.set_updated_at();

alter table public.ai_interactions enable row level security;
alter table public.quote_suggestions enable row level security;

drop policy if exists "ai interactions tenant read" on public.ai_interactions;
create policy "ai interactions tenant read" on public.ai_interactions
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "ai interactions tenant insert" on public.ai_interactions;
create policy "ai interactions tenant insert" on public.ai_interactions
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','sales')
  );

drop policy if exists "ai interactions tenant delete admin" on public.ai_interactions;
create policy "ai interactions tenant delete admin" on public.ai_interactions
  for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "quote suggestions tenant read" on public.quote_suggestions;
create policy "quote suggestions tenant read" on public.quote_suggestions
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "quote suggestions tenant insert" on public.quote_suggestions;
create policy "quote suggestions tenant insert" on public.quote_suggestions
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','sales')
  );

drop policy if exists "quote suggestions tenant update" on public.quote_suggestions;
create policy "quote suggestions tenant update" on public.quote_suggestions
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','sales')
  ) with check (company_id = public.get_current_user_company_id());

drop policy if exists "quote suggestions tenant delete admin" on public.quote_suggestions;
create policy "quote suggestions tenant delete admin" on public.quote_suggestions
  for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

do $$
begin
  if to_regprocedure('public.record_enterprise_audit()') is not null then
    drop trigger if exists audit_ai_interactions on public.ai_interactions;
    create trigger audit_ai_interactions after insert or update or delete on public.ai_interactions for each row execute function public.record_enterprise_audit();
    drop trigger if exists audit_quote_suggestions on public.quote_suggestions;
    create trigger audit_quote_suggestions after insert or update or delete on public.quote_suggestions for each row execute function public.record_enterprise_audit();
  end if;
end $$;

commit;
