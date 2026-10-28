import { z } from "zod";
const uuid = z.string().uuid();
const listFilters = { search: z.string().trim().max(80).default(""), status: z.enum(["all", "active", "inactive", "required", "advisory", "reviewed", "needs_review"]).default("all"), sort: z.enum(["name", "revision"]).default("name") };
export const WORK_STAGES = ["production", "quality", "packing", "dispatch"] as const;
export type WorkStage = typeof WORK_STAGES[number];
export function canReviewRequirements(role: string, stage: WorkStage) {
  return ["owner", "admin", "factory_manager"].includes(role) || ({ production: ["production_manager", "production"], quality: ["quality"], packing: ["production_manager", "production", "dispatch_manager", "dispatch"], dispatch: ["dispatch_manager", "dispatch"] }[stage]).includes(role);
}
export const canManageCustomerRequirements = (role: string) => ["owner", "admin", "sales_manager", "quality", "factory_manager"].includes(role);
export const customerRequirementCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("order.list"), order_id: uuid, stage: z.enum(WORK_STAGES), page: z.number().int().min(1).max(100000).default(1), ...listFilters }).strict(),
  z.object({ command: z.literal("customer.list"), customer_id: uuid, page: z.number().int().min(1).max(100000).default(1), ...listFilters }).strict(),
  z.object({ command: z.literal("requirement.load"), customer_id: uuid, id: uuid }).strict(),
  z.object({ command: z.literal("acknowledge"), order_id: uuid, stage: z.enum(WORK_STAGES), requirement_id: uuid, expected_revision: z.number().int().positive(), note: z.string().trim().min(3).max(500) }).strict(),
  z.object({ command: z.literal("requirement.save"), customer_id: uuid, id: uuid, title: z.string().trim().min(3).max(120), description: z.string().trim().min(3).max(1000), stages: z.array(z.enum(WORK_STAGES)).min(1).max(4), is_mandatory: z.boolean(), is_active: z.boolean(), expected_revision: z.number().int().positive().optional() }).strict()
]);
export const customerRequirementSchema = z.object({ id: uuid, customer_id: uuid, certificate_type: z.string(), description: z.string().nullable(), is_mandatory: z.boolean(), is_active: z.boolean(), work_stages: z.array(z.enum(WORK_STAGES)), revision: z.number().int().positive(), acknowledgement: z.object({ by: z.string(), at: z.string(), note: z.string() }).nullable() });
export const customerRequirementsListSchema = z.object({ rows: z.array(customerRequirementSchema).max(10), total_count: z.number().int() });
export type CustomerRequirement = z.infer<typeof customerRequirementsListSchema>["rows"][number];
