import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workflowIds as ids, workflowLine } from '../scripts/lib/upgrade-workflow-actions-fixture.mjs';

const token = { revision: 1, updatedAt: '2026-10-28T10:00:00.123456Z' };
const state = { role: 'owner', calls: [], queries: [], current: null, rpcError: null, cacheError: false };
const client = { from(table) {
  const query = { select() { return query; }, eq() { return query; }, in() { return query; }, maybeSingle() { return query; },
    then(yes, no) { state.queries.push(table); return Promise.resolve({ error: null, data: table === 'customers' ? { id: ids.customer } : table === 'quotes_authorized' ? state.current : table === 'aluminium_profiles' ? [{ id: ids.profile, profile_code: 'AL-101', profile_name: 'Sample', section_weight_kg_per_m: 0.75, section_perimeter_mm: 120 }] : [] }).then(yes, no); } };
  return query;
}, async rpc(name, args) { state.calls.push({ name, args }); return { data: ids.quote, error: state.rpcError }; } };
const require = createRequire(import.meta.url); require('tsx/cjs');
const Module = require('node:module'), original = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@/lib/auth') return { getSessionContext: async () => ({ companyId: ids.company, userId: ids.user, dealerId: null, role: state.role }) };
  if (request === '@/lib/supabase/server') return { createClient: async () => client };
  if (request === 'next/cache') return { revalidatePath() { if (state.cacheError) throw Error('Synthetic cache failure'); } };
  return original.call(this, request, parent, isMain);
};
let save;
try { save = require('../lib/actions/quotes-orders.ts').saveQuoteAction; } finally { Module._load = original; }
const input = () => ({ customer_id: ids.customer, quote_date: '2026-10-28', status: 'draft', gst_percent: 18, items: [workflowLine], editing_id: ids.quote, edit_token: token });
test.beforeEach(() => Object.assign(state, { role: 'owner', calls: [], queries: [], rpcError: null, cacheError: false, current: { id: ids.quote, revision_number: 1, updated_at: token.updatedAt, status: 'draft', grand_total: 1000 } }));

test('missing browser version refuses editing before reads or writes', async () => {
  const result = await save({ ...input(), edit_token: null });
  assert.equal(result.success, false); assert.match(result.error, /version is missing/); assert.equal(state.queries.length, 0);
});
test('a newer draft cannot be overwritten with a token fetched at save time', async () => {
  state.current.updated_at = '2026-10-28T10:00:01Z'; state.current.notes = 'New employee note';
  const result = await save(input());
  assert.equal(result.success, false); assert.equal(result.conflict.notes, 'New employee note');
  assert.equal(result.conflict.token.updatedAt, state.current.updated_at); assert.equal(state.calls.length, 0);
});
test('an issued revision change is reported even if its timestamp is unchanged', async () => {
  state.current.revision_number = 2;
  const result = await save(input()); assert.equal(result.conflict.token.revision, 2); assert.equal(state.calls.length, 0);
});
test('unauthorized roles receive no current commercial comparison', async () => {
  for (const role of ['sales', 'sales_manager', 'production', 'viewer', 'dealer_admin']) {
    state.role = role; const result = await save(input()); assert.equal(result.success, false); assert.equal(result.conflict, undefined);
  }
  assert.equal(state.queries.length, 0);
});
test('the original browser token reaches the atomic write unchanged', async () => {
  const result = await save(input()); assert.equal(result.success, true, result.error);
  assert.equal(state.calls[0].args.p_expected_revision, token.revision);
  assert.equal(state.calls[0].args.p_expected_updated_at, token.updatedAt);
});
test('a cache outage does not change a confirmed quotation save into a failure',async()=>{
  state.cacheError=true;const result=await save(input());assert.equal(result.success,true,result.error);assert.equal(state.calls.length,1);
});
