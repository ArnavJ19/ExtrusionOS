// Roles allowed to run each audited ERP workflow. These mirror the role checks inside
// the SECURITY DEFINER RPCs (the database stays the authority); the UI uses them to
// hide actions a user cannot perform.
export const ERP_CONTROL_ROLES = {
  order_short_close: ["owner", "admin", "sales_manager", "factory_manager", "dispatch_manager"],
  production_input_exception: ["owner", "admin", "factory_manager", "production_manager"],
  production_issue_billets: ["owner", "admin", "factory_manager", "production_manager", "production"],
  scrap_reverse: ["owner", "admin", "factory_manager", "production_manager"],
  dispatch_amend_documents: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"],
  dispatch_return_disposition: ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager"],
  dispatch_partial_credit: ["owner", "admin", "accounts"],
  qc_reject_disposition: ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager"],
  finishing_reject_disposition: ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager"],
  machine_return_to_service: ["owner", "admin", "factory_manager", "production_manager"],
  maintenance_complete: ["owner", "admin", "factory_manager", "production_manager"],
  books_lock: ["owner", "admin", "accounts"],
  foundry_cast_result: ["owner", "admin", "factory_manager", "production_manager", "production"],
  foundry_chemistry_record: ["owner", "admin", "quality", "factory_manager", "production_manager"],
  foundry_chemistry_approve: ["owner", "admin", "quality", "factory_manager"],
  billet_reject: ["owner", "admin", "factory_manager", "production_manager", "quality"],
  alloy_deviation: ["owner", "admin", "factory_manager", "quality"],
  stock_from_surplus: ["owner", "admin", "factory_manager", "production_manager", "inventory_manager"],
  stock_opening: ["owner", "admin"],
  stock_qc_release: ["owner", "admin", "quality", "factory_manager"],
  inventory_adjust: ["owner", "admin", "inventory_manager", "factory_manager"],
  profile_spec_change: ["owner", "admin"]
} as const satisfies Record<string, readonly string[]>;

export type ErpControlKey = keyof typeof ERP_CONTROL_ROLES;

export function canRunErpControl(role: string, key: ErpControlKey) {
  return (ERP_CONTROL_ROLES[key] as readonly string[]).includes(role);
}
