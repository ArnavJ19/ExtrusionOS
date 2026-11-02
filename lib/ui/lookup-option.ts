import { formatNumeric } from "../utils/numeric-display.ts";

/** Only identifiers already present in the authorized lookup projection are used. */
export function lookupOptionContext(row: Record<string, unknown>) {
  const parts = [row.city, row.phone, row.gst_number, row.alloy, row.temper, row.rack_location, row.die_status];
  if (row.section_weight_kg_per_m != null) parts.push(`${formatNumeric(row.section_weight_kg_per_m as number | string)} kg/m`);
  return [...new Set(parts.filter((part) => typeof part === "string" && part.trim()).map((part) => String(part).replace(/_/g, " ")))].join(" | ");
}
