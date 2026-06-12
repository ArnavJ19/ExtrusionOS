-- Migration for Machines Module and Foundry Enhancements

alter table public.machines
  add column if not exists machine_code text,
  add column if not exists purchase_date date,
  add column if not exists manufacturer text,
  add column if not exists maintenance_connected boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'machines_company_code_unique') then
    alter table public.machines add constraint machines_company_code_unique unique (company_id, machine_code);
  end if;
end $$;
