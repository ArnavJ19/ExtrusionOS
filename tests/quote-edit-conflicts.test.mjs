import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteEditToken, quoteEditTokenSchema, sameQuoteEditToken } from '../lib/workflow/quote-edit-conflicts.ts';

const a = { revision: 1, updatedAt: '2026-10-28T10:00:00.123456+00:00' };
test('edit tokens retain database precision and do not manufacture missing versions', () => {
  assert.deepEqual(quoteEditToken({ revision_number: 1, updated_at: a.updatedAt }), a);
  for (const row of [{}, { revision_number: 0, updated_at: a.updatedAt }, { revision_number: 1, updated_at: 'yesterday' }]) assert.equal(quoteEditToken(row), null);
  assert.equal(quoteEditTokenSchema.safeParse({ ...a, company_id: 'forged' }).success, false);
});
test('both the opened revision and timestamp must still match', () => {
  assert.equal(sameQuoteEditToken(a, a), true);
  assert.equal(sameQuoteEditToken(a, { ...a, revision: 2 }), false);
  assert.equal(sameQuoteEditToken(a, { ...a, updatedAt: '2026-10-28T10:00:01Z' }), false);
  assert.equal(sameQuoteEditToken(a, { ...a, updatedAt: '2026-10-28T10:00:00.123457Z' }), false);
  assert.equal(sameQuoteEditToken(a, { ...a, updatedAt: '2026-10-28T15:30:00.123456+05:30' }), true);
  assert.equal(sameQuoteEditToken(null, a), false);
});
