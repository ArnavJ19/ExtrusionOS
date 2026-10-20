// Disposable PGlite fixture for the expense ledger integrity candidate migration.
// It replays the historical expense migrations over minimal host tables, seeds legacy
// rows that predate the new guards, then applies the candidate migration file whole.
// Nothing here connects to Supabase.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const companyA = id(1), companyB = id(2);
export const ownerA = id(11), accountsA = id(12), productionA = id(13), adminA = id(14), accountsB = id(21);
export const vendorA = id(31), vendorA2 = id(32), vendorB = id(33);
export const materialA = id(41);
export const legacyPaidLabel = id(51), legacyForgedPaid = id(52), legacyTotalMismatch = id(53), legacyOverpaid = id(54), legacyUsd = id(55);
export const candidateFile = "20261020010000_expense_ledger_integrity.sql";

const migration = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

export async function createExpenseFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    grant usage on schema private to anon, authenticated;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor', true), '')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.companies(id uuid primary key);
    create table public.app_users(id uuid primary key, company_id uuid, role text, is_active boolean default true);
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path = public
      as $$select company_id from public.app_users where id = auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path = public
      as $$select role from public.app_users where id = auth.uid() and is_active$$;
    create function public.get_current_user_company_id() returns uuid language sql stable security definer set search_path = public
      as $$select private.get_current_user_company_id()$$;
    create function public.get_current_user_role() returns text language sql stable security definer set search_path = public
      as $$select private.get_current_user_role()$$;
    create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at := now(); return new; end$$;
    create table public.audit_logs(id bigserial primary key, company_id uuid, actor_id uuid, action text, entity_type text,
      entity_id uuid, metadata_json jsonb, created_at timestamptz default now());
    create table public.vendors(id uuid primary key, company_id uuid not null, vendor_name text);
    create table public.machines(id uuid primary key, company_id uuid not null, machine_name text);
    create table public.inventory_items(id uuid primary key default gen_random_uuid(), company_id uuid not null, item_code text,
      item_name text, item_category text, unit text, current_stock numeric(14,3) default 0, reorder_level numeric default 0,
      average_rate numeric(14,2) default 0, is_active boolean default true, updated_at timestamptz default now());
    create table public.inventory_movements(id uuid primary key default gen_random_uuid(), company_id uuid not null,
      inventory_item_id uuid not null, movement_type text not null, quantity numeric(14,3) not null, unit text not null,
      reference_type text, reference_id uuid, rate numeric(14,2), amount numeric(14,2), movement_date date default current_date,
      notes text, created_by uuid, created_at timestamptz default now(),
      constraint movement_type_check check (movement_type in ('purchase_in','production_in','production_issue','dispatch_out','scrap_in','scrap_out','adjustment_in','adjustment_out','return_in')));
    create table public.foundry_external_aluminium_sources(id uuid primary key default gen_random_uuid(), company_id uuid not null,
      source_number text, item_type text default 'ingot', alloy text default '6063', weight_kg numeric(14,3) default 0,
      available_weight_kg numeric(14,3), received_date date default current_date, vendor_id uuid, status text default 'available',
      updated_at timestamptz default now());
    create table public.foundry_aluminium_scrap(id uuid primary key default gen_random_uuid(), company_id uuid not null,
      scrap_number text, scrap_quality text default 'mixed', scrap_source text default 'market', weight_kg numeric(14,3) default 0,
      available_weight_kg numeric(14,3), received_date date default current_date, vendor_id uuid, status text default 'available',
      updated_at timestamptz default now());
    create table public.outsourced_billet_batches(id uuid primary key default gen_random_uuid(), company_id uuid not null,
      batch_number text, alloy text default '6063', temper text default 'T5', billet_diameter_inch numeric default 7,
      weight_kg numeric(14,3) default 0, price_per_kg numeric(14,2), total_price numeric(14,2) default 0,
      received_date date default current_date, status text default 'received', vendor_id uuid, updated_at timestamptz default now());
    create table public.packaging_materials(id uuid primary key, company_id uuid not null, material_code text, material_name text,
      material_type text, unit text);
    create table public.energy_readings(id uuid primary key default gen_random_uuid(), company_id uuid not null,
      reading_date date not null default current_date, energy_type text not null, consumption numeric(12,2) default 0,
      unit text default 'kWh', rate_per_unit numeric(10,2) default 0, total_cost numeric(12,2) default 0);
    create table public.breakdown_logs(id uuid primary key default gen_random_uuid(), company_id uuid not null,
      machine_id text, machine_type text default 'other', breakdown_date date default current_date, issue_description text,
      cost numeric(12,2) default 0, vendor_name text, bill_number text, bill_date date);
    insert into public.companies values ('${companyA}'), ('${companyB}');
    insert into auth.users values ('${ownerA}'), ('${accountsA}'), ('${productionA}'), ('${adminA}'), ('${accountsB}');
    insert into public.app_users values ('${ownerA}','${companyA}','owner',true), ('${accountsA}','${companyA}','accounts',true),
      ('${productionA}','${companyA}','production',true), ('${adminA}','${companyA}','admin',true),
      ('${accountsB}','${companyB}','accounts',true);
    insert into public.vendors values ('${vendorA}','${companyA}','Shree Metals'), ('${vendorA2}','${companyA}','Om Packaging'),
      ('${vendorB}','${companyB}','Other Tenant Vendor');
    insert into public.packaging_materials values ('${materialA}','${companyA}','STRETCH','Stretch film','stretch_film','meter');
  `);
  for (const name of ["20260531000000_expenses_module.sql", "20260531010000_expenses_phase2_packaging_and_controls.sql",
    "20260531020000_expenses_phase3_energy_maintenance_approval.sql"]) {
    await db.exec(migration(name));
  }
  // Supabase grants table DML to authenticated by default; the candidate must revoke it.
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;`);
  // Legacy rows written before the candidate guards existed.
  await db.exec(`
    insert into public.expense_ledger(id, company_id, expense_number, expense_category, description, base_amount, tax_amount,
      total_amount, approval_status, amount_paid)
    values
      ('${legacyPaidLabel}', '${companyA}', 'EXP-LEGACY-PAID', 'utilities', 'Labelled paid without payment', 500, 0, 500, 'draft', 0),
      ('${legacyForgedPaid}', '${companyA}', 'EXP-LEGACY-FORGED', 'utilities', 'Forged paid projection', 800, 0, 800, 'draft', 0),
      ('${legacyTotalMismatch}', '${companyA}', 'EXP-LEGACY-TOTAL', 'utilities', 'Total ignores tax', 100, 18, 100, 'draft', 0),
      ('${legacyOverpaid}', '${companyA}', 'EXP-LEGACY-OVER', 'utilities', 'Overpaid by concurrent posting', 100, 0, 100, 'draft', 0),
      ('${legacyUsd}', '${companyA}', 'EXP-LEGACY-USD', 'utilities', 'Imported spare', 50, 0, 50, 'draft', 0);
    update public.expense_ledger set approval_status = 'paid' where id = '${legacyPaidLabel}';
    update public.expense_ledger set amount_paid = 800 where id = '${legacyForgedPaid}';
    update public.expense_ledger set currency = 'USD' where id = '${legacyUsd}';
    insert into public.expense_payments(company_id, expense_ledger_id, amount_paid, payment_date)
      values ('${companyA}', '${legacyOverpaid}', 60, '2026-01-02');
    alter table public.expense_payments disable trigger sync_expense_payment_totals;
    insert into public.expense_payments(company_id, expense_ledger_id, amount_paid, payment_date)
      values ('${companyA}', '${legacyOverpaid}', 60, '2026-01-02');
    alter table public.expense_payments enable trigger sync_expense_payment_totals;
    -- Bypass the original trigger's total check to simulate the race outcome.
    alter table public.expense_ledger disable trigger expense_apply_totals;
    update public.expense_ledger set total_amount = 100 where id = '${legacyTotalMismatch}';
    alter table public.expense_ledger enable trigger expense_apply_totals;
  `);
  await db.exec(migration(candidateFile));
  return db;
}

export function actor(db, userId) {
  return {
    async query(text, params = []) {
      await db.exec(`set test.actor = '${userId}'; set role authenticated;`);
      try { return await db.query(text, params); }
      finally { await db.exec("reset role; reset test.actor;"); }
    },
    async rpc(name, args) {
      const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
      const result = await this.query(`select public.${name}(${placeholders}) as data`, args);
      return result.rows[0].data;
    }
  };
}

// Runs statements as the database owner while impersonating an application user, the
// path SECURITY DEFINER triggers and source-module writes take.
export async function asOwner(db, userId, text, params = []) {
  await db.exec(`set test.actor = '${userId}';`);
  try { return await db.query(text, params); }
  finally { await db.exec("reset test.actor;"); }
}
