import { redirect } from "next/navigation";

// AP-044: reporting has one entry point.
export default function ReportsPage() {
  redirect("/insights");
}
