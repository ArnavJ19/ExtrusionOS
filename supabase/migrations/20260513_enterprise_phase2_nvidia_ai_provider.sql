-- ExtrusionOS Enterprise Phase 2: NVIDIA AI provider support
-- Adds NVIDIA to AI provider settings without storing any API secret in Postgres.

begin;

alter table public.company_settings drop constraint if exists company_settings_ai_provider_check;
alter table public.company_settings add constraint company_settings_ai_provider_check
  check (ai_provider in ('local_rules','nvidia','openai','anthropic','azure_openai','other'));

commit;
