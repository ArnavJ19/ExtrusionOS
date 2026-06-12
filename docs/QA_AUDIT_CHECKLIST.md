# QA and Audit Checklist — ExtrusionOS

Use this checklist after major code changes.

## 1. Standard Commands

Run available commands:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

If a command is missing, document it.

---

## 2. Manual Test: Authentication

- [ ] Signup works.
- [ ] Login works.
- [ ] Logout works.
- [ ] Protected routes redirect when logged out.
- [ ] Company onboarding works.
- [ ] User role loads correctly.
- [ ] Sidebar/navigation respects role.
- [ ] Disabled user behavior is correct.

---

## 3. Manual Test: Customers

- [ ] Create customer.
- [ ] Edit customer.
- [ ] View customer detail.
- [ ] Search customer.
- [ ] Filter customer.
- [ ] Pagination works.
- [ ] Customer database page works.
- [ ] Customer related quotes/orders/payments show correctly.
- [ ] No cross-company data visible.

---

## 4. Manual Test: Profiles

- [ ] Create profile.
- [ ] Edit profile.
- [ ] Section weight kg/m validates.
- [ ] Profile code uniqueness works.
- [ ] Drawing/image upload works if enabled.
- [ ] Profile database page works.
- [ ] Profile detail page works.

---

## 5. Manual Test: Dies

- [ ] Create die.
- [ ] Edit die.
- [ ] Link die to profile.
- [ ] Customer-owned die links to customer.
- [ ] Status badge works.
- [ ] Die overview groups by status.
- [ ] Die database page paginates by 10.
- [ ] Die detail page works.
- [ ] Dead/inactive die warning works where applicable.

---

## 6. Manual Test: Quotes

- [ ] Create quote.
- [ ] Add quote item.
- [ ] Total meters calculates.
- [ ] Total weight calculates.
- [ ] Material cost calculates.
- [ ] Conversion cost calculates.
- [ ] Finishing cost calculates.
- [ ] Die charge is included.
- [ ] Packing and transport charges are included.
- [ ] Margin calculates.
- [ ] GST calculates.
- [ ] Grand total calculates.
- [ ] Price per kg/meter calculates safely.
- [ ] PDF generation works.
- [ ] WhatsApp summary works if enabled.
- [ ] Quote status changes work.
- [ ] Approved quote converts to order.
- [ ] Converted quote cannot be converted twice.
- [ ] Low-margin warnings work.
- [ ] Customer PDF does not expose internal margin/cost.

---

## 7. Manual Test: Orders

- [ ] Create order.
- [ ] Convert quote to order.
- [ ] Stage board works.
- [ ] Priority sorting works.
- [ ] Stage update creates history.
- [ ] Delayed badge works.
- [ ] Order database page works.
- [ ] Order detail page works.
- [ ] Closed/cancelled orders handled correctly.

---

## 8. Manual Test: Production

- [ ] Create production job.
- [ ] Assign machine/press.
- [ ] Assign die/profile.
- [ ] Update job status.
- [ ] Record actual output.
- [ ] Record rejection.
- [ ] Record scrap.
- [ ] Production status board works.
- [ ] Production database page works.
- [ ] Production detail page works.

---

## 9. Manual Test: Inventory

- [ ] Create inventory item.
- [ ] Stock in works.
- [ ] Stock out works.
- [ ] Adjustment works.
- [ ] Low stock alert works.
- [ ] Negative stock is blocked or handled intentionally.
- [ ] Inventory movement history works.
- [ ] Inventory database page works.
- [ ] Inventory detail page works.

---

## 10. Manual Test: Dispatches

- [ ] Create dispatch.
- [ ] Link dispatch to order.
- [ ] Add bundles.
- [ ] Add total weight.
- [ ] Add transporter.
- [ ] Add vehicle number.
- [ ] Add e-way bill.
- [ ] Add LR number.
- [ ] Proof of delivery upload works.
- [ ] Delivery status updates order if required.
- [ ] Dispatch database page works.
- [ ] Dispatch detail page works.

---

## 11. Manual Test: Payments

- [ ] Create invoice.
- [ ] Record payment.
- [ ] Balance due updates.
- [ ] Overdue status works.
- [ ] Partial payment works.
- [ ] Paid status works.
- [ ] Overpayment is blocked or handled intentionally.
- [ ] Customer outstanding report works.

---

## 12. Manual Test: Quality

- [ ] Create quality test.
- [ ] Upload certificate.
- [ ] Create NCR.
- [ ] Update NCR status.
- [ ] Create complaint.
- [ ] Close complaint.
- [ ] Customer-facing quality documents hide internal notes where needed.

---

## 13. Manual Test: Reports

- [ ] Reports load.
- [ ] Date filters work.
- [ ] Status filters work.
- [ ] Customer filters work.
- [ ] Export CSV works if enabled.
- [ ] Export PDF works if enabled.
- [ ] Sensitive reports are restricted.

---

## 14. Manual Test: File Uploads

- [ ] Company logo upload works.
- [ ] Profile drawing upload works.
- [ ] Die drawing upload works.
- [ ] Quote PDF storage works.
- [ ] Dispatch proof upload works.
- [ ] Quality certificate upload works.
- [ ] Wrong file types are rejected where required.
- [ ] Large files are rejected where required.
- [ ] Users cannot access another company’s files.

---

## 15. Manual Test: UI

- [ ] Overview pages are not cluttered.
- [ ] Forms and full tables are not shown together.
- [ ] Database pages paginate by 10.
- [ ] Search works.
- [ ] Filters work.
- [ ] Sort works.
- [ ] Empty states show.
- [ ] Loading states show.
- [ ] Error states show.
- [ ] Mobile layout works.
- [ ] Tablet layout works.
- [ ] Desktop layout works.

---

## 16. Manual Test: Security

- [ ] Company A cannot access Company B records.
- [ ] Low-role user cannot access admin pages.
- [ ] Sales user cannot see restricted margin if configured.
- [ ] Production user cannot edit price.
- [ ] Dispatch user cannot edit quotes.
- [ ] Public share link shows only safe data.
- [ ] Portal user sees only their customer data.
- [ ] Service role key is not exposed.

---

## 17. Manual Test: System Configurator, If Enabled

- [ ] Selecting sliding window changes preview.
- [ ] Selecting casement window changes preview.
- [ ] Selecting fixed window changes preview.
- [ ] Selecting hinged door changes preview.
- [ ] Width/height update preview.
- [ ] Cutting list generated.
- [ ] Glass list generated.
- [ ] Hardware BOM generated.
- [ ] Customer quote hides internal cost.
- [ ] Production sheet includes needed details.

---

## 18. Final Release Decision

Choose one:

- [ ] Safe to demo
- [ ] Safe to deploy with caution
- [ ] Not safe to deploy
- [ ] Not safe to demo

Document reason.
