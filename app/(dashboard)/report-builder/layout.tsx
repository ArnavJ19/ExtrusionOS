import type { ReactNode } from "react";
import { InsightsNav } from "@/components/modules/autopilot-batch8/insights-nav";

// AP-044: this report is part of Insights.
export default function InsightsSectionLayout({ children }: { children: ReactNode }) {
  return <><InsightsNav current="/report-builder" />{children}</>;
}
