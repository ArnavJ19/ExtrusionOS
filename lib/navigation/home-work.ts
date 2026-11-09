// AP-041: pilot work belongs to the record it is about. HOME_SOURCES mirrors private.ap_home_sources() (a test compares
// them); HOME_STARTS and MODULE_STARTS move each /tasks hub "new" entry point to the order, job, die, dispatch, invoice,
// vendor, customer or quote it acts on, or to the module overview for work that is not about one record. Hub tables and
// permissions are unchanged; hub pages remain as cross-record reports.
import { z } from "zod";

export const HUBS = ["assurance", "coordination", "lifecycle", "improvement", "execution", "commercial", "specialist", "control"] as const;
export type Hub = (typeof HUBS)[number];
export const HUB_LABELS: Record<Hub, string> = {
  assurance: "Assurance", coordination: "Coordination", lifecycle: "Order lifecycle", improvement: "Improvement", execution: "Execution planning",
  commercial: "Commercial", specialist: "Specialist", control: "Operational control"
};

export const HOME_KINDS = {
  order: { label: "Order", module: "orders", href: (id: string) => `/orders/${id}` },
  job: { label: "Production job", module: "production", href: (id: string) => `/production/${id}` },
  die: { label: "Die", module: "dies", href: (id: string) => `/dies/${id}` },
  dispatch: { label: "Dispatch", module: "dispatches", href: (id: string) => `/dispatches/${id}` },
  invoice: { label: "Invoice", module: "invoices", href: (id: string) => `/invoices/${id}` },
  vendor: { label: "Vendor", module: "vendors", href: (id: string) => `/vendors/${id}` },
  customer: { label: "Customer", module: "customers", href: (id: string) => `/customers/${id}` },
  quote: { label: "Quotation", module: "quotes", href: (id: string) => `/quotes/${id}` },
  machine: { label: "Machine", module: "machines", href: (id: string) => `/machines/${id}` },
  profile: { label: "Profile", module: "profiles", href: (id: string) => `/profiles/${id}` }
} as const;
export type HomeKind = keyof typeof HOME_KINDS;
export const HOME_KIND_KEYS = Object.keys(HOME_KINDS) as [HomeKind, ...HomeKind[]];

export const HOME_SOURCES: ReadonlyArray<readonly [HomeKind, Hub, string, string, string]> = [
  ["order", "coordination", "orders", "orders", "id"], ["order", "lifecycle", "closure", "orders", "id"], ["order", "commercial", "profitability", "orders", "id"],
  ["order", "control", "ledger", "orders", "id"], ["order", "coordination", "decisions", "coordination_decisions", "order_id"],
  ["order", "assurance", "deliveries", "dispatches", "order_id"], ["order", "assurance", "packs", "dispatches", "order_id"],
  ["order", "assurance", "revisions", "order_change_proposals", "order_id"], ["order", "assurance", "returns", "return_authorizations", "order_id"],
  ["order", "lifecycle", "samples", "sample_requirements", "order_id"], ["order", "lifecycle", "templates", "packing_label_templates", "order_id"],
  ["order", "lifecycle", "labels", "prepared_physical_bundles", "order_id"], ["order", "lifecycle", "promises", "delivery_promises", "order_id"],
  ["order", "lifecycle", "journeys", "journey_reviews", "order_id"], ["order", "execution", "appointments", "delivery_appointments", "order_id"],
  ["order", "specialist", "intake", "po_intakes", "order_id"], ["order", "control", "inheritance", "production_jobs", "order_id"],
  ["order", "control", "wip", "production_jobs", "order_id"], ["order", "control", "custody", "finishing_jobs", "order_id"],
  ["job", "control", "inheritance", "production_jobs", "id"], ["job", "control", "wip", "production_jobs", "id"],
  ["job", "specialist", "lab", "lab_requests", "production_job_id"], ["job", "control", "custody", "finishing_jobs", "production_job_id"],
  ["die", "improvement", "dies", "dies", "id"], ["die", "lifecycle", "samples", "sample_requirements", "die_id"],
  ["die", "execution", "gate_passes", "returnable_gate_passes", "die_id"], ["die", "specialist", "tooling", "tooling_agreements", "die_id"],
  ["dispatch", "assurance", "deliveries", "dispatches", "id"], ["dispatch", "assurance", "packs", "dispatches", "id"],
  ["dispatch", "assurance", "returns", "return_authorizations", "dispatch_id"], ["dispatch", "lifecycle", "labels", "prepared_physical_bundles", "dispatch_id"],
  ["dispatch", "execution", "appointments", "delivery_appointments", "dispatch_id"], ["dispatch", "specialist", "weighing", "weighing_sessions", "dispatch_id"],
  ["invoice", "coordination", "collections", "collection_promises", "invoice_id"],
  ["vendor", "commercial", "reliability", "vendors", "id"], ["vendor", "commercial", "claims", "supplier_claims", "vendor_id"],
  ["vendor", "specialist", "lab", "lab_requests", "lab_vendor_id"], ["vendor", "control", "custody", "finishing_jobs", "vendor_id"],
  ["customer", "specialist", "tolling", "customers", "id"], ["customer", "lifecycle", "samples", "sample_requirements", "customer_id"],
  ["customer", "lifecycle", "templates", "packing_label_templates", "customer_id"], ["customer", "commercial", "pricing", "pricing_rules", "customer_id"],
  ["customer", "specialist", "intake", "po_intakes", "customer_id"], ["customer", "specialist", "shades", "shade_references", "customer_id"],
  ["customer", "specialist", "agreements", "blanket_agreements", "customer_id"], ["customer", "specialist", "tooling", "tooling_agreements", "customer_id"],
  ["quote", "commercial", "outcomes", "quotes", "id"], ["quote", "specialist", "intake", "po_intakes", "quote_id"]
];

