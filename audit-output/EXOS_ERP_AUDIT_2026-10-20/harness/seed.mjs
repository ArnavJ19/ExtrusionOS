// Synthetic tenant used by the audit reproductions. Seeding runs with triggers
// disabled (session_replication_role = replica) so each scenario starts from an
// explicit state; every scenario itself runs with live triggers and, where
// stated, as the PostgREST "authenticated" role under live RLS.
export const ids = {
  company: "c0000000-0000-4000-8000-000000000001",
  otherCompany: "c0000000-0000-4000-8000-000000000002",
  owner: "a0000000-0000-4000-8000-000000000001",
  productionManager: "a0000000-0000-4000-8000-000000000002",
  production: "a0000000-0000-4000-8000-000000000003",
  viewer: "a0000000-0000-4000-8000-000000000004",
  sales: "a0000000-0000-4000-8000-000000000005",
  accounts: "a0000000-0000-4000-8000-000000000006",
  dispatch: "a0000000-0000-4000-8000-000000000007",
  quality: "a0000000-0000-4000-8000-000000000008",
  dealerStaff: "a0000000-0000-4000-8000-000000000009",
  factoryManager: "a0000000-0000-4000-8000-000000000010",
  dispatchManager: "a0000000-0000-4000-8000-000000000011",
  inventoryManager: "a0000000-0000-4000-8000-000000000012",
  salesManager: "a0000000-0000-4000-8000-000000000013",
  dealer: "d0000000-0000-4000-8000-000000000001",
  customer: "b0000000-0000-4000-8000-000000000001",
  vendor: "e0000000-0000-4000-8000-000000000001",
  profile: "f0000000-0000-4000-8000-000000000001",
  die: "f1000000-0000-4000-8000-000000000001",
  pressA: "f2000000-0000-4000-8000-000000000001",
  pressB: "f2000000-0000-4000-8000-000000000002",
  orderA: "f3000000-0000-4000-8000-000000000001",
  orderB: "f3000000-0000-4000-8000-000000000002",
  jobA: "f4000000-0000-4000-8000-000000000001",
  jobB: "f4000000-0000-4000-8000-000000000002",
};

export async function seed(db) {
  const i = ids;
  await db.exec(`
    set session_replication_role = replica;
    insert into public.companies (id, name) values ('${i.company}', 'Audit Extrusions'), ('${i.otherCompany}', 'Other Co');
    insert into public.company_settings (company_id) values ('${i.company}');
    insert into public.dealers (id, company_id, dealer_code, dealer_name) values ('${i.dealer}', '${i.company}', 'DL-1', 'Audit Dealer');
    insert into auth.users (id) values ('${i.owner}'),('${i.productionManager}'),('${i.production}'),('${i.viewer}'),('${i.sales}'),('${i.accounts}'),('${i.dispatch}'),('${i.quality}'),('${i.dealerStaff}'),('${i.factoryManager}'),('${i.dispatchManager}'),('${i.inventoryManager}'),('${i.salesManager}');
    insert into public.app_users (id, company_id, full_name, email, role, is_active, dealer_id) values
      ('${i.owner}', '${i.company}', 'Owner', 'o@x', 'owner', true, null),
      ('${i.productionManager}', '${i.company}', 'PM', 'pm@x', 'production_manager', true, null),
      ('${i.production}', '${i.company}', 'Operator', 'op@x', 'production', true, null),
      ('${i.viewer}', '${i.company}', 'Viewer', 'v@x', 'viewer', true, null),
      ('${i.sales}', '${i.company}', 'Sales', 's@x', 'sales', true, null),
      ('${i.accounts}', '${i.company}', 'Accounts', 'a@x', 'accounts', true, null),
      ('${i.dispatch}', '${i.company}', 'Dispatch', 'd@x', 'dispatch', true, null),
      ('${i.quality}', '${i.company}', 'QC', 'q@x', 'quality', true, null),
      ('${i.dealerStaff}', '${i.company}', 'Dealer Staff', 'ds@x', 'dealer_staff', true, '${i.dealer}'),
      ('${i.factoryManager}', '${i.company}', 'Factory Manager', 'fm@x', 'factory_manager', true, null),
      ('${i.dispatchManager}', '${i.company}', 'Dispatch Manager', 'dm@x', 'dispatch_manager', true, null),
      ('${i.inventoryManager}', '${i.company}', 'Inventory Manager', 'im@x', 'inventory_manager', true, null),
      ('${i.salesManager}', '${i.company}', 'Sales Manager', 'sm@x', 'sales_manager', true, null);
    insert into public.customers (id, company_id, customer_name) values ('${i.customer}', '${i.company}', 'Audit Customer');
    insert into public.vendors (id, company_id, vendor_name, vendor_type) values ('${i.vendor}', '${i.company}', 'Metal Vendor', 'aluminum_billets');
    insert into public.aluminium_profiles (id, company_id, profile_code, profile_name, section_weight_kg_per_m, alloy, temper, billet_diameter_required_inch, standard_length_m, is_active)
      values ('${i.profile}', '${i.company}', 'P-100', 'Sliding track', 1.000, '6063', 'T6', 4, 5.8, true);
    insert into public.dies (id, company_id, die_number, profile_id, die_status) values ('${i.die}', '${i.company}', 'D-100', '${i.profile}', 'active');
    insert into public.machines (id, company_id, machine_name, machine_type, status, is_active, machine_code) values
      ('${i.pressA}', '${i.company}', 'Press A', 'extrusion_press', 'active', true, 'PA'),
      ('${i.pressB}', '${i.company}', 'Press B', 'extrusion_press', 'active', true, 'PB');
    insert into public.orders (id, company_id, order_number, customer_id, order_date, current_stage, production_quantity_kg, requested_weight_kg, manufacturing_weight_kg, dealer_fulfilled_weight_kg) values
      ('${i.orderA}', '${i.company}', 'ORD-A', '${i.customer}', current_date, 'extrusion_planned', 1000, 1000, 1000, 0),
      ('${i.orderB}', '${i.company}', 'ORD-B', '${i.customer}', current_date, 'extrusion_planned', 1000, 1000, 1000, 0);
    set session_replication_role = origin;
  `);
}

// Execute SQL as a PostgREST-equivalent authenticated user under live RLS.
export async function asUser(db, userId, sql) {
  await db.exec(`select set_config('audit.uid', '${userId}', false); set role authenticated;`);
  try {
    return await db.exec(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

export async function asSystem(db, userId, sql) {
  await db.exec(`select set_config('audit.uid', '${userId ?? ""}', false);`);
  return db.exec(sql);
}
