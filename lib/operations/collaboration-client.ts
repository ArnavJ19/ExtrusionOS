import { collaborationReads, parseCollaborationData, type CollaborationCommand, type CollaborationResult } from "./collaboration-workflows";

export async function requestCollaboration(command: CollaborationCommand): Promise<CollaborationResult> {
  try {
    const response = await fetch("/api/collaboration-workflows", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(command) });
    const result = await response.json();
    if (response.ok && result?.success === true) return { success: true, data: parseCollaborationData(result.data, command.command) };
    if (result?.success === false && typeof result.error === "string") return { success: false, error: result.error, uncertain: result.uncertain === true, unavailable: result.unavailable === true };
    throw new Error("Invalid confirmation");
  } catch {
    const mutation = !collaborationReads.includes(command.command);
    return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to verify its result." : "Current information is unavailable. Refresh to retry." };
  }
}