/** A hub action that starts from a record: `field` receives the record id (null when the form picks a line of it). */
export type HomeStart = { hub: Hub; action: string; field: string | null; label: string };
export const HOME_STARTS: Record<HomeKind, HomeStart[]> = {
  order: [
    { hub: "coordination", action: "coordinator.propose", field: "order_id", label: "Propose an order coordinator" },
    { hub: "coordination", action: "priority.set", field: "order_id", label: "Set the order priority" },
    { hub: "coordination", action: "request.create", field: "order_id", label: "Request action from a department" },
    { hub: "lifecycle", action: "promise.propose", field: "order_id", label: "Propose a delivery promise" },
    { hub: "lifecycle", action: "sample.require", field: "order_id", label: "Require a first-article sample" },
    { hub: "lifecycle", action: "template.create", field: "order_id", label: "Create a packing label template" },
    { hub: "lifecycle", action: "journey.open", field: "order_id", label: "Open an order journey review" },
    { hub: "execution", action: "appointment.request", field: "order_id", label: "Request a delivery appointment" },
    { hub: "execution", action: "route.bind", field: "order_id", label: "Bind a process route" },
    { hub: "assurance", action: "change.propose", field: null, label: "Propose a change to an order line" },
    { hub: "specialist", action: "shade.bind", field: null, label: "Bind a shade reference to an order line" }
  ],
  job: [
    { hub: "execution", action: "window.request", field: "job_id", label: "Request a production window" },
    { hub: "specialist", action: "lab.request", field: "production_job_id", label: "Send a sample for laboratory testing" }
  ],
  die: [
    { hub: "execution", action: "gatepass.issue", field: "die_id", label: "Issue a returnable gate pass" },
    { hub: "specialist", action: "tooling.define", field: "die_id", label: "Record the tooling agreement" },
    { hub: "lifecycle", action: "sample.require", field: "die_id", label: "Require a first-article sample" }
  ],
  dispatch: [
    { hub: "execution", action: "appointment.request", field: "dispatch_id", label: "Request a delivery appointment" },
    { hub: "specialist", action: "weigh.open", field: "dispatch_id", label: "Open a weighbridge session" },
    { hub: "assurance", action: "return.authorize", field: null, label: "Authorise a customer return" }
  ],
  invoice: [{ hub: "coordination", action: "collection.create", field: "invoice_id", label: "Record a collection promise" }],
  vendor: [
    { hub: "specialist", action: "lab.request", field: "lab_vendor_id", label: "Send a sample to this laboratory" },
    { hub: "commercial", action: "claim.submit", field: null, label: "Raise a supplier claim" }
  ],
  customer: [
    { hub: "specialist", action: "intake.submit", field: "customer_id", label: "Paste a customer purchase order" },
    { hub: "commercial", action: "pricing.define", field: "customer_id", label: "Define a pricing rule" },
    { hub: "specialist", action: "agreement.define", field: "customer_id", label: "Record a blanket agreement" },
    { hub: "specialist", action: "shade.define", field: "customer_id", label: "Define a shade reference" },
    { hub: "specialist", action: "tooling.define", field: "customer_id", label: "Record a die tooling agreement" },
    { hub: "specialist", action: "toll.define", field: "customer_id", label: "Define a customer-metal agreement" },
    { hub: "specialist", action: "toll.receive", field: "customer_id", label: "Receive customer metal" },
    { hub: "lifecycle", action: "template.create", field: "customer_id", label: "Create a packing label template" }
  ],
  quote: [
    { hub: "commercial", action: "outcome.record", field: "quote_id", label: "Record the quotation outcome" },
    { hub: "commercial", action: "pricing.price", field: "quote_id", label: "Price with an approved rule" },
    { hub: "specialist", action: "intake.submit", field: "quote_id", label: "Paste the customer's purchase order" }
  ],
  machine: [
    { hub: "execution", action: "window.set", field: "machine_id", label: "Set a production window" },
    { hub: "specialist", action: "treat.create", field: "machine_id", label: "Start a heat-treatment batch" }
  ],
  profile: [
    { hub: "assurance", action: "drawing.register", field: "profile_id", label: "Register a drawing revision" },
    { hub: "coordination", action: "correction.report", field: "profile_id", label: "Report a profile data correction" },
    { hub: "commercial", action: "remnant.record", field: "profile_id", label: "Record a remnant lot" }
  ]
};

