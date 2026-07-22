import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const quoteDetailPage = readFileSync(join(root, "app/(dashboard)/quotes/[id]/page.tsx"), "utf8");
const quoteActions = readFileSync(join(root, "lib/actions/quotes-orders.ts"), "utf8");
const quoteWorkflow = readFileSync(join(root, "lib/workflow/quote-status.ts"), "utf8");
const transitionMigration = readFileSync(join(root, "supabase/migrations/20260718051000_quote_status_transitions.sql"), "utf8");

test("quote detail status changes use the guarded server action", () => {
  const actionStart = quoteDetailPage.indexOf("async function changeQuoteStatus");
  const actionEnd = quoteDetailPage.indexOf("\n  if (!can(context.role", actionStart);
  const detailStatusAction = quoteDetailPage.slice(actionStart, actionEnd);

  assert.ok(actionStart >= 0 && actionEnd > actionStart, "quote detail status action must be present");
  assert.match(detailStatusAction, /updateQuoteStatusAction\(id, status as QuoteStatus\)/);
  assert.doesNotMatch(detailStatusAction, /\.from\("quotes"\)/);
  assert.doesNotMatch(detailStatusAction, /\.update\(\{ status/);
  assert.match(quoteActions, /low_margin_approval_required[\s\S]*This low-margin quote needs owner\/admin approval/);
});

test("manual quote controls expose only workflow-derived next steps", () => {
  assert.match(quoteDetailPage, /getAllowedQuoteStatusTransitions\(quote\.status as QuoteStatus\)/);
  assert.doesNotMatch(quoteDetailPage, /quickQuoteStatuses/);
  assert.match(quoteWorkflow, /customer_approved: \[\]/);
  assert.match(quoteActions, /canTransitionQuoteStatus\(currentStatus, parsedStatus\.data\)/);
  assert.match(quoteActions, /parsedStatus\.data === "converted_to_order"/);
});

test("quote status errors are surfaced through fixed messages", () => {
  assert.match(quoteDetailPage, /const quoteStatusErrorMessages = \{/);
  assert.match(quoteDetailPage, /role="alert"/);
  assert.doesNotMatch(quoteDetailPage, /statusError=\$\{encodeURIComponent\(result\.error/);
  assert.ok(
    quoteDetailPage.indexOf('return "invalid_transition"') < quoteDetailPage.indexOf('return "update_failed"'),
  );
});

test("database rejects illegal quote jumps and conversion without an order", () => {
  assert.match(transitionMigration, /when 'draft' then new\.status = 'internal_review'/);
  assert.match(transitionMigration, /when 'sent' then new\.status in \('draft', 'customer_approved', 'customer_rejected', 'expired'\)/);
  assert.match(transitionMigration, /low_margin_approval_required/);
  assert.match(transitionMigration, /new\.status = 'converted_to_order' and not exists/);
  assert.match(transitionMigration, /before update of status on public\.quotes/);
});

test("accepted factory quotes enter the reviewed conversion workflow", () => {
  assert.doesNotMatch(quoteDetailPage, /convertQuoteToOrderAction/);
  assert.doesNotMatch(quoteDetailPage, /async function convertAcceptedQuote/);
  assert.match(quoteDetailPage, /href=\{`\/orders\/new\?quoteId=\$\{quote\.id\}`\}/);
  assert.match(quoteDetailPage, /Review &amp; Create Order/);
  assert.match(quoteActions, /rpc\("convert_quote_to_order_atomic"/);
});
