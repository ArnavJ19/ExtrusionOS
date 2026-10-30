import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MasterCleanup } from "@/components/modules/master-cleanup";
export default async function MasterCleanupPage() { const c = await getSessionContext(); if (c.dealerId || !["owner", "admin"].includes(c.role)) redirect("/dashboard"); return <MasterCleanup key={`${c.companyId}:${c.userId}`} userId={c.userId} />; }
