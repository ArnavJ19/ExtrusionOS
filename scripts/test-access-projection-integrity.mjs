import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migrationDir = new URL("../supabase/migrations/", import.meta.url);
const accessMigrationName = "20261008010000_access_projection_integrity.sql";
const migrations = [readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"), ...readdirSync(migrationDir)
  .filter((file) => file.endsWith(".sql") && file < accessMigrationName)
  .sort()
  .map((file) => readFileSync(new URL(file, migrationDir), "utf8"))];
const migration = readFileSync(new URL(`../supabase/migrations/${accessMigrationName}`, import.meta.url), "utf8");
const id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const companyA = id(1);
const companyB = id(2);
const dealerA = id(3);
const dealerB = id(4);
const ownerA = id(5);
const dealerUserA = id(6);
const dealerUserB = id(7);
const salesA = id(8);
const accountsA = id(9);
const salesManagerA = id("2");
const productionA = id("a");
const viewerA = id("b");
const suspendedA = id("c");
const dispatchManager = id("0");
const customerA = id("d");
const customerB = id("e");
const orderA = id("f");
const orderB = id("7");
const orderOtherCompany = id("8");
const quoteA = id("9");
const quoteB = id("a");
const quoteOtherCompany = id("b");
const orderLineA = id("c");
const quoteLineA = id("d");
const configA = id("e");
const templateA = id("f");
const profileA = id("7");
const glassA = id("8");
const finishA = id("9");
const hardwareA = id("a");

function capture(regex, text) {
  return [...text.matchAll(regex)];
}

const uuidColumns = new Set(["id", "company_id", "customer_id", "dealer_id", "quote_id", "order_id", "profile_id", "die_id", "template_id", "series_id", "finish_id", "glass_id", "hardware_item_id", "item_id", "source_record_id", "source_line_id", "created_by", "created_by_user_id", "created_by_dealership_id", "approved_by", "deleted_by", "branch_id", "plant_id", "profile_stock_batch_id", "configuration_id", "user_id"]);
function actualTableDefinitions() {
  const tables = new Map();
  for (const source of migrations) {
    for (const [, table, body] of capture(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.(\w+)\s*\(([\s\S]*?)\n\s*\);/gi, source)) {
      const columns = tables.get(table) ?? new Map();
      for (const line of body.split(/\r?\n/)) {
        const column = line.match(/^\s*([a-z_]\w*)\s+([a-z_]\w*(?:\s*\([^)]*\))?)/i);
        if (!column || /^(primary|unique|check|foreign|constraint|exclude)$/i.test(column[1])) continue;
        columns.set(column[1].toLowerCase(), column[2].toLowerCase());
      }
      tables.set(table, columns);
    }
    for (const [, table, alterBody] of capture(/alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+([\s\S]*?);/gi, source)) {
      const columns = tables.get(table) ?? new Map();
      for (const [, column, type] of capture(/add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_]\w*)\s+([a-z_]\w*(?:\s*\([^)]*\))?)/gi, alterBody)) {
        if (!columns.has(column.toLowerCase())) columns.set(column.toLowerCase(), type.toLowerCase());
      }
      tables.set(table, columns);
    }
    const hostTables = capture(/foreach\s+host_table\s+in\s+array\s+array\[([\s\S]*?)\]/gi, source)
      .flatMap(([, body]) => capture(/'([a-z_]\w*)'/gi, body).map((match) => match[1]));
    const dynamicColumns = capture(/alter\s+table\s+public\.%I\s+add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_]\w*)\s+([a-z_]\w*(?:\s*\([^)]*\))?)/gi, source);
    for (const table of hostTables) {
      const columns = tables.get(table) ?? new Map();
      for (const [, column, type] of dynamicColumns) {
        if (!columns.has(column.toLowerCase())) columns.set(column.toLowerCase(), type.toLowerCase());
      }
      tables.set(table, columns);
    }
  }
  return tables;
}

function typeFor(table, column, definitions) {
  const sourceType = definitions.get(table)?.get(column);
  if (!sourceType) throw new Error(`Column ${table}.${column} is absent from historical CREATE/ALTER definitions`);
  if (sourceType.startsWith("uuid") || uuidColumns.has(column) || column.endsWith("_id")) return "uuid";
  if (sourceType.startsWith("bool")) return "boolean";
  if (sourceType.startsWith("json")) return "jsonb";
  if (/^(numeric|decimal|int|smallint|bigint|real|double|float)/.test(sourceType)) return "numeric";
  if (/^(timestamp|date|time)/.test(sourceType)) return "timestamptz";
  return "text";
}

