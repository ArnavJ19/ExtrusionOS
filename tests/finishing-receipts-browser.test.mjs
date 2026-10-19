import assert from "node:assert/strict";
import test from "node:test";
import {expect} from "@playwright/test";
import {createFinishingReceiptsBrowserFixture,createPackagingActionFixture,receiptId as id} from "../scripts/lib/finishing-receipts-browser-fixture.mjs";
import {createPartialFinishingFixture,partialFinishingIds as f} from "../scripts/lib/finishing-partial-retry-fixture.mjs";

test("QC and packaging forms keep accepted finishing receipt identities and quantities",async context=>{
  const ui=await createFinishingReceiptsBrowserFixture(),{page,field}=ui;
  try{
    await context.test("QC offers the original accepted receipt and corrective retry as distinct choices",async()=>{
      await ui.open();await ui.choose("Completed production job *","PROD-R18");
      assert.equal(await field("Quantity checked kg *").inputValue(),"40");
      await field("Accepted finishing receipt").click();await page.getByRole("button",{name:/Original receipt/}).waitFor();assert.equal(await page.getByRole("button",{name:/Original receipt/}).count(),1);assert.equal(await page.getByRole("button",{name:/Corrective retry/}).count(),1);
      assert.equal(await page.getByRole("button",{name:/20$/}).count(),0);await page.getByRole("button",{name:/Corrective retry/}).click();assert.equal(await field("Quantity checked kg *").inputValue(),"50");
      await ui.choose("Accepted finishing receipt",/Original receipt/);assert.equal(await field("Quantity checked kg *").inputValue(),"40");
    });
    await context.test("changing the production job clears the previous receipt and uses only that job's output",async()=>{
      await ui.open();await ui.choose("Completed production job *","PROD-R18");await ui.choose("Accepted finishing receipt",/Corrective retry/);
      await ui.choose("Completed production job *","PROD-OTHER");assert.equal(await field("Quantity checked kg *").inputValue(),"0");
      await field("Accepted finishing receipt").click();await page.getByRole("button",{name:/Original receipt/}).waitFor();assert.equal(await page.getByRole("button",{name:/Corrective retry/}).count(),0);
      await page.getByRole("button",{name:/Original receipt/}).click();assert.equal(await field("Quantity checked kg *").inputValue(),"20");
    });
    await context.test("non-final, zero-output and unrelated receipts never appear in the selected job's choices",async()=>{
      await ui.open();await page.evaluate(()=>{const s=window.__receipts,r=s.tables.finishing_accepted_outputs[0];s.tables.finishing_accepted_outputs.unshift(...[
        {...r,id:r.id+'a',status:'received',receipt_kind:'PENDING'}, {...r,id:r.id+'b',output_weight_kg:0,receipt_kind:'ZERO'}, {...r,id:r.id+'c',received_date:null,receipt_kind:'NO-RECEIPT'}]);});
      await ui.choose("Completed production job *","PROD-R18");await field("Accepted finishing receipt").click();
      await page.waitForFunction(()=>window.__receipts.queries.filter(q=>q.table==='finishing_accepted_outputs').length>=2);
      for(const name of [/PENDING/,/ZERO/,/NO-RECEIPT/])assert.equal(await page.getByRole('button',{name}).count(),0);await page.keyboard.press("Escape");
    });
    await context.test("receipt lookup failure displays a retryable form error without offering a false empty result",async()=>{
      await ui.open("missingView=1");await page.getByText("Accepted finishing receipts are unavailable in this schema",{exact:true}).first().waitFor();
      assert.equal(await page.getByRole('button',{name:'Save',exact:true}).count(),0);assert.ok(await page.getByRole('button',{name:/Retry/i}).count()>0);
    });
    await context.test("packaging order autofill starts at zero until an accepted receipt is chosen",async()=>{
      await ui.open("mode=packaging");await ui.choose("Order waiting packaging *","ORDER-R18");await page.getByText(/Choose its accepted finishing receipt/).waitFor();
      assert.equal(await field("Profile weight kg").inputValue(),"0");await ui.choose("Accepted finishing receipt",/Original receipt/);assert.equal(await field("Profile weight kg").inputValue(),"40");
      await ui.choose("Accepted finishing receipt",/Corrective retry/);assert.equal(await field("Profile weight kg").inputValue(),"50");
    });
    await context.test("a queued packaging edit retains its receipt and locks its source identity",async()=>{
      await ui.open(`mode=packaging&edit=${id(71)}`);assert.equal(await field("Profile weight kg").inputValue(),"40");
      for(const label of ["Order waiting packaging *","Completed production job *","Accepted finishing receipt"])assert.equal(await field(label).isDisabled(),true);
      assert.match(await field("Accepted finishing receipt").inputValue(),/Original receipt/);
      await page.getByText(/Recorded receipt:.*Original receipt.*40 kg accepted/).waitFor();
      await page.getByRole('button',{name:'Update',exact:true}).click();await page.waitForFunction(()=>window.__receipts.writes.length===1);
      const write=await page.evaluate(()=>window.__receipts.writes[0]);assert.equal(write.kind,'packaging-action');assert.equal(write.input.finishing_job_id,id(51));assert.equal(write.input.profile_weight_kg,40);
    });
    await context.test("a late order response cannot replace a more recent packaging selection",async()=>{
      await ui.open("mode=packaging");await page.evaluate(()=>window.__receipts.deferAutofill=true);
      await ui.choose("Order waiting packaging *","ORDER-R18");await ui.choose("Order waiting packaging *","ORDER-OTHER");
      await page.waitForFunction(()=>window.__receipts.pending.length===2);await page.evaluate(()=>window.__receipts.pending[1].release());
      await page.getByText(/Selected completed job PROD-OTHER/).waitFor();await page.evaluate(()=>window.__receipts.pending[0].release());
      await page.waitForFunction(()=>!document.body.textContent.includes('Selected completed job PROD-R18'));
      assert.equal(await field('Order waiting packaging *').inputValue(),'ORDER-OTHER');assert.equal(await field('Completed production job *').inputValue(),'PROD-OTHER');
    });
    await context.test("a failed order lookup clears previous packaging quantities and shows the failure",async()=>{
      await ui.open("mode=packaging");await ui.choose("Order waiting packaging *","ORDER-R18");await page.getByText(/Choose its accepted finishing receipt/).waitFor();await ui.choose("Accepted finishing receipt",/Original receipt/);
      await page.evaluate(()=>window.__receipts.errors.production_jobs={message:'Synthetic packaging read unavailable'});await ui.choose("Order waiting packaging *","ORDER-OTHER");
      await page.getByText('Synthetic packaging read unavailable',{exact:true}).first().waitFor();assert.equal(await field('Profile weight kg').inputValue(),'0');assert.equal(await field('Accepted finishing receipt').inputValue(),'');
    });
    await context.test("packaging production choices stay within the order and a source change clears receipt quantities",async()=>{
      await ui.open('mode=packaging');await page.evaluate(()=>{const s=window.__receipts,j=s.tables.production_jobs[0];s.tables.production_jobs.push({...j,id:'00000000-0000-4000-8000-000000000062',job_number:'PROD-SECOND',actual_quantity_kg:12});});
      await ui.choose('Order waiting packaging *','ORDER-R18');await page.getByText(/Choose its accepted finishing receipt/).waitFor();await ui.choose('Accepted finishing receipt',/Original receipt/);
      await field('Completed production job *').click();assert.equal(await page.getByRole('button',{name:'PROD-OTHER',exact:true}).count(),0);
      await field('Completed production job *').fill('SECOND');await page.getByRole('button',{name:'PROD-SECOND',exact:true}).click();
      await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.__receipts.writes.length===1);
      const input=await page.evaluate(()=>window.__receipts.writes[0].input);assert.equal(input.production_job_id,id(62));assert.equal(input.finishing_job_id,null);assert.equal(input.profile_weight_kg,0);assert.equal(input.profile_length_m,0);assert.equal(input.pieces,0);
      await expect(field('Accepted finishing receipt')).toHaveValue('');await expect(field('Profile weight kg')).toHaveValue('0');await expect(field('Profile length m')).toHaveValue('0');await expect(field('Pieces')).toHaveValue('0');
    });
    await context.test("explicit production selection invalidates an unfinished order autofill request",async()=>{
      await ui.open('mode=packaging');await page.evaluate(()=>window.__receipts.deferAutofill=true);await ui.choose('Order waiting packaging *','ORDER-R18');
      await page.waitForFunction(()=>window.__receipts.pending.length===1);await ui.choose('Completed production job *','PROD-R18');
      await page.evaluate(()=>window.__receipts.pending[0].release());await page.getByText('Production source changed. Verify its accepted receipt and packing quantities.',{exact:true}).waitFor();
      assert.equal(await field('Profile weight kg').inputValue(),'0');assert.equal(await field('Accepted finishing receipt').inputValue(),'');
    });
    assert.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});

