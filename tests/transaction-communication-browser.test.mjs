import test from 'node:test';import assert from 'node:assert/strict';
import {createFactoryBrowserFixture} from '../scripts/lib/factory-upgrade-browser-fixture.mjs';
const id='bc000000-0000-4000-8000-000000000001';
const data={invoice_id:id,invoice_number:'INV-1',invoice_date:'2026-10-29',customer_name:'Customer',recipient_phone:'9876543210',supplier_name:'Factory',grand_total:11800,document_path:`/api/pdf/invoice/${id}`,status:'sent',delivery_state:'prepared_only',fingerprint:'a'.repeat(32)};
let f,p;test.before(async()=>{f=await createFactoryBrowserFixture({props:{invoiceId:id},results:{invoiceCommunicationAction:{success:true,data}}});p=f.page;});test.after(async()=>f?.close());test.beforeEach(async()=>f.reset());
test('18: recipient and outgoing content are reviewed before copying, with no delivered claim',async()=>{
  await p.getByRole('button',{name:'Prepare customer message',exact:true}).click();await p.getByLabel('Outgoing text').waitFor();assert.match(await p.getByLabel('Outgoing text').inputValue(),/INV-1/);
  assert.equal(await p.getByRole('link',{name:'Open invoice PDF to print or download'}).getAttribute('href'),data.document_path);
  await p.getByRole('button',{name:'Recheck and copy message',exact:true}).click();await p.getByText('Message copied. Delivery has not been confirmed.',{exact:true}).waitFor();assert.equal((await p.evaluate(()=>window.__factory.calls)).length,2);
});
test('18: changed invoice and failed transport cannot claim a copied or delivered message',async()=>{
  await p.getByRole('button',{name:'Prepare customer message',exact:true}).click();await p.getByLabel('Outgoing text').waitFor();
  await p.evaluate(data=>{window.__factory.results.invoiceCommunicationAction={success:true,data:{...data,fingerprint:'b'.repeat(32)}};},data);
  await p.getByRole('button',{name:'Recheck and copy message',exact:true}).click();await p.getByText('The invoice changed. Review the updated outgoing text before copying.',{exact:true}).waitFor();
  await p.evaluate(()=>{window.__factory.results.invoiceCommunicationAction={throw:true};});await p.getByRole('button',{name:'Recheck and copy message',exact:true}).click();await p.getByText('The message could not be copied. Delivery has not been confirmed.',{exact:true}).waitFor();
});
