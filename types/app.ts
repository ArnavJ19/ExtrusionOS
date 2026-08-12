export type UserRole = "owner" | "admin" | "sales_manager" | "sales" | "production_manager" | "production" | "dispatch_manager" | "dispatch" | "accounts" | "quality" | "viewer" | "factory_manager" | "inventory_manager" | "dealer_admin" | "dealer_staff";
export type QuoteStatus = "draft" | "internal_review" | "approved_for_sending" | "sent" | "customer_approved" | "customer_rejected" | "expired" | "converted_to_order";
export type CustomerType = "fabricator" | "dealer" | "architect" | "industrial" | "solar" | "government" | "export" | "contractor" | "other";
export type ApplicationCategory = "sliding_window" | "casement_window" | "door" | "curtain_wall" | "partition" | "railing" | "solar" | "heat_sink" | "industrial" | "electrical" | "automotive" | "aerospace" | "furniture" | "custom" | "other";
export type DieStatus = "design" | "ordered" | "received" | "under_trial" | "approved" | "active" | "under_correction" | "under_maintenance" | "blocked" | "retired" | "scrapped" | "trial" | "correction" | "nitriding" | "inactive" | "dead";
export type OwnershipType = "company_owned" | "customer_owned" | "shared" | "trial" | "archived";
export type DieType = "solid" | "hollow" | "semi_hollow" | "porthole" | "bridge" | "feeder" | "multi_cavity" | "flat" | "special";
export type DiePerformanceGrade = "excellent" | "good" | "average" | "problematic" | "blocked";
export type ProfileClassification = "solid" | "hollow" | "semi_hollow";
export type ProfileComplexity = "simple" | "standard" | "complex" | "very_complex";
export type DrawingApprovalStatus = "pending" | "approved" | "rejected" | "superseded";
export type ProfileApprovalStatus = "draft" | "submitted" | "approved" | "rejected" | "superseded";
export type FinishingType = "mill_finish" | "powder_coating" | "anodizing" | "anodized_silver" | "anodized_bronze" | "anodized_black" | "wood_finish" | "wood_grain" | "pvdf" | "other";
export type FinishingChargeType = "per_kg" | "per_meter" | "fixed" | "per_sqft";
export type DieAmortizationType = "full_die_charge" | "per_kg" | "waived" | "customer_paid";
export type OrderPriority = "low" | "normal" | "high" | "urgent";
export type OrderStage = "order_confirmed" | "die_ready" | "billet_ready" | "billet_heating" | "extrusion_planned" | "extruded" | "stretching" | "cutting" | "aging" | "surface_treatment" | "finishing" | "packing" | "dispatched" | "delivered" | "payment_pending" | "closed" | "cancelled";
export type DeliveryStatus = "pending" | "dispatched" | "in_transit" | "delivered" | "delayed" | "damaged" | "returned";

export const standardAlloys = ["6063", "6061", "6082", "6005", "1050", "1060", "other"] as const;
export const standardTempers = ["T4", "T5", "T6", "T651", "O", "other"] as const;

export type SessionContext = {
  userId: string;
  email: string | null;
  companyId: string;
  companyName: string;
  fullName: string | null;
  role: UserRole;
  dealerId?: string | null;
  department?: string | null;
  salesRegion?: string | null;
  // Effective granular permission keys granted to this user via custom roles
  // (user_roles -> role_permissions). Base-role rights are resolved from `role`;
  // these are additive grants on top. Empty for owner/admin (they have everything).
  permissions?: string[];
};