test("actual browser payloads preserve receipt identity through QC SQL and the packaging server action",async()=>{
  const sql=await createPartialFinishingFixture();let ui;
  try{
    await sql.reset();const original=await sql.partial();await sql.retryComplete();const before=await sql.snapshot();
    const receipts=(await sql.db.query('select * from finishing_accepted_outputs order by output_weight_kg')).rows,job=(await sql.db.query('select * from production_jobs where id=$1',[f.job])).rows[0];
    ui=await createFinishingReceiptsBrowserFixture({tables:{production_jobs:[{...job,job_number:'PROD-R18'}],finishing_accepted_outputs:receipts,packaging_jobs:before.packaging}});
    await ui.open();await ui.choose('Completed production job *','PROD-R18');await ui.choose('Accepted finishing receipt',/Original receipt/);
    await ui.choose('Inspection result','Approved');await ui.field('Inspector').fill('Synthetic browser inspector');await ui.page.getByRole('button',{name:'Save',exact:true}).click();
    await ui.page.waitForFunction(()=>window.__receipts.writes.length===1).catch(async error=>{throw new Error(`${error.message}\n${await ui.page.locator('body').innerText()}`);});const quality=await ui.page.evaluate(()=>window.__receipts.writes[0]);
    assert.equal(quality.kind,'quality_inspections');assert.equal(quality.input.finishing_job_id,original);assert.equal(quality.input.quantity_checked_kg,40);
    await sql.attempt(()=>sql.db.query("select private.insert_jsonb_row('public.quality_inspections'::regclass,$1) id",[quality.input]));
    const pkg=before.packaging.find(row=>row.finishing_job_id===original);
    await ui.open(`mode=packaging&edit=${pkg.id}`);await ui.choose('Status','Completed');await ui.page.getByRole('button',{name:'Add Material',exact:true}).click();
    await ui.page.getByPlaceholder('Select material',{exact:true}).click();await ui.page.getByRole('button',{name:/Synthetic packing film/}).click();
    await ui.page.getByRole('button',{name:'Update',exact:true}).click();await ui.page.waitForFunction(()=>window.__receipts.writes.length===1);
    const packaging=await ui.page.evaluate(()=>window.__receipts.writes[0]);assert.equal(packaging.input.finishing_job_id,original);
    const action=createPackagingActionFixture(sql.db),saved=await action.actions.savePackagingJobAction(packaging.input);assert.equal(saved.success,true,JSON.stringify(saved));assert.equal(saved.jobId,pkg.id);
    assert.equal(action.state.calls[0].args.p_job.finishing_job_id,original);assert.equal((await sql.snapshot()).materialStock,99);
    await sql.db.query("select set_config('test.role','dispatch_manager',false)");assert.equal(Number((await sql.ready()).rows[0].ready_weight_kg),40);
    await sql.db.exec('commit;begin;');assert.equal(Number((await sql.ready()).rows[0].ready_weight_kg),40);assert.deepEqual(ui.errors,[]);
  }finally{if(ui)await ui.close();await sql.close();}
});
