import { redirect } from "next/navigation";

// AP-043: Die Intelligence is part of the die module. Die health (scores, rejection, corrections, trials and cost per kg
// for the roles that saw it here) is on the die overview; per-die performance is on each die record.
export default function DieIntelligencePage() {
  redirect("/dies#die-health");
}