function columnsForTables() {
  const definitions = actualTableDefinitions();
  const tables = new Map();
  const selectedTables = new Set();
  for (const table of ["system_series", "system_profiles", "system_profile_cuts", "system_beading_cuts", "profile_optimization_runs"]) selectedTables.add(table);
  const add = (table, column) => {
    const columns = tables.get(table) ?? new Map();
    columns.set(column, typeFor(table, column, definitions));
    tables.set(table, columns);
  };
  for (const [, viewBody] of capture(/create\s+or\s+replace\s+view\s+public\.\w+[\s\S]*?\bas\s+([\s\S]*?);/gi, migration)) {
    const aliases = new Map();
    for (const [, table, alias] of capture(/(?:from|join)\s+public\.(\w+)\s+(?:as\s+)?([a-z_]\w*)/gi, viewBody)) {
      if (table.endsWith("_authorized")) continue;
      selectedTables.add(table);
      const names = aliases.get(alias) ?? new Set();
      names.add(table);
      aliases.set(alias, names);
    }
    for (const [alias, names] of aliases) {
      const fields = capture(new RegExp(`\\b${alias}\\.([a-z_]\\w*)`, "gi"), viewBody).map((match) => match[1].toLowerCase());
      for (const table of names) for (const field of fields) add(table, field);
    }
  }
  for (const [, columnList, relationList] of capture(/grant select\s*\(([\s\S]*?)\)\s*on\s*([\s\S]*?)\s*to authenticated/gi, migration)) {
    const fields = columnList.split(",").map((field) => field.trim().toLowerCase()).filter((field) => /^[a-z_]\w*$/i.test(field));
    const relations = capture(/public\.(\w+)/gi, relationList).map((match) => match[1]);
    for (const table of relations) {
      selectedTables.add(table);
      for (const field of fields) add(table, field);
    }
  }
  for (const [, table] of capture(/create policy\s+\w+\s+on\s+public\.(\w+)/gi, migration)) {
    selectedTables.add(table);
    if (!tables.has(table)) tables.set(table, new Map());
  }
  for (const table of selectedTables) {
    const sourceColumns = definitions.get(table);
    if (!sourceColumns?.size) throw new Error(`Table ${table} has no historical CREATE/ALTER definition`);
    for (const column of sourceColumns.keys()) add(table, column);
  }
  return tables;
}

function createTableSql(name, columns) {
  const defs = [...columns].sort(([a], [b]) => a.localeCompare(b)).map(([column, type]) => `"${column}" ${type}`);
  if (!columns.has("id")) defs.unshift('"id" uuid');
  return `create table public."${name}" (${defs.join(", ")}, primary key (id));`;
}

async function setIdentity(db, userId) {
  await db.exec(`select set_config('test.uid','${userId}',false); set role authenticated;`);
}

async function resetIdentity(db) {
  await db.exec("reset role; select set_config('test.uid','',false);");
}

async function expectNoRows(db, sql) {
  const result = await db.query(sql);
  assert.equal(result.rows.length, 0, sql);
}