export const customerTypes: CustomerType[] = ["fabricator", "dealer", "architect", "industrial", "solar", "government", "export", "contractor", "other"];
export const applicationCategories: ApplicationCategory[] = ["sliding_window", "casement_window", "door", "curtain_wall", "partition", "railing", "solar", "heat_sink", "industrial", "electrical", "automotive", "aerospace", "furniture", "custom", "other"];
export const dieStatuses: DieStatus[] = ["design", "ordered", "received", "under_trial", "approved", "active", "under_correction", "under_maintenance", "blocked", "retired", "scrapped", "trial", "correction", "nitriding", "inactive", "dead"];
export const dieTypes: DieType[] = ["solid", "hollow", "semi_hollow", "porthole", "bridge", "feeder", "multi_cavity", "flat", "special"];
export const diePerformanceGrades: DiePerformanceGrade[] = ["excellent", "good", "average", "problematic", "blocked"];
export const profileClassifications: ProfileClassification[] = ["solid", "hollow", "semi_hollow"];
export const profileComplexities: ProfileComplexity[] = ["simple", "standard", "complex", "very_complex"];
export const drawingApprovalStatuses: DrawingApprovalStatus[] = ["pending", "approved", "rejected", "superseded"];
export const profileApprovalStatuses: ProfileApprovalStatus[] = ["draft", "submitted", "approved", "rejected", "superseded"];
export const quoteStatuses: QuoteStatus[] = ["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"];
export const dieAmortizationTypes: DieAmortizationType[] = ["full_die_charge", "per_kg", "waived", "customer_paid"];
export const orderStages: OrderStage[] = ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "delivered", "payment_pending", "closed", "cancelled"];
export const orderPriorities: OrderPriority[] = ["low", "normal", "high", "urgent"];
export const deliveryStatuses: DeliveryStatus[] = ["pending", "dispatched", "in_transit", "delivered", "delayed", "damaged", "returned"];

export function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// Phase 3 Operational Depth Types
export type VendorType = "aluminum_ingot" | "aluminum_sows" | "aluminum_billets" | "aluminum_wire_rods" | "aluminum_t_ingots" | "aluminum_chips" | "die_maker" | "powder_coating" | "anodizing" | "hardware_supplier" | "transporter" | "packing_supplier" | "maintenance" | "other";
export type InventoryCategory = "billets" | "extruded_profiles" | "hardware" | "powder_coating_material" | "packing_material" | "scrap" | "finished_goods";
export type MovementType = "purchase_in" | "production_in" | "production_issue" | "dispatch_out" | "scrap_in" | "scrap_out" | "adjustment_in" | "adjustment_out" | "return_in";
export type ProfileStockStatus = "available" | "reserved" | "dispatched" | "rejected" | "scrap";
export type MachineType = "extrusion_press" | "aging_oven" | "powder_coating_line" | "anodizing_line" | "cutting_machine" | "packing_station" | "other";
export type MachineStatus = "operational" | "maintenance" | "breakdown" | "idle";
export type ProductionJobStatus = "planned" | "ready" | "in_progress" | "completed" | "on_hold" | "cancelled";
export type FoundryBatchStatus = "planned" | "melting" | "cast" | "homogenizing" | "ready" | "issued" | "cancelled";
export type ExternalAluminiumSourceType = "aluminum_ingot" | "aluminum_sows" | "aluminum_billets" | "aluminum_wire_rods" | "aluminum_t_ingots" | "aluminum_chips";
export type AluminiumScrapQuality = "clean" | "painted" | "mixed" | "contaminated" | "segregation_required" | "rejected";
export type PackagingJobStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type ScrapType = "butt_scrap" | "process_scrap" | "rejection" | "cutting_waste" | "coating_rejection" | "anodizing_rejection" | "packing_damage" | "customer_return" | "remelt_scrap" | "other";
export type FinishingJobStatus = "not_required" | "planned" | "sent_to_vendor" | "in_process" | "received" | "rejected" | "completed";

export const vendorTypes: VendorType[] = ["aluminum_ingot", "aluminum_sows", "aluminum_billets", "aluminum_wire_rods", "aluminum_t_ingots", "aluminum_chips", "die_maker", "powder_coating", "anodizing", "hardware_supplier", "transporter", "packing_supplier", "maintenance", "other"];
export const inventoryCategories: InventoryCategory[] = ["billets", "extruded_profiles", "hardware", "powder_coating_material", "packing_material", "scrap", "finished_goods"];
export const movementTypes: MovementType[] = ["purchase_in", "production_in", "production_issue", "dispatch_out", "scrap_in", "scrap_out", "adjustment_in", "adjustment_out", "return_in"];
export const profileStockStatuses: ProfileStockStatus[] = ["available", "reserved", "dispatched", "rejected", "scrap"];
export const machineTypes: MachineType[] = ["extrusion_press", "aging_oven", "powder_coating_line", "anodizing_line", "cutting_machine", "packing_station", "other"];
export const machineStatuses: MachineStatus[] = ["operational", "maintenance", "breakdown", "idle"];
export const productionJobStatuses: ProductionJobStatus[] = ["planned", "ready", "in_progress", "completed", "on_hold", "cancelled"];
export const foundryBatchStatuses: FoundryBatchStatus[] = ["planned", "melting", "cast", "homogenizing", "ready", "issued", "cancelled"];
export const externalAluminiumSourceTypes: ExternalAluminiumSourceType[] = ["aluminum_ingot", "aluminum_sows", "aluminum_billets", "aluminum_wire_rods", "aluminum_t_ingots", "aluminum_chips"];
export const aluminiumScrapQualities: AluminiumScrapQuality[] = ["clean", "painted", "mixed", "contaminated", "segregation_required", "rejected"];
export const packagingJobStatuses: PackagingJobStatus[] = ["scheduled", "in_progress", "completed", "cancelled"];
export const packagingMaterialTypes = ["stretch_film", "bubble_wrap", "paper", "hdpe", "pp_woven_sheet", "wooden_crate", "strapping", "corner_protector", "other"] as const;
export const packagingCalculationMethods = ["per_profile_meter", "per_piece", "per_kg", "fixed"] as const;
export const scrapTypes: ScrapType[] = ["butt_scrap", "process_scrap", "rejection", "cutting_waste", "coating_rejection", "anodizing_rejection", "packing_damage", "customer_return", "remelt_scrap", "other"];
export const finishingJobStatuses: FinishingJobStatus[] = ["not_required", "planned", "sent_to_vendor", "in_process", "received", "rejected", "completed"];

