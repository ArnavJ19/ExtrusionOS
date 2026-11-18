// Real batch 9 screens and gateways on a replayed local database, with synthetic operating records only.
import { createBatch9BrowserFixture } from "./lib/autopilot-batch9-browser-fixture.mjs";
import { ids as i, istDay } from "./lib/autopilot-batch9-fixture.mjs";

process.env.BATCH9_FIXTURE_PORT ??= "4189";
const fx = await createBatch9BrowserFixture();
await fx.start();
const data = await fx.run(async () => {
  const f = fx.f;
  await f.seed("update aluminium_profiles set product_family='Sliding window' where id=$1", [i.profile2]);
  await f.rate({ type: "conversion", rate: 42, customer: i.customer2 });
  await f.rate({ type: "finishing", rate: 30, finishing: "powder_coating" });
  await f.rate({ type: "finishing", basis: "per_sqft", rate: 12, finishing: "anodizing" });
  const card = await f.call("ap_rate_card", "generate", { customer_id: i.customer2, valid_days: 1 }, i.sales);
  // Scrap: butt ends in the foundry pool, coating rejections in the yard, two offers.
  await f.scrap({ kg: 300, category: "butt_end", daysAgo: 5 });
  await f.scrap({ kg: 200, type: "coating_rejection" });
  const grade = (await f.call("ap_scrap_sale", "stock", {}, i.inventory)).grades.find(g => g.code === "EXT-CLEAN");
  await f.call("ap_scrap_sale", "offer", { grade_id: grade.grade_id, buyer_id: i.customer2, rate_per_kg: 180, quantity_kg: 250, valid_until: istDay(3) }, i.inventory);
  const best = await f.call("ap_scrap_sale", "offer", { grade_id: grade.grade_id, buyer_id: i.customer2, rate_per_kg: 192.5, quantity_kg: 250, valid_until: istDay(3) }, i.inventory);
  const sale = await f.call("ap_scrap_sale", "accept_offer", { offer_id: best.id }, i.inventory);
  // Weight differences: a tolerance and an invoice with a drafted credit note.
  await f.call("ap_weight_note", "save_tolerance", { tolerance_percent: 0.5, reason: "Company default per terms" }, i.accounts);
  const inv = await f.invoice({ kg: 570, rate: 300 });
  await f.call("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 560, customer_reference: "WB-778" }, i.sales);
  // Cash forecast inputs.
  await f.bill({ amount: 85000, due: 9 });
  await f.call("ap_cash_forecast", "save_fixed", { label: "Salaries", amount: 450000, frequency: "monthly", day_of_month: 1 }, i.accounts);
  await f.call("ap_cash_forecast", "save_one_off", { on_date: istDay(8), direction: "out", amount: 25000, label: "Die advance to Precision Die Works" }, i.accounts);
  // An enquiry with one unknown code.
  const line = (seq, x) => ({ seq, text: "line", code: null, code_key: null, profile_id: null, profile_code: null, basis: null, length_m: 6.4, length_text: "6.4 mtr", pieces: 200, kg: null, finish: "powder_coating", shade: "RAL 9010", alloy: null, confidence: "low", issues: [], ...x });
  const enquiry = await f.call("ap_enquiry", "save", { raw_text: "OM-2045 6.4 mtr 200 pcs RAL 9010, XX-999 21 ft 100 pcs mill", source: "paste", customer_id: i.customer2, customer_basis: "phone",
    lines: [line(1, { text: "OM-2045 6.4 mtr 200 pcs RAL 9010", code: "OM-2045", code_key: "OM2045", profile_id: i.profile2, profile_code: "OM-2045", basis: "code", confidence: "high" }),
      line(2, { text: "XX-999 21 ft 100 pcs mill", code: "XX-999", code_key: "XX999", length_m: 6.4008, length_text: "21 ft", pieces: 100, finish: "mill_finish", shade: null, issues: ["Unknown code XX-999"] })], unknown_codes: ["XX999"] }, i.sales);
  // A register draft against a running job on Press 9.
  const press = await f.press({ name: "Press 9" });
  await f.job({ machine: press, plannedIn: 0, status: "in_progress" });
  const reg = await f.call("ap_register", "create", { machine_id: press, shift_day: istDay(0), storage_path: `${i.company}/register-photos/${press}/sheet.png`, file_name: "sheet.png", mime_type: "image/png", file_sha256: "a".repeat(64) }, i.production);
  // Bundle weights and an arriving batch for a waiting order.
  await f.seed("insert into section_weight_settings(company_id,tolerance_percent,window_bundles,min_bundles,updated_by) values($1,2,10,3,$2) on conflict (company_id) do update set tolerance_percent=2", [i.company, i.owner]);
  const heavy = await f.preparedBundle({ gross: 130, tare: 6, length: 120 });
  await f.call("ap_scale", "record", { bundle_id: heavy, source: "manual" }, i.dispatchUser);
  await f.order({ kg: 285, pieces: 50, length: 6 });
  const batch = await f.stock({ pieces: 50, qc: "on_hold" });
  await f.raw("update profile_stock_batches set qc_status='released', qc_released_at=now() where id=$1", [batch]);
  return { card: card.card.id, sale: sale.id, invoice: inv.invoice, enquiry: enquiry.id, register: reg.id, regPath: `${i.company}/register-photos/${press}/sheet.png` };
});
// A small register photo (1x1 PNG) so the register record shows its image.
fx.storage[`documents/${data.regPath}`] = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [u("rate-cards", i.sales), u("rate-card", i.sales, `&id=${data.card}`), u("scrap", i.inventory), u("scrap-sale", i.accounts, `&id=${data.sale}&money=true`),
  u("weight", i.accounts, `&invoice=${data.invoice}&decide=true`), u("cash", i.accounts), u("enquiries", i.sales), u("enquiry", i.owner, `&id=${data.enquiry}`), u("registers", i.productionManager, `&today=${istDay(0)}`),
  u("register", i.productionManager, `&id=${data.register}`), u("scale", i.dispatchUser), u("arrivals", i.inventory, `&today=${istDay(0)}`), u("geometry", i.owner, `&profile=${i.profile2}&today=${istDay(0)}`),
  u("workstation", i.production, `&today=${istDay(0)}&lang=hi`), u("scale", i.dispatchUser, "&lang=hi")], today: istDay() }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
