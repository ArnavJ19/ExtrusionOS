/**
 * PCDA Entity Versioning
 * 
 * Records revision history for tracked entities (dies, profiles, drawings, etc).
 * Each revision captures the prior state as JSONB and increments the revision number.
 */

import { createClient } from "@/lib/supabase/server";

export type VersionedEntityType = "die" | "profile" | "drawing" | "quote" | "order" | "technical_line_item";

/**
 * Record a revision entry BEFORE applying an update.
 * Call this in the server action before the actual .update() call.
 * 
 * @param companyId The authenticated company ID
 * @param entityType The type of entity being versioned
 * @param entityId The UUID of the entity
 * @param priorState The current state BEFORE the update (fetch first, then record, then update)
 * @param actorId The user performing the change
 */
export async function recordRevision(
  companyId: string,
  entityType: VersionedEntityType,
  entityId: string,
  priorState: Record<string, unknown>,
  actorId: string
): Promise<{ revisionNumber: number }> {
  const supabase = await createClient();

  // Get the next revision number
  const { data: lastRevision } = await supabase
    .from("entity_revisions")
    .select("revision_number")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .single();

  const nextRevision = (lastRevision?.revision_number ?? 0) + 1;

  const { error } = await supabase.from("entity_revisions").insert({
    company_id: companyId,
    entity_type: entityType,
    entity_id: entityId,
    revision_number: nextRevision,
    prior_state: priorState,
    actor_id: actorId
  });

  if (error) {
    // Non-fatal: log but don't block the operation
    console.error("Failed to record revision:", error.message);
  }

  return { revisionNumber: nextRevision };
}

/**
 * Get the revision history for an entity.
 */
export async function getRevisionHistory(
  companyId: string,
  entityType: VersionedEntityType,
  entityId: string
): Promise<{ revisions: Array<{ revision_number: number; actor_id: string | null; created_at: string; prior_state: Record<string, unknown> }> }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("entity_revisions")
    .select("revision_number, actor_id, created_at, prior_state")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("revision_number", { ascending: false })
    .limit(50);

  if (error) return { revisions: [] };
  return { revisions: data ?? [] };
}