export async function runAccessProjectionIntegrityChecks() {
  const db = new PGlite();
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); };
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema private;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.app_users(id uuid primary key, company_id uuid, business_role text, dealership_id uuid, is_active boolean not null default true);
      create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$ select company_id from public.app_users where id=auth.uid() and is_active $$;
      create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$ select business_role from public.app_users where id=auth.uid() and is_active $$;
      create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$ select dealership_id from public.app_users where id=auth.uid() and is_active $$;
      grant usage on schema auth, private to authenticated;
      grant execute on all functions in schema auth to authenticated;
      grant execute on all functions in schema private to authenticated;
    `);
    for (const [table, columns] of columnsForTables()) {
      await db.exec(createTableSql(table, columns));
      await db.exec(`alter table public."${table}" enable row level security;`);
    }
    for (const table of ["production_jobs", "packing_list_items", "invoice_items", "order_dealer_stock_fulfillments"]) {
      await db.exec(`create policy harness_company_scope on public."${table}" for all using (company_id=private.get_current_user_company_id()) with check (company_id=private.get_current_user_company_id());`);
    }
    await db.exec(`
      alter default privileges for role postgres in schema public grant all on tables to authenticated;
      grant all on all tables in schema public to authenticated;
      grant usage on schema public to anon, authenticated;
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`
      create function public.harness_update_operational_order(p_order_id uuid, p_priority text)
      returns uuid language plpgsql security definer set search_path=public,private as $$
      declare v_company_id uuid := private.get_current_user_company_id(); v_order_id uuid;
      begin
        if auth.uid() is null or private.get_current_user_role() not in ('owner','admin','dispatch_manager') then
          raise exception 'Permission denied for orders' using errcode='42501';
        end if;
        update public.orders set priority=p_priority where id=p_order_id and company_id=v_company_id returning id into v_order_id;
        return v_order_id;
      end $$;
      create function public.harness_change_order_value(p_order_id uuid, p_value numeric)
      returns uuid language plpgsql security definer set search_path=public,private as $$
      declare v_order_id uuid;
      begin
        if auth.uid() is null or private.get_current_user_role() not in ('owner','admin','dispatch_manager') then
          raise exception 'Permission denied for orders' using errcode='42501';
        end if;
        update public.orders set order_value=p_value where id=p_order_id and company_id=private.get_current_user_company_id() returning id into v_order_id;
        return v_order_id;
      end $$;
      create function public.harness_reassign_quote_customer(p_quote_id uuid, p_customer_id uuid)
      returns uuid language plpgsql security definer set search_path=public,private as $$
      declare v_quote_id uuid;
      begin
        update public.quotes set customer_id=p_customer_id where id=p_quote_id returning id into v_quote_id;
        return v_quote_id;
      end $$;
      create function public.harness_insert_quote(p_company_id uuid, p_customer_id uuid, p_dealer_id uuid)
      returns uuid language plpgsql security definer set search_path=public,private as $$
      declare v_quote_id uuid;
      begin
        insert into public.quotes(company_id,customer_id,dealer_id,quote_number,grand_total)
        values (p_company_id,p_customer_id,p_dealer_id,'HARNESS-NEW',0) returning id into v_quote_id;
        return v_quote_id;
      end $$;
      grant execute on function public.harness_update_operational_order(uuid,text) to authenticated;
      grant execute on function public.harness_change_order_value(uuid,numeric) to authenticated;
      grant execute on function public.harness_reassign_quote_customer(uuid,uuid) to authenticated;
      grant execute on function public.harness_insert_quote(uuid,uuid,uuid) to authenticated;
    `);

    await db.exec(`
      insert into public.app_users(id,company_id,business_role,dealership_id,is_active) values
        ('${ownerA}','${companyA}','owner',null,true),
        ('${dealerUserA}','${companyA}','dealer_admin','${dealerA}',true),
        ('${dealerUserB}','${companyA}','dealer_admin','${dealerB}',true),
        ('${salesA}','${companyA}','sales',null,true),
        ('${accountsA}','${companyA}','accounts',null,true),
        ('${salesManagerA}','${companyA}','sales_manager',null,true),
        ('${productionA}','${companyA}','production',null,true),
        ('${viewerA}','${companyA}','viewer',null,true),
        ('${dispatchManager}','${companyA}','dispatch_manager',null,true),
        ('${suspendedA}','${companyA}','owner',null,false);
      insert into public.customers(id,company_id,customer_name,company_name) values
        ('${customerA}','${companyA}','Dealer A Contact','Dealer A'),
        ('${customerB}','${companyA}','Dealer B Contact','Dealer B');
      insert into public.orders(id,company_id,customer_id,dealer_id,order_number,order_value,current_stage,priority) values
        ('${orderA}','${companyA}','${customerA}','${dealerA}','OA-1','500','order_confirmed','normal'),
        ('${orderB}','${companyA}','${customerB}','${dealerB}','OB-1','600','order_confirmed','normal'),
        ('${orderOtherCompany}','${companyB}','${customerB}','${dealerB}','OC-1','700','order_confirmed','normal');
      insert into public.quotes(id,company_id,customer_id,dealer_id,quote_number,grand_total,total_margin_amount,notes,approval_notes) values
        ('${quoteA}','${companyA}','${customerA}','${dealerA}','QA-1','900','200','private quote note','approval private'),
        ('${quoteB}','${companyA}','${customerB}','${dealerB}','QB-1','800','100','sibling quote note','sibling approval'),
        ('${quoteOtherCompany}','${companyB}','${customerB}','${dealerB}','QC-1','700','90','foreign note','foreign approval');
      insert into public.order_items(id,company_id,order_id,material_price,internal_cost,supplier_rate,internal_note,margin,net_rate,final_line_value) values
        ('${orderLineA}','${companyA}','${orderA}','120','75','62','private order line','25','120','500');
      insert into public.order_dealer_stock_fulfillments(id,company_id,order_id,profile_id,profile_stock_batch_id,unit_rate,quoted_line_value,fulfilled_weight_kg,fulfilled_length_m,fulfilled_pieces,notes) values
        ('${id("e")}','${companyA}','${orderA}','${profileA}','${id("2")}','120','500','10','5','2','internal fulfillment note');
      insert into public.quote_items(id,company_id,quote_id,material_price,internal_cost,supplier_rate,internal_note,margin_percent,margin_amount,price_per_kg) values
        ('${quoteLineA}','${companyA}','${quoteA}','130','80','66','private quote line','24','200','130');
      insert into public.system_configurations(id,company_id,customer_id,series_id,template_id,width_mm,height_mm,calculated_price,bom_json,cutting_list_json,options_json,subtotal,gst_percent,gst_amount,grand_total,margin_percent,internal_cost,selling_price,status) values
        ('${configA}','${companyA}','${customerA}','${profileA}','${templateA}','1000','1200','300','{}','{}','{"aluminium_rate_per_kg":999}', '200','18','36','236','20','150','236','calculated');
      insert into public.system_templates(id,company_id,template_code,template_name,system_type,formula_json,validation_rules_json,preview_config_json) values
        ('${templateA}','${companyA}','T1','Template 1','custom','{"costing":{"supplier_rate":500}}','{"secret":true}','{"secret":true}');
      insert into public.system_series(id,company_id) values ('${id("2")}','${companyA}'),('${id("3")}','${companyB}');
      insert into public.system_profiles(id,company_id) values ('${id("4")}','${companyA}'),('${id("5")}','${companyB}');
      insert into public.system_profile_cuts(id,company_id) values ('${id("6")}','${companyA}'),('${id("7")}','${companyB}');
      insert into public.system_beading_cuts(id,company_id) values ('${id("8")}','${companyA}'),('${id("9")}','${companyB}');
      insert into public.profile_optimization_runs(id,company_id) values ('${id("a")}','${companyA}'),('${id("b")}','${companyB}');
      insert into public.system_material_summary(id,company_id,configuration_id,material_type,item_name,quantity,unit,total_weight_kg,rate,amount) values
        ('${profileA}','${companyA}','${configA}','aluminium_profile','Profile 1','1','kg','4','75','300');
      insert into public.system_glass_cuts(id,company_id,configuration_id,glass_id,panel_index,glass_label,width_mm,height_mm,quantity,area_sqft,rate,amount) values
        ('${glassA}','${companyA}','${configA}','${glassA}','1','Panel 1','400','500','1','2','10','20');
      insert into public.system_hardware_bom(id,company_id,configuration_id,hardware_item_id,item_code,item_name,hardware_category,quantity,unit,rate,amount) values
        ('${hardwareA}','${companyA}','${configA}','${hardwareA}','H1','Handle','handle','1','pcs','8','8');
      insert into public.glass_items(id,company_id,glass_code,glass_name,rate_per_sqft,rate_per_sqm,is_active) values
        ('${glassA}','${companyA}','G1','Glass 1','10','100','true');
      insert into public.finish_options(id,company_id,finish_code,finish_name,rate_type,rate,is_active) values
        ('${finishA}','${companyA}','F1','Finish 1','per_kg','50','true');
      insert into public.hardware_items(id,company_id,item_code,item_name,hardware_category,unit,default_rate,is_active) values
        ('${hardwareA}','${companyA}','H1','Handle','handle','pcs','8','true');
      insert into public.company_settings(id,company_id,default_gst_percent,default_margin_percent,default_conversion_charge_per_kg,default_transport_charge,minimum_margin_percent) values
        ('${id("1")}','${companyA}','18','15','85','20','8');
      insert into public.profile_stock_reservations(id,company_id) values ('${id("0")}', '${companyA}');
      insert into public.production_jobs(id,company_id,order_id,profile_id,job_number,status,material_price,internal_cost,supplier_rate,margin,internal_note) values
        ('${id("1")}','${companyA}','${orderA}','${profileA}','PJ-1','in_progress','120','75','62','25','private job note');
      insert into public.packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,material_price,internal_cost,supplier_rate,margin,internal_note) values
        ('${id("2")}','${companyA}','${id("3")}','${profileA}','B-1',10,120,20,'120','75','62','25','private packing note');
      insert into public.invoice_items(id,company_id,invoice_id,item_description,quantity,unit_rate,line_total,material_price,internal_cost,supplier_rate,margin,internal_note) values
        ('${id("3")}','${companyA}','${id("4")}','Line 1',10,120,1200,'120','75','62','25','private invoice note');
    `);

    await check("migration applies and view grants are SELECT-only despite permissive default grants", async () => {
      const views = ["orders_authorized", "order_items_authorized", "quotes_authorized", "quote_items_authorized", "order_dealer_stock_fulfillments_authorized", "system_configurations_authorized", "system_templates_authorized", "system_material_summary_authorized", "system_glass_cuts_authorized", "system_hardware_bom_authorized", "glass_items_authorized", "finish_options_authorized", "hardware_items_authorized", "company_settings_authorized", "production_jobs_authorized", "packing_list_items_authorized", "invoice_items_authorized"];
      for (const view of views) {
        const result = await db.query(`select has_table_privilege('authenticated','public.${view}','SELECT') as can_read, has_table_privilege('authenticated','public.${view}','INSERT') as can_insert, has_table_privilege('authenticated','public.${view}','UPDATE') as can_update, has_table_privilege('authenticated','public.${view}','DELETE') as can_delete`);
        assert.deepEqual(result.rows[0], { can_read: true, can_insert: false, can_update: false, can_delete: false }, view);
      }
    });

    await check("dealer reads are company- and relationship-scoped with commercial but no internal fields", async () => {
      await setIdentity(db, dealerUserA);
      const orderRows = await db.query("select id, order_value from public.orders_authorized order by order_number");
      assert.deepEqual(orderRows.rows, [{ id: orderA, order_value: "500" }]);
      const safeOrderNotes = await db.query("select notes, production_notes, fulfillment_notes from public.orders_authorized");
      assert.deepEqual(safeOrderNotes.rows, [{ notes: null, production_notes: null, fulfillment_notes: null }]);
      const quoteRows = await db.query("select id, grand_total, total_margin_amount, notes, approval_notes from public.quotes_authorized order by quote_number");
      assert.deepEqual(quoteRows.rows, [{ id: quoteA, grand_total: "900", total_margin_amount: null, notes: null, approval_notes: null }]);
      const lineRows = await db.query("select id, billet_rate_per_kg, conversion_charge_per_kg, line_subtotal, material_price, internal_cost, supplier_rate, internal_note from public.quote_items_authorized");
      assert.deepEqual(lineRows.rows, [{ id: quoteLineA, billet_rate_per_kg: null, conversion_charge_per_kg: null, line_subtotal: null, material_price: null, internal_cost: null, supplier_rate: null, internal_note: null }]);
      const directLines = await db.query("select id from public.quote_items");
      assert.deepEqual(directLines.rows, [{ id: quoteLineA }]);
      const workflowStatus = await db.query(`select status from public.quotes where id='${quoteA}'`);
      assert.deepEqual(workflowStatus.rows, [{ status: null }], "base grant retains the safe compare-and-set workflow column");
      const ownCustomer = await db.query("select id from public.customers order by id");
      assert.deepEqual(ownCustomer.rows, [{ id: customerA }]);
      await assert.rejects(db.query("select grand_total from public.quotes"), /permission denied/i);
      await assert.rejects(db.query("select notes,production_notes,fulfillment_notes from public.orders"), /permission denied/i);
      await assert.rejects(db.query("select internal_cost from public.quote_items"), /permission denied/i);
      await assert.rejects(db.query("select unit_rate from public.order_dealer_stock_fulfillments"), /permission denied/i);
      const dealerFulfillment = await db.query("select unit_rate, quoted_line_value, notes from public.order_dealer_stock_fulfillments_authorized");
      assert.deepEqual(dealerFulfillment.rows, [{ unit_rate: "120", quoted_line_value: "500", notes: null }]);
      const commercialLines = await db.query("select price_per_kg, line_total_before_gst from public.quote_items_authorized");
      assert.equal(commercialLines.rows.length, 1, "dealer retains own customer-facing selling values");
      await assert.rejects(db.query(`update public.quote_items set margin_percent=50 where id='${quoteLineA}'`), /Only owners and admins may create or change priced quote lines/i);
      await assert.rejects(db.query(`update public.quotes set grand_total=1 where id='${quoteA}'`), /Only owners and admins may change priced quote totals/i);
      await assert.rejects(db.query(`update public.quotes set customer_id='${customerB}' where id='${quoteA}'`), /Quotation company, customer, dealer, and creator cannot be changed/i);
      await assert.rejects(db.query(`insert into public.quotes(company_id,customer_id,dealer_id,quote_number,grand_total) values ('${companyA}','${customerB}','${dealerA}','HARNESS-DIRECT',0)`), /Only owners and admins may create quotations/i);
      await assert.rejects(db.query(`select public.harness_reassign_quote_customer('${quoteA}','${customerB}')`), /Quotation company, customer, dealer, and creator cannot be changed/i);
      await assert.rejects(db.query(`select public.harness_insert_quote('${companyA}','${customerB}','${dealerA}')`), /Only owners and admins may create quotations/i);
      await resetIdentity(db);
    });

    await check("sales and operations projections mask costs, rates, margins, formula JSON, and embedded options", async () => {
      await setIdentity(db, salesA);
      const salesConfig = await db.query("select grand_total, internal_cost, margin_percent, options_json from public.system_configurations_authorized");
      assert.deepEqual(salesConfig.rows, [{ grand_total: "236", internal_cost: null, margin_percent: null, options_json: null }]);
      const salesSummary = await db.query("select rate, amount from public.system_material_summary_authorized");
      assert.deepEqual(salesSummary.rows, [{ rate: null, amount: null }]);
      const salesTemplate = await db.query("select formula_json, validation_rules_json, preview_config_json from public.system_templates_authorized");
      assert.deepEqual(salesTemplate.rows, [{ formula_json: null, validation_rules_json: null, preview_config_json: null }]);
      await assert.rejects(db.query("select options_json from public.system_configurations"), /permission denied/i);
      await assert.rejects(db.query("select formula_json from public.system_templates"), /permission denied/i);
      const salesSettings = await db.query("select default_margin_percent, default_conversion_charge_per_kg, default_transport_charge from public.company_settings_authorized");
      assert.deepEqual(salesSettings.rows, [{ default_margin_percent: null, default_conversion_charge_per_kg: null, default_transport_charge: null }]);
      await assert.rejects(db.query("select default_margin_percent, default_conversion_charge_per_kg from public.company_settings"), /permission denied/i);
      const salesQuoteCosts = await db.query("select billet_rate_per_kg, conversion_charge_per_kg, finishing_charge, line_subtotal, material_price, basic_price, margin_percent, raw_material_cost, internal_cost from public.quote_items_authorized");
      assert.deepEqual(salesQuoteCosts.rows, [{ billet_rate_per_kg: null, conversion_charge_per_kg: null, finishing_charge: null, line_subtotal: null, material_price: null, basic_price: null, margin_percent: null, raw_material_cost: null, internal_cost: null }]);
      const salesOrderCosts = await db.query("select material_price, value_added_service_price, other_charges, basic_price, packing_charge, freight_charge, margin, internal_cost from public.order_items_authorized");
      assert.deepEqual(salesOrderCosts.rows, [{ material_price: null, value_added_service_price: null, other_charges: null, basic_price: null, packing_charge: null, freight_charge: null, margin: null, internal_cost: null }]);
      const salesFulfillment = await db.query("select unit_rate, quoted_line_value, notes from public.order_dealer_stock_fulfillments_authorized");
      assert.deepEqual(salesFulfillment.rows, [{ unit_rate: "120", quoted_line_value: "500", notes: "internal fulfillment note" }]);
      const salesProduction = await db.query("select material_price, basic_price, freight_charge, net_rate, final_line_value, internal_cost, supplier_rate, margin, internal_note from public.production_jobs_authorized");
      assert.deepEqual(salesProduction.rows, [{ material_price: null, basic_price: null, freight_charge: null, net_rate: null, final_line_value: null, internal_cost: null, supplier_rate: null, margin: null, internal_note: null }]);
      await setIdentity(db, productionA);
      const maskedProduction = await db.query("select material_price, internal_cost, supplier_rate, margin, internal_note from public.production_jobs_authorized");
      assert.deepEqual(maskedProduction.rows, [{ material_price: null, internal_cost: null, supplier_rate: null, margin: null, internal_note: null }]);
      const maskedFulfillment = await db.query("select unit_rate, quoted_line_value from public.order_dealer_stock_fulfillments_authorized");
      assert.deepEqual(maskedFulfillment.rows, [{ unit_rate: null, quoted_line_value: null }]);
      await assert.rejects(db.query("select material_price,internal_cost,supplier_rate,margin,internal_note from public.production_jobs"), /permission denied/i);
      const maskedPacking = await db.query("select material_price, basic_price, net_rate, final_line_value, internal_cost, supplier_rate, margin, internal_note from public.packing_list_items_authorized");
      assert.deepEqual(maskedPacking.rows, [{ material_price: null, basic_price: null, net_rate: null, final_line_value: null, internal_cost: null, supplier_rate: null, margin: null, internal_note: null }]);
      await assert.rejects(db.query("select material_price,internal_cost,supplier_rate,margin,internal_note from public.packing_list_items"), /permission denied/i);
      await resetIdentity(db);
      await resetIdentity(db);

      await setIdentity(db, productionA);
      const productionOrders = await db.query(`select id from public.orders_authorized where id='${orderA}'`);
      assert.deepEqual(productionOrders.rows, [{ id: orderA }], "production retains authorized same-company order reads");
      await expectNoRows(db, `select id from public.orders_authorized where id='${orderOtherCompany}'`);
      const config = await db.query("select grand_total, internal_cost from public.system_configurations_authorized");
      assert.deepEqual(config.rows, [{ grand_total: null, internal_cost: null }]);
      const update = await db.query(`update public.orders set priority='high' where id='${orderA}' returning id`);
      assert.equal(update.rows.length, 0, "production cannot update protected order parents directly");
      await resetIdentity(db);
    });

    await check("accounts may read approved costs while direct protected base columns remain unavailable", async () => {
      await setIdentity(db, accountsA);
      for (const table of ["system_series", "system_profiles", "system_profile_cuts", "system_beading_cuts", "profile_optimization_runs"]) {
        const rows = await db.query(`select id from public.${table}`);
        assert.equal(rows.rows.length, 1, `accounts can read same-company ${table}`);
      }
      await assert.rejects(db.query(`insert into public.system_profile_cuts(id,company_id) values ('${id("c")}','${companyA}')`), /row-level security/i);
      const result = await db.query("select internal_cost, margin_percent from public.system_configurations_authorized");
      assert.deepEqual(result.rows, [{ internal_cost: "150", margin_percent: "20" }]);
      const summary = await db.query("select rate, amount from public.system_material_summary_authorized");
      assert.deepEqual(summary.rows, [{ rate: "75", amount: "300" }]);
      const settings = await db.query("select default_margin_percent, default_conversion_charge_per_kg from public.company_settings_authorized");
      assert.deepEqual(settings.rows, [{ default_margin_percent: "15", default_conversion_charge_per_kg: "85" }]);
      const productionCosts = await db.query("select internal_cost,supplier_rate,margin,internal_note from public.production_jobs_authorized");
      assert.deepEqual(productionCosts.rows, [{ internal_cost: "75", supplier_rate: "62", margin: "25", internal_note: "private job note" }]);
      const packingCosts = await db.query("select internal_cost,supplier_rate,margin,internal_note from public.packing_list_items_authorized");
      assert.deepEqual(packingCosts.rows, [{ internal_cost: "75", supplier_rate: "62", margin: "25", internal_note: "private packing note" }]);
      const invoiceCosts = await db.query("select unit_rate,line_total,internal_cost,supplier_rate,margin,internal_note from public.invoice_items_authorized");
      assert.deepEqual(invoiceCosts.rows, [{ unit_rate: "120", line_total: "1200", internal_cost: "75", supplier_rate: "62", margin: "25", internal_note: "private invoice note" }]);
      await assert.rejects(db.query("select internal_cost from public.invoice_items"), /permission denied/i);
      await assert.rejects(db.query("select internal_cost from public.system_configurations"), /permission denied/i);
      const accountsQuoteCosts = await db.query("select billet_rate_per_kg, line_subtotal, internal_cost from public.quote_items_authorized");
      assert.equal(accountsQuoteCosts.rows.length, 1, "accounts retains approved quote costing reads");
      await resetIdentity(db);
    });

    await check("calculation RPC is owner/admin-only while accounts retain costing reads", async () => {
      await setIdentity(db, salesManagerA);
      await assert.rejects(db.query(`select public.save_system_configuration_atomic('${id("0")}','calculation',null,'{}'::jsonb,'{}'::jsonb)`), /Only owners and admins/i);
      await resetIdentity(db);
      await setIdentity(db, accountsA);
      await assert.rejects(db.query(`select public.save_system_configuration_atomic('${id("0")}','calculation',null,'{}'::jsonb,'{}'::jsonb)`), /Only owners and admins/i);
      await resetIdentity(db);
    });

    await check("dispatch managers can inspect reservations without receiving reservation-write capability", async () => {
      await setIdentity(db, dispatchManager);
      const reservations = await db.query("select id from public.profile_stock_reservations");
      assert.equal(reservations.rows.length, 1);
      await assert.rejects(db.query(`insert into public.profile_stock_reservations(id,company_id) values ('${id("1")}','${companyA}')`), /row-level security/i);
      await resetIdentity(db);
    });

    await check("order and order-line writes require the authorized workflow for non-admin roles", async () => {
      await setIdentity(db, dispatchManager);
      await assert.rejects(
        db.query(`update public.orders set order_value=9999 where id='${orderA}' returning id`),
        /Orders must be created or changed through an authorized order workflow/i
      );
      await assert.rejects(
        db.query(`update public.order_items set material_price=9999 where id='${orderLineA}' returning id`),
        /Order lines must be created or changed through an authorized order workflow/i
      );
      await assert.rejects(
        db.query(`select public.harness_change_order_value('${orderA}',9999)`),
        /Order value, source, identity, and production requirements cannot be changed through the operational order workflow/i
      );
      const orderWrite = await db.query(`select public.harness_update_operational_order('${orderA}','high') as id`);
      assert.equal(orderWrite.rows[0].id, orderA, "approved workflow can still update operational order metadata");
      const savedOrder = await db.query(`select priority from public.orders_authorized where id='${orderA}'`);
      assert.equal(savedOrder.rows[0].priority, "high");
      await resetIdentity(db);
    });

    await check("cross-dealer, cross-company, suspended, and viewer mutation probes fail closed", async () => {
      await setIdentity(db, dealerUserB);
      const sibling = await db.query(`select id from public.orders_authorized where id='${orderA}'`);
      assert.deepEqual(sibling.rows, []);
      await resetIdentity(db);

      await setIdentity(db, viewerA);
      const viewerOrders = await db.query("select id from public.orders_authorized order by id");
      assert.deepEqual(viewerOrders.rows.map((row) => row.id).sort(), [orderA, orderB].sort(), "viewer reads remain tenant-scoped");
      const viewerQuote = await db.query(`select grand_total from public.quotes_authorized where id='${quoteA}'`);
      assert.deepEqual(viewerQuote.rows, [{ grand_total: null }], "viewer cannot read commercial quote totals");
      const viewerUpdate = await db.query(`update public.orders set priority='high' where id='${orderA}' returning id`);
      assert.equal(viewerUpdate.rows.length, 0, "viewer cannot mutate operational records");
      await resetIdentity(db);
      await db.exec(`update public.app_users set is_active=false where id='${viewerA}'`);
      await setIdentity(db, suspendedA);
      await expectNoRows(db, "select id from public.orders_authorized");
      await resetIdentity(db);

      await setIdentity(db, viewerA);
      await assert.rejects(db.query(`insert into public.quotes(id,company_id,customer_id,dealer_id) values ('${id(1)}','${companyA}','${customerA}','${dealerA}')`), /Only owners and admins may create quotations/i);
      await resetIdentity(db);
    });

    return checks;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname.toLowerCase() === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).pathname.toLowerCase()) {
  const checks = await runAccessProjectionIntegrityChecks();
  console.log(`PASS access projection integrity (${checks.length} SQL checks)`);
}
