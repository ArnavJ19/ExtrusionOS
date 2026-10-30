import type {ReactNode} from "react";
import {getSessionContext} from "@/lib/auth";
import {OperationalWorkLinks} from "@/components/modules/shared/operational-work-links";
export default async function TasksLayout({children}:{children:ReactNode}){const c=await getSessionContext();return <><OperationalWorkLinks area="tasks" role={c.role} dealer={!!c.dealerId}/>{children}</>;}
