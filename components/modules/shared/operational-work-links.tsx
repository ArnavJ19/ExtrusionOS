import Link from "next/link";
import type {UserRole} from "@/types/app";
type Area="tasks"|"vendors"|"production"|"dispatches"|"customers"|"invoices"|"payments"|"settings";
const managers=["owner","admin","sales_manager","production_manager","factory_manager","inventory_manager","dispatch_manager","quality","accounts"];
const finance=["owner","admin","accounts"];
const entries:Record<Area,{href:string;label:string;roles?:string[];external?:boolean}[]>={
  tasks:[{href:"/tasks/practice",label:"Practice with sample transactions",external:true},{href:"/tasks/changes",label:"Review source changes and reconciliation",roles:managers}],
  vendors:[{href:"/vendors/purchasing",label:"Purchase orders, receipts and supplier matching",roles:["owner","admin","accounts","inventory_manager"]}],
  production:[{href:"/production/capacity",label:"Plan machine and shift capacity",roles:["owner","admin","production_manager","production","factory_manager"]},{href:"/dispatches/loads",label:"Review capacity delivery proposals",roles:["owner","admin","production_manager","production","factory_manager"]}],
  dispatches:[{href:"/dispatches/loads",label:"Vehicle loads and delivery proposals",roles:["owner","admin","factory_manager","dispatch_manager","dispatch","sales_manager","sales"]}],
  customers:[{href:"/customers/portal-responses",label:"Review customer portal responses",roles:["owner","admin","sales_manager","sales"]}],
  invoices:[{href:"/invoices/eligibility",label:"Review eligible dispatch billing",roles:finance}],
  payments:[{href:"/payments/receipts",label:"Record, import and allocate receipts",roles:finance}],
  settings:[{href:"/settings/master-cleanup",label:"Review duplicate master identities",roles:["owner","admin"]}],
};
export function OperationalWorkLinks({area,role,dealer=false}:{area:Area;role:UserRole;dealer?:boolean}){const links=entries[area].filter(e=>(!dealer||e.external)&&(!e.roles||e.roles.includes(role)));return links.length?<nav aria-label="Related workflows" className="mb-4 flex flex-wrap gap-3">{links.map(e=><Link key={e.href} className="inline-flex rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold" href={e.href}>{e.label}</Link>)}</nav>:null;}