export type QualityStatus = "pending" | "approved" | "rejected" | "rework";
export const qualityStatuses: QualityStatus[] = ["pending", "approved", "rejected", "rework"];

// Phase 5 Financial Types
export type InvoiceStatus = "draft" | "generated" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";
export type PaymentMethod = "bank_transfer" | "upi" | "cheque" | "cash" | "credit_note" | "other";

export const invoiceStatuses: InvoiceStatus[] = ["draft", "generated", "sent", "partially_paid", "paid", "overdue", "cancelled"];
export const paymentMethods: PaymentMethod[] = ["bank_transfer", "upi", "cheque", "cash", "credit_note", "other"];

// Enterprise Phase 1 Foundation Types
export type EnterpriseModuleName = "ai_assistant" | "whatsapp_automation" | "dealer_portal" | "advanced_inventory" | "production_planning" | "quality_compliance" | "export_docs" | "tender_management" | "energy_monitoring" | "machine_maintenance" | "bis_compliance" | "profitability_intelligence" | "barcode_tracking" | "accounting_integrations" | "mobile_floor_app" | "multi_plant" | "systems_configurator" | "document_intelligence" | "die_intelligence" | "crm" | "report_builder" | "automation" | "command_center";
export type BranchType = "head_office" | "factory" | "warehouse" | "sales_office" | "depot" | "dealer_location";
export type SubscriptionPlanType = "free_demo" | "starter" | "pro" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";
export type BillingCycle = "monthly" | "annual" | "manual";
export type NotificationSeverity = "info" | "success" | "warning" | "critical";
export type EnterpriseTaskPriority = "low" | "normal" | "high" | "urgent";
export type EnterpriseTaskStatus = "open" | "in_progress" | "completed" | "cancelled";
export type DataExchangeJobType = "import" | "export";
export type DataExchangeJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const enterpriseModules: EnterpriseModuleName[] = ["ai_assistant", "whatsapp_automation", "dealer_portal", "advanced_inventory", "production_planning", "quality_compliance", "export_docs", "tender_management", "energy_monitoring", "machine_maintenance", "bis_compliance", "profitability_intelligence", "barcode_tracking", "accounting_integrations", "mobile_floor_app", "multi_plant", "systems_configurator", "document_intelligence", "die_intelligence", "crm", "report_builder", "automation", "command_center"];
export const branchTypes: BranchType[] = ["head_office", "factory", "warehouse", "sales_office", "depot", "dealer_location"];
export const subscriptionPlanTypes: SubscriptionPlanType[] = ["free_demo", "starter", "pro", "enterprise"];
export const subscriptionStatuses: SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelled", "expired"];
export const billingCycles: BillingCycle[] = ["monthly", "annual", "manual"];
export const notificationSeverities: NotificationSeverity[] = ["info", "success", "warning", "critical"];
export const enterpriseTaskPriorities: EnterpriseTaskPriority[] = ["low", "normal", "high", "urgent"];
export const enterpriseTaskStatuses: EnterpriseTaskStatus[] = ["open", "in_progress", "completed", "cancelled"];
export const dataExchangeJobTypes: DataExchangeJobType[] = ["import", "export"];
export const dataExchangeJobStatuses: DataExchangeJobStatus[] = ["queued", "running", "completed", "failed", "cancelled"];