export const MODULES = {
  quality: { label: "Quality", href: "/quality" }, inventory: { label: "Inventory", href: "/inventory" }, dispatches: { label: "Dispatches", href: "/dispatches" },
  production: { label: "Production", href: "/production" }, vendors: { label: "Vendors", href: "/vendors" }, invoices: { label: "Invoices", href: "/invoices" }
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as [ModuleKey, ...ModuleKey[]];
/** Work that is not about one record starts from its module overview. */
export const MODULE_STARTS: Record<ModuleKey, Array<Omit<HomeStart, "field">>> = {
  quality: [
    { hub: "improvement", action: "problem.open", label: "Open a quality problem" },
    { hub: "lifecycle", action: "trace.open", label: "Open a traceability investigation" },
    { hub: "lifecycle", action: "trace.link", label: "Link records to an investigation" },
    { hub: "assurance", action: "instrument.register", label: "Register a measuring instrument" },
    { hub: "assurance", action: "instrument.bind", label: "Bind an instrument to a check" },
    { hub: "assurance", action: "capability.assess", label: "Assess an operator capability" },
    { hub: "specialist", action: "recipe.define", label: "Define a heat-treatment recipe" }
  ],
  inventory: [
    { hub: "assurance", action: "count.open", label: "Open a cycle count" },
    { hub: "specialist", action: "transfer.request", label: "Request a warehouse transfer" },
    { hub: "lifecycle", action: "bundle.split", label: "Split a bundle" },
    { hub: "lifecycle", action: "bundle.merge", label: "Merge bundles" }
  ],
  dispatches: [{ hub: "assurance", action: "return.authorize", label: "Authorise a customer return" }],
  production: [
    { hub: "control", action: "plan.generate", label: "Generate a procurement plan" },
    { hub: "execution", action: "window.set", label: "Set a production window" },
    { hub: "execution", action: "wip.set_limit", label: "Set a WIP limit" },
    { hub: "execution", action: "availability.record", label: "Record people availability" },
    { hub: "execution", action: "route.define", label: "Define a process route" },
    { hub: "specialist", action: "treat.create", label: "Start a heat-treatment batch" },
    { hub: "commercial", action: "scenario.create", label: "Compare a planning scenario" }
  ],
  vendors: [
    { hub: "commercial", action: "claim.submit", label: "Raise a supplier claim" },
    { hub: "commercial", action: "commitment.set", label: "Record a supplier commitment" }
  ],
  invoices: [
    { hub: "commercial", action: "transfer.prepare", label: "Prepare an accounting transfer" },
    { hub: "commercial", action: "mapping.define", label: "Define an accounting mapping" }
  ]
};

/** Hub actions that configure rules, policies or people rather than act on work; they stay in their hub. */
export const HUB_CONFIGURATION_ACTIONS: Record<Hub, string[]> = {
  assurance: ["capability.criteria", "instrument.policy"], coordination: ["contract.publish", "coverage.propose", "coverage.reconcile", "session.start", "steward.assign"],
  lifecycle: [], improvement: ["suggestion.submit", "route.set", "threshold.propose"], execution: ["rule.set", "message.prepare"], commercial: [],
  specialist: ["automation.define"], control: ["policy.set", "supply.link", "authority.publish", "contract.publish"]
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function homeWorkHref(kind: HomeKind, id: string, hub: Hub, action: string) {
  return `${HOME_KINDS[kind].href(id)}/work?action=${encodeURIComponent(`${hub}:${action}`)}`;
}
export function moduleWorkHref(module: ModuleKey, hub: Hub, action: string) {
  return `${MODULES[module].href}/work?action=${encodeURIComponent(`${hub}:${action}`)}`;
}

/**
 * Where a hub "new" request now starts. With a known record id it opens that record's work page; a record action
 * without an id opens the record's module (where the record is chosen first); module work opens the module.
 */
export function homeForHubNew(hub: Hub, action: string, params: Record<string, string | undefined>): string | null {
  if (HUB_CONFIGURATION_ACTIONS[hub].includes(action)) return null;
  for (const kind of HOME_KIND_KEYS) {
    for (const start of HOME_STARTS[kind]) {
      if (start.hub !== hub || start.action !== action || !start.field) continue;
      const id = params[start.field];
      if (id && UUID.test(id)) return homeWorkHref(kind, id, hub, action);
    }
  }
  for (const key of MODULE_KEYS) if (MODULE_STARTS[key].some(start => start.hub === hub && start.action === action)) return moduleWorkHref(key, hub, action);
  // A record action without a record: open the module's records; the work starts from the chosen record's page.
  for (const kind of HOME_KIND_KEYS) if (HOME_STARTS[kind].some(start => start.hub === hub && start.action === action)) return `/${HOME_KINDS[kind].module}/database`;
  return null;
}

export function parseWorkAction(value: string | undefined): { hub: Hub; action: string } | null {
  const [hub, action] = (value ?? "").split(":");
  if (!(HUBS as readonly string[]).includes(hub) || !/^[a-z_]+\.[a-z_]+$/.test(action ?? "")) return null;
  return { hub: hub as Hub, action };
}

export const homeWorkItemSchema = z.object({ hub: z.enum(HUBS), view: z.string(), id: z.string(), label: z.string().nullable(), status: z.string().nullable(),
  summary: z.string().nullable(), due_date: z.string().nullable(), href: z.string().startsWith("/tasks/"), source_href: z.string().nullable().optional() });
export const homeWorkRecordSchema = z.object({ kind: z.enum(HOME_KIND_KEYS), id: z.string().uuid(), groups: z.array(z.object({ hub: z.enum(HUBS), view: z.string(), total: z.number() })),
  items: z.array(homeWorkItemSchema) });
export type HomeWorkRecord = z.infer<typeof homeWorkRecordSchema>;
export const homeWorkAttentionSchema = z.object({ total_count: z.number(), items: z.array(homeWorkItemSchema) });
