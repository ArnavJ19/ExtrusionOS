// FABLE_SUGGESTIONS Phase 4 screens ("plan and predict"), who may open each. Route permissions (lib/auth/route-permissions)
// and each database gateway enforce the same roles; this list only decides which links a person sees.
import { COCKPIT_ROLES, DEVELOPMENT_ROLES, DIE_LIFE_ROLES, EXPOSURE_ROLES, MRP_ROLES, ORDER_BOOK_ROLES, OTIF_READERS, PROMISE_ROLES, WALL_ROLES } from "./commands.ts";

export type PlanDestination = { href: string; label: string; description: string; roles: readonly string[] };

export const PLAN_DESTINATIONS: PlanDestination[] = [
  { href: "/insights/cockpit", label: "Owner cockpit", description: "Yesterday, now and the exceptions, with the morning brief for WhatsApp.", roles: COCKPIT_ROLES },
  { href: "/insights/otif", label: "On time in full", description: "Lines delivered complete by the first promise, by customer, salesperson, profile and cause.", roles: OTIF_READERS },
  { href: "/insights/order-book", label: "Order book and forecast", description: "Tonnes on order, weeks of press load, weighted pipeline and customers ordering less.", roles: ORDER_BOOK_ROLES },
  { href: "/insights/metal-exposure", label: "Metal price exposure", description: "Metal sold at a fixed price against metal held and bought; back-to-back bookings.", roles: EXPOSURE_ROLES },
  { href: "/payments/cash-forecast", label: "Thirteen-week cash", description: "Receipts, promises, bills and fixed payments week by week against a minimum balance.", roles: ["owner", "admin", "accounts"] },
  { href: "/production/material-plan", label: "What to buy and cast", description: "Billet, consumables and dies needed by week, for the owner to approve.", roles: MRP_ROLES },
  { href: "/production/promise", label: "Promise dates", description: "Earliest realistic dispatch for a profile, and orders at risk on a stopped press.", roles: PROMISE_ROLES },
  { href: "/dies/life", label: "Die life", description: "Remaining die life against open orders and the replacement lead time.", roles: DIE_LIFE_ROLES },
  { href: "/profiles/development", label: "New developments", description: "From a customer drawing to first approved production, stage by stage.", roles: DEVELOPMENT_ROLES },
  { href: "/production/wall", label: "Production wall", description: "Each press now: job, kg/hour against target, next die and stoppages, live.", roles: WALL_ROLES }
];

export function planDestinationsFor(role: string) {
  return PLAN_DESTINATIONS.filter(d => d.roles.includes(role));
}
