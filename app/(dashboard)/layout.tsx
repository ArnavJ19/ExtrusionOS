import { AppShell } from "@/components/layout/app-shell";
import { ErrorReporter } from "@/components/monitoring/error-reporter";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ErrorReporter />{children}</AppShell>;
}
