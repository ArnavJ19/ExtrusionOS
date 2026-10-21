import { parseOperatorData, type OperatorCommand, type OperatorResult } from "./operator-workflows";

export async function requestOperatorWorkflow(command: OperatorCommand): Promise<OperatorResult> {
  const mutation = !["aliases.list", "aliases.search", "locations.load", "exceptions.list", "commitments.list", "commitments.history", "commitments.queue"].includes(command.command);
  try {
    const response = await fetch("/api/operator-workflows", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(command) });
    const result = await response.json();
    if (response.ok && result?.success === true) return { success: true, data: parseOperatorData(result.data, command.command) };
    if (result?.success === false && typeof result.error === "string") return { success: false, error: result.error, uncertain: result.uncertain === true, unavailable: result.unavailable === true };
    throw new Error("Unrecognized confirmation");
  } catch {
    return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "Current workflow information could not be loaded. Retry to check it." };
  }
}
