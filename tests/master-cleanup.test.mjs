import test from 'node:test';
import assert from 'node:assert/strict';
import { masterCleanupSchema } from '../lib/workflow/master-cleanup.ts';
const id='bc000000-0000-4000-8000-000000004000';
test('59: cleanup requests preserve authority and require a specific reviewed comparison',()=>{
  assert.equal(masterCleanupSchema.safeParse({command:'review.preview',entity_type:'customers',source_id:id,target_id:id}).success,true);
  for(const value of [{command:'review.propose',entity_type:'customers',source_id:id,target_id:id,id,reason:'Valid consolidation'}, {command:'masters.list',entity_type:'invoices'}, {command:'masters.list',entity_type:'customers',company_id:id}, {command:'reviews.list',page:0}]) assert.equal(masterCleanupSchema.safeParse(value).success,false);
});
