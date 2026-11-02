import type {ReactNode} from "react";
import {getSessionContext} from "@/lib/auth";
import {OperationalWorkLinks} from "@/components/modules/shared/operational-work-links";
import Link from "next/link";
import {canReadCoordination} from "@/lib/workflow/coordination";
export default async function TasksLayout({children}:{children:ReactNode}){const c=await getSessionContext();return <><OperationalWorkLinks area="tasks" role={c.role} dealer={!!c.dealerId}/>{!c.dealerId && canReadCoordination(c.role) ? <Link href="/tasks/coordination" className="mb-4 inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold">Daily coordination and responsibility</Link> : null}{children}</>;}
