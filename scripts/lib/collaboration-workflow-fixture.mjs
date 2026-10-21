import { readFileSync } from "node:fs";
import { createOperatorWorkflowFixture, workflowIds as ids, workflowId as id } from "./operator-workflow-fixture.mjs";
export { workflowIds as ids, workflowId as id } from "./operator-workflow-fixture.mjs";

export async function createCollaborationFixture() {
  const f = await createOperatorWorkflowFixture();
  await f.db.exec(`alter table production_jobs add job_number text default 'JOB-1',add created_at timestamptz default now()-interval '2 days',add updated_at timestamptz default now();
    create table orders(id uuid primary key,company_id uuid,deleted_at timestamptz,customer_id uuid,dealer_id uuid);
    create table dispatches(id uuid primary key,company_id uuid);
    create table quality_inspections(id uuid primary key,company_id uuid);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid,recipient_user_id uuid,notification_type text,severity text,title text,body text,related_entity_type text,related_entity_id uuid,created_by uuid,action_link text,entity_reference text);
    create table tasks(id uuid primary key,company_id uuid,title text,status text,assigned_to uuid,dealership_id uuid,due_date date,updated_at timestamptz default now());
    create table quotes(id uuid primary key,company_id uuid,status text,customer_id uuid,dealer_id uuid);
    alter table quotes enable row level security;
    create policy quotes_access_read on quotes for select to authenticated using(company_id=private.get_current_user_company_id());
    create table quote_items(id uuid primary key,company_id uuid,quote_id uuid,costing_complete boolean);
    alter table customers enable row level security;
    grant select on customers to authenticated;
    create policy customers_access_read on customers for select to authenticated using(company_id=private.get_current_user_company_id() and (private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager','quality','viewer') or exists(select 1 from quotes q where q.customer_id=customers.id and q.dealer_id=private.get_current_user_dealer_id())));
    insert into orders(id,company_id,deleted_at) values('${ids.order}','${ids.company}',null),('${id(61)}','${ids.otherCompany}',null);
    insert into dispatches values('${id(80)}','${ids.company}');insert into quality_inspections values('${id(81)}','${ids.company}');`);
  await f.db.exec(readFileSync("supabase/migrations/20261021190916_collaboration_procedure_routines.sql", "utf8"));
  await f.db.exec(readFileSync("supabase/migrations/20261021201325_collaboration_foreign_key_indexes.sql", "utf8"));
  const command = async (name, payload, options) => (await f.asUser("select public.collaboration_workflow_command($1,$2) data", [name, payload], options))[0].data;
  async function reset() {
    await f.reset();
    await f.db.exec("truncate daily_routine_completions,daily_routine_runs,operating_procedure_events,operating_procedures,record_discussions,notifications,tasks,quote_items,quotes");
    await f.db.exec(`update orders set deleted_at=null;update production_jobs set status='in_progress',updated_at=now();
      insert into tasks(id,company_id,title,status,assigned_to,due_date) values('${id(90)}','${ids.company}','Confirm rack handover','open','${ids.actor}',current_date-1),('${id(91)}','${ids.otherCompany}','FOREIGN TASK','open','${ids.otherActor}',current_date-1),('${id(92)}','${ids.company}','Colleague task','open','${ids.colleague}',current_date-1);`);
  }
  await reset();
  return { ...f, command, reset };
}

export function procedureInput(extra = {}) { return { title: "Press opening", purpose: "Review assigned work and the press handover", scope_label: "Press 1", owner_id: ids.actor, backup_id: ids.colleague, review_due: "2027-01-01", routine_kind: "opening", prompts: ["Confirm the physical handover"], request_id: id(1000), ...extra }; }
