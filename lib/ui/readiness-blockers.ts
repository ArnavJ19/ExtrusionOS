import type { UserRole } from "../../types/app.ts";
import { can } from "../auth/permissions.ts";
import { hasRouteAccess } from "../auth/route-permissions.ts";
import { issueResolution, type ReadinessIssue, type ResolutionLinks } from "../workflow/production-readiness.ts";

export type BlockerInstruction = {
  code: string;
  reason: string;
  enforced: boolean;
  source: string;
  team: string;
  evidence: "Missing evidence or setup" | "Eligibility condition" | "Recorded hold";
  resolution: { label: string; href: string } | null;
};

const owners: Record<string, { team: string; source: string }> = {
  die_missing: { team: "Production planning", source: "Job resources" },
  machine_missing: { team: "Production planning", source: "Job resources" },
  billet_ineligible: { team: "Stores and production planning", source: "Billet allocation" },
  billets_not_issued: { team: "Stores and production", source: "Billet issue evidence" },
  die_ineligible: { team: "Die team", source: "Die readiness" },
  die_busy: { team: "Die team and production planning", source: "Die assignment" },
  machine_ineligible: { team: "Production and maintenance", source: "Press readiness" },
  slot_missing: { team: "Production planning", source: "Press schedule" },
  order_ineligible: { team: "Sales and production planning", source: "Order state" },
  drawing_not_approved: { team: "Technical and quality", source: "Profile drawing approval" },
  active_hold: { team: "Recorded hold owner", source: "Current production hold" }
};

/** Describe authoritative issues; never recompute start/release eligibility here. */
export function readinessBlockers(issues: ReadinessIssue[], links: ResolutionLinks, role: UserRole): BlockerInstruction[] {
  return [...issues].sort((a, b) => Number(b.enforced) - Number(a.enforced)).map((issue) => {
    const owner = owners[issue.code] ?? { team: "Responsible team not recorded", source: "Production readiness check" };
    let resolution = issueResolution(issue.code, links);
    if (resolution) {
      const fragment = resolution.href.startsWith("#");
      const path = resolution.href.split("?")[0];
      const allowed = fragment ? hasRouteAccess("/production", role) : hasRouteAccess(path, role);
      const editsResources = resolution.href.endsWith("/edit") || resolution.href === "#production-controls";
      if (!allowed || (editsResources && !can(role, "update", "production")) || /[\\\u0000-\u001f]/.test(resolution.href)) resolution = null;
    }
    return {
      code: issue.code, reason: issue.message, enforced: issue.enforced, ...owner,
      evidence: issue.code === "active_hold" ? "Recorded hold" : ["drawing_not_approved", "slot_missing", "billets_not_issued", "die_missing", "machine_missing"].includes(issue.code) ? "Missing evidence or setup" : "Eligibility condition",
      resolution
    };
  });
}