// Enterprise Phase 2 AI Assistant Types
export type AiInteractionType = "quotation_assist" | "customer_summary" | "order_summary" | "payment_followup" | "production_insight" | "document_summary";
export type AiInteractionStatus = "completed" | "failed" | "redacted" | "external_blocked";
export type AiProvider = "local_rules" | "nvidia" | "openai" | "anthropic" | "azure_openai" | "other";
export type QuoteSuggestionSourceType = "natural_language" | "whatsapp_message" | "drawing_note" | "past_quote" | "manual";
export type QuoteSuggestionStatus = "draft" | "accepted" | "rejected" | "converted_to_quote";

export const aiInteractionTypes: AiInteractionType[] = ["quotation_assist", "customer_summary", "order_summary", "payment_followup", "production_insight", "document_summary"];
export const aiInteractionStatuses: AiInteractionStatus[] = ["completed", "failed", "redacted", "external_blocked"];
export const aiProviders: AiProvider[] = ["local_rules", "nvidia", "openai", "anthropic", "azure_openai", "other"];
export const quoteSuggestionSourceTypes: QuoteSuggestionSourceType[] = ["natural_language", "whatsapp_message", "drawing_note", "past_quote", "manual"];
export const quoteSuggestionStatuses: QuoteSuggestionStatus[] = ["draft", "accepted", "rejected", "converted_to_quote"];

// Aluminium Systems Configurator Types
export type SystemConfiguratorSystemType = "two_track_sliding_window" | "three_track_sliding_window" | "sliding_door" | "casement_window" | "fixed_window" | "top_hung_window" | "hinged_door" | "swing_door" | "partition" | "ventilator" | "combination" | "custom";
export type SystemMeasurementType = "brick_to_brick" | "frame_outer_size" | "finished_size" | "manufacturing_size";
export type SystemViewDirection = "inside_view" | "outside_view";
export type SystemConfigurationStatus = "draft" | "calculated" | "quoted" | "approved" | "converted_to_order" | "in_production" | "completed" | "cancelled";
export type SystemPanelType = "fixed" | "sliding" | "casement" | "top_hung" | "mesh" | "door_leaf" | "dummy" | "custom";
export type SystemOpeningDirection = "left" | "right" | "top" | "bottom" | "sliding_left" | "sliding_right" | "fixed" | "custom";
export type SystemHardwareCategory = "lock" | "handle" | "roller" | "hinge" | "stay_arm" | "tower_bolt" | "fastener" | "screw" | "gasket" | "wool_pile" | "weather_strip" | "silicone" | "drainage_cap" | "corner_cleat" | "connector" | "accessory" | "other";

export const systemConfiguratorSystemTypes: SystemConfiguratorSystemType[] = ["two_track_sliding_window", "three_track_sliding_window", "sliding_door", "casement_window", "fixed_window", "top_hung_window", "hinged_door", "swing_door", "partition", "ventilator", "combination", "custom"];
export const systemMeasurementTypes: SystemMeasurementType[] = ["brick_to_brick", "frame_outer_size", "finished_size", "manufacturing_size"];
export const systemViewDirections: SystemViewDirection[] = ["inside_view", "outside_view"];
export const systemConfigurationStatuses: SystemConfigurationStatus[] = ["draft", "calculated", "quoted", "approved", "converted_to_order", "in_production", "completed", "cancelled"];

// Phase 23 Security Center Types
export type LoginEventType = "login_success" | "login_failed" | "logout" | "password_reset" | "invite_accepted";
export type SensitiveActionType = "delete_quote" | "delete_order" | "change_company_settings" | "change_user_role" | "export_all_data" | "disable_user" | "revoke_portal_access" | "delete_customer" | "delete_profile" | "delete_die" | "delete_invoice" | "bulk_delete" | "role_escalation";

export const loginEventTypes: LoginEventType[] = ["login_success", "login_failed", "logout", "password_reset", "invite_accepted"];
export const sensitiveActionTypes: SensitiveActionType[] = ["delete_quote", "delete_order", "change_company_settings", "change_user_role", "export_all_data", "disable_user", "revoke_portal_access", "delete_customer", "delete_profile", "delete_die", "delete_invoice", "bulk_delete", "role_escalation"];
