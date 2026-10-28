import assert from "node:assert/strict";
import test from "node:test";
import { migrationFiles, replayMigrationChain } from "../scripts/lib/migration-chain-replay.mjs";

test("every migration has a unique 14-digit version so file order is unambiguous", () => {
  const versions = migrationFiles().map(name => name.split("_")[0]);
  assert.deepEqual(versions.filter(version => !/^\d{14}$/.test(version)), []);
  assert.deepEqual(versions.filter((version, index) => versions.indexOf(version) !== index), []);
});

test("a fresh database builds from the baseline and every migration in file order", { timeout: 300_000 }, async () => {
  const { db, files, applied, failures } = await replayMigrationChain({ stopOnFailure: false });
  try {
    assert.deepEqual(failures, []);
    assert.equal(applied, files.length);
    const { rows } = await db.query(`select
      to_regclass('public.tasks') is not null as tasks,
      to_regclass('public.production_plan_slots') is not null as plan_slots,
      exists (select 1 from pg_indexes where indexname = 'idx_tasks_company_status_due') as command_center_index,
      (select array_agg(plan_type order by plan_type) from public.subscription_plans) as plan_types,
      (select pg_get_constraintdef(oid) like '%''nvidia''%' from pg_constraint where conname = 'company_settings_ai_provider_check') as nvidia_provider,
      (select pg_get_constraintdef(oid) like '%''credit_notes''%' from pg_constraint where conname = 'saved_reports_data_source_check') as credit_note_reports,
      exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'order_source_label') as archived_dealer_column`);
    assert.deepEqual(rows[0], {
      tasks: true, plan_slots: true, command_center_index: true,
      plan_types: ["enterprise", "free_demo", "pro", "starter"],
      nvidia_provider: true, credit_note_reports: true, archived_dealer_column: false
    });
    // Exercise the new workflow with the actual schema and all existing task triggers.
    const company = 'ad000000-0000-4000-8000-000000000001';
    const owner = 'ad000000-0000-4000-8000-000000000010';
    const quality = 'ad000000-0000-4000-8000-000000000011';
    const operator = 'ad000000-0000-4000-8000-000000000012';
    const procedure = 'ad000000-0000-4000-8000-000000000020';
    const version = 'ad000000-0000-4000-8000-000000000021';
    const plan = 'ad000000-0000-4000-8000-000000000022';
    await db.query('insert into companies(id,name) values($1,$2)', [company, 'SOP acceptance fixture']);
    for (const [id, role] of [[owner, 'owner'], [quality, 'quality'], [operator, 'production']]) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}@sop.invalid`]);
      await db.query('insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,$3,$4,$3,true)', [id,company,role,`${role}@sop.invalid`]);
    }
    const actor = id => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await actor(owner);
    await db.query(`insert into operating_procedures(id,company_id,title,purpose,scope_label,owner_id,owner_name,backup_id,backup_name,routine_kind,prompts,created_by,request_payload)
      values($1,$2,'Acceptance procedure','Inspect an actual test task','Test station',$3,'Owner',$4,'Quality','none','[]',$3,'{}')`, [procedure,company,owner,quality]);
    const command = async (rpc, name, payload) => (await db.query(`select public.${rpc}($1,$2) data`, [name,payload])).rows[0].data;
    const vc = (n,p) => command('procedure_version_command',n,p);
    await vc('kinds.set', { task_kind: 'type:sop_acceptance', procedure_id: procedure });
    const draft = await vc('draft.save', { procedure_id: procedure, version_id: version, steps: [{ text: 'Inspect the approved sample' }], change_summary: 'First issue', expected_hash: null });
    await vc('draft.submit', { version_id: version, expected_hash: draft.content_hash });
    await actor(quality);
    await vc('review.release', { version_id: version, expected_hash: draft.content_hash, effective_from: (await db.query('select private.ist_today()::text d')).rows[0].d, in_flight_policy: 'keep_current' });
    const gc = (n,p) => command('guided_sop_command',n,p);
    await actor(owner);
    await gc('plan.save', { version_id: version, id: plan, steps: [{ step_no: 1, kind: 'check' }], normal_role: 'quality', elevated_role: 'quality' });
    await actor(quality); await gc('plan.release', { version_id: version, expected_revision: 1 });
    const task = (await db.query("insert into tasks(company_id,task_type,title,assigned_to,created_by) values($1,'sop_acceptance','Inspect sample',$2,$3) returning id", [company,operator,owner])).rows[0].id;
    await actor(operator); await gc('run.start', { task_id: task });
    await gc('step.record', { task_id: task, expected_revision: 1, step_no: 1, id: 'ad000000-0000-4000-8000-000000000030', note: 'Sample is within the approved specification' });
    await gc('run.submit', { task_id: task, expected_revision: 2 });
    await actor(quality); await gc('run.verify', { task_id: task, expected_revision: 3, note: 'Sample and evidence independently checked' });
    await actor(operator); const completed = await gc('run.complete', { task_id: task, expected_revision: 4 });
    assert.equal(completed.run.status, 'completed');
    assert.equal((await db.query('select status from tasks where id=$1',[task])).rows[0].status, 'completed');
    const competency = 'ad000000-0000-4000-8000-000000000040';
    await actor(owner);
    await command('competency_command','catalog.save',{id:competency,code:'SOP_ACCEPT',name:'Sample inspection',procedure_id:procedure,validity_months:null,is_active:true});
    await command('competency_command','grant.set',{employee_id:operator,competency_id:competency,level:'independent',note:'Demonstrated current procedure'});
    assert.equal((await db.query('select private.competency_standing($1,$2) s',[operator,competency])).rows[0].s.effective,'independent');
    const version2='ad000000-0000-4000-8000-000000000041';
    const revised=await vc('draft.save',{procedure_id:procedure,version_id:version2,steps:[{text:'Inspect sample using revised gauge'}],change_summary:'New gauge method',expected_hash:null});
    await vc('draft.submit',{version_id:version2,expected_hash:revised.content_hash});
    await actor(quality);await vc('review.release',{version_id:version2,expected_hash:revised.content_hash,effective_from:(await db.query('select private.ist_today()::text d')).rows[0].d,in_flight_policy:'keep_current'});
    assert.equal((await db.query('select private.competency_standing($1,$2) s',[operator,competency])).rows[0].s.effective,'supervised','published instructions invalidate the older independent qualification');
    assert.equal((await db.query('select version_id from task_procedure_bindings where task_id=$1',[task])).rows[0].version_id,version,'completed instructions remain the original version');
    const protectedTables = ['procedure_versions','procedure_task_kinds','task_procedure_bindings','task_procedure_binding_events','task_blueprints','task_blueprint_revisions','task_blueprint_starts','task_exceptions','procedure_improvements','procedure_step_flags','sop_execution_plans','sop_runs','sop_step_events','sop_verification_events','sop_continuity_policies','sop_recovery_notes','sop_observed_trials','order_requirement_acknowledgements'];
    const acl = await db.query(`select relname,relrowsecurity,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') as direct_access
      from pg_class where relnamespace='public'::regnamespace and relname=any($1)`,[protectedTables]);
    assert.equal(acl.rows.length,protectedTables.length);
    for (const row of acl.rows) { assert.equal(row.relrowsecurity,true,row.relname);assert.equal(row.direct_access,false,row.relname); }
    for (const rpc of ['procedure_version_command','task_blueprint_command','procedure_effectiveness_command','guided_sop_command','sop_assurance_command','customer_requirement_command']) {
      const permissions=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') u",[`public.${rpc}(text,jsonb)`])).rows[0];
      assert.deepEqual(permissions,{a:false,u:true},rpc);
    }
    for(const helper of ['private.sop_run_view(public.tasks)','private.sop_evidence_state(public.tasks,text,uuid,text)','private.lock_sop_source(uuid,text,uuid)','private.competency_standing(uuid,uuid)']) {
      assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') e",[helper])).rows[0].e,false,helper);
    }
  } finally {
    await db.close();
  }
});
