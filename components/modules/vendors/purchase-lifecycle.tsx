"use client";

import { useState } from "react";
import Link from "next/link";
import {
  extractSupplierDocumentAction,
  purchaseLifecycleAction
} from "@/lib/actions/purchase-lifecycle";
import {
  supplierBillReviewSchema,
  purchaseReceiptBalances,
  type PurchaseLifecycleInput,
  type PurchaseLifecycleResult,
  type SupplierDocumentProposal
} from "@/lib/workflow/purchase-lifecycle";

type Dashboard = Extract<PurchaseLifecycleResult, { kind: "dashboard" }>;
type DocumentState = {
  id: string;
  source_hash: string;
  source_name: string;
  proposal: SupplierDocumentProposal;
  uncertain_fields: string[];
  review_revision: number;
  review_hash: string | null;
  reviewed_payload: Record<string, unknown> | null;
};
type BillLineDraft = {
  purchase_order_line_id: string;
  quantity: string;
  unit: string;
  rate: string;
  base_amount: string;
  tax_amount: string;
};
type PurchaseUnit = "kg" | "m" | "piece" | "set" | "box" | "lot";
type OrderLineDraft = { description: string; specification: string; unit: PurchaseUnit; quantity: string; rate: string; gst: string };
type CurrentBill = {
  id: string;
  status: "draft" | "posted";
  match_status: "unmatched" | "matched";
  match_snapshot: Extract<PurchaseLifecycleResult, { kind: "bill_created" }>['match_snapshot'];
  source_hash: string;
  review_revision: number;
  review_hash: string;
};
type OrderView = Extract<PurchaseLifecycleResult, { kind: "order_loaded" }>['order'];
type BillView = Extract<PurchaseLifecycleResult, { kind: "bill_loaded" }>['bill'];
type PurchaseSelection = Extract<PurchaseLifecycleResult, { kind: "order_loaded" | "bill_loaded" }>;
type WorkspaceView = "overview" | "new-order" | "order-detail" | "receipt" | "bill-review";
type PendingMutation =
  | { kind: "command"; input: PurchaseLifecycleInput; afterSuccess?: (result: PurchaseLifecycleResult) => Promise<void> | void }
  | { kind: "extract"; input: { fileName: string; text: string } };
type ExtractedDocument = Extract<Awaited<ReturnType<typeof extractSupplierDocumentAction>>, { success: true }>['data'];

function kolkataToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const emptyLine = (): BillLineDraft => ({ purchase_order_line_id: "", quantity: "", unit: "", rate: "", base_amount: "", tax_amount: "" });
const money = (value: string) => Number(value || 0);
const READ_COMMANDS = new Set(["dashboard.load", "orders.list", "bills.list", "order.load", "bill.load", "document.load"]);

function ReceiptBalances({ line }: { line: OrderView["lines"][number] }) {
  const balance = purchaseReceiptBalances(line);
  return <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
    <p>Still to arrive: {balance.remaining_delivery} {line.unit}; still to accept: {balance.remaining_acceptance} {line.unit}.</p>
    <p className="mt-1">Received base value: INR {balance.received_base_value.toFixed(2)}; accepted base value: INR {balance.accepted_base_value.toFixed(2)}.</p>
    <p className="mt-1 text-xs text-slate-500">At the agreed PO rate, before GST, freight and discount. Rejected and held portions remain unaccepted. No inventory is posted.</p>
  </div>;
}

export function PurchaseLifecycle({
  initialData,
  initialError,
  role,
  initialSelection = null
}: {
  initialData: Dashboard | null;
  initialError: string | null;
  role: string;
  initialSelection?: PurchaseSelection | null;
}) {
  const canManage = ["owner", "admin", "accounts"].includes(role);
  const canReceive = ["owner", "admin", "inventory_manager"].includes(role);
  const [dashboard, setDashboard] = useState<Dashboard | null>(initialData);
  const [notice, setNotice] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);
  const [uncertainRequest, setUncertainRequest] = useState<PendingMutation | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceView>(() => initialSelection?.kind === "order_loaded" ? "order-detail" : initialSelection?.kind === "bill_loaded" ? "bill-review" : "overview");
  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(() => initialSelection?.kind === "order_loaded" ? initialSelection.order : initialSelection?.kind === "bill_loaded" ? initialSelection.bill.order : null);
  const [orderVendor, setOrderVendor] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedFreight, setExpectedFreight] = useState("0");
  const [expectedDiscount, setExpectedDiscount] = useState("0");
  const [orderLines, setOrderLines] = useState<OrderLineDraft[]>([{ description: "", specification: "", unit: "kg", quantity: "", rate: "", gst: "18" }]);
  const [receiptOrderId, setReceiptOrderId] = useState("");
  const [receiptLineId, setReceiptLineId] = useState("");
  const [receiptDate, setReceiptDate] = useState(kolkataToday());
  const [receiptReference, setReceiptReference] = useState("");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [acceptedQuantity, setAcceptedQuantity] = useState("");
  const [rejectedQuantity, setRejectedQuantity] = useState("0");
  const [heldQuantity, setHeldQuantity] = useState("0");
  const [receiptNote, setReceiptNote] = useState("");
  const [source, setSource] = useState<DocumentState | null>(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.source : null);
  const [vendorId, setVendorId] = useState(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.vendor_id : "");
  const [purchaseOrderId, setPurchaseOrderId] = useState(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.purchase_order_id : "");
  const [invoiceNumber, setInvoiceNumber] = useState(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.invoice_number : "");
  const [invoiceDate, setInvoiceDate] = useState(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.invoice_date : "");
  const [dueDate, setDueDate] = useState(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.due_date ?? "" : "");
  const [billTax, setBillTax] = useState(() => initialSelection?.kind === "bill_loaded" ? String(initialSelection.bill.tax_amount) : "");
  const [billFreight, setBillFreight] = useState(() => initialSelection?.kind === "bill_loaded" ? String(initialSelection.bill.freight_amount) : "0");
  const [billDiscount, setBillDiscount] = useState(() => initialSelection?.kind === "bill_loaded" ? String(initialSelection.bill.discount_amount) : "0");
  const [billTotal, setBillTotal] = useState(() => initialSelection?.kind === "bill_loaded" ? String(initialSelection.bill.total_amount) : "");
  const [billLines, setBillLines] = useState<BillLineDraft[]>(() => initialSelection?.kind === "bill_loaded" ? initialSelection.bill.lines.map((line) => ({
    purchase_order_line_id: line.purchase_order_line_id, quantity: String(line.quantity), unit: line.unit,
    rate: String(line.rate), base_amount: String(line.base_amount), tax_amount: String(line.tax_amount)
  })) : [emptyLine()]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [billDirty, setBillDirty] = useState(false);
  const [currentBill, setCurrentBill] = useState<CurrentBill | null>(() => initialSelection?.kind === "bill_loaded" ? {
    id: initialSelection.bill.id, status: initialSelection.bill.status, match_status: initialSelection.bill.match_status,
    match_snapshot: initialSelection.bill.match_snapshot, source_hash: initialSelection.bill.source_hash,
    review_revision: initialSelection.bill.review_revision, review_hash: initialSelection.bill.review_hash
  } : null);

  async function send(input: PurchaseLifecycleInput, afterSuccess?: (result: PurchaseLifecycleResult) => Promise<void> | void, retrying = false) {
    setBusy(true);
    try {
      const result = await purchaseLifecycleAction(input);
      if (!result.success) {
        if (result.uncertain && !READ_COMMANDS.has(input.command)) setUncertainRequest({ kind: "command", input, afterSuccess });
        else if (retrying) setUncertainRequest(null);
        setNotice(retrying ? `The exact request is still unconfirmed. ${result.error}` : result.error);
        return null;
      }
      if (input.command !== "dashboard.load" && input.command !== "orders.list" && input.command !== "bills.list" && input.command !== "order.load" && input.command !== "bill.load") setNotice("");
      if (retrying) setUncertainRequest(null);
      return result.data;
    } catch (error) {
      if (!READ_COMMANDS.has(input.command)) {
        setUncertainRequest({ kind: "command", input, afterSuccess });
        setNotice(`The ${input.command} response was lost, so its outcome is uncertain. Retry the exact saved request before editing or submitting anything else.`);
      } else {
        setNotice(error instanceof Error ? error.message : "Could not load purchasing records.");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const result = await send({ command: "dashboard.load", payload: {} });
    if (result?.kind === "dashboard") setDashboard(result);
  }

  async function createOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: PurchaseLifecycleInput = {
      command: "order.create",
      payload: {
        idempotency_key: crypto.randomUUID(),
        vendor_id: orderVendor,
        order_date: orderDate,
        expected_freight_amount: money(expectedFreight),
        expected_discount_amount: money(expectedDiscount),
        lines: orderLines.map((line) => ({
          description: line.description,
          specification: line.specification,
          unit: line.unit,
          quantity: money(line.quantity),
          rate: money(line.rate),
          gst_percent: money(line.gst),
          rate_tolerance: 0.01,
          tax_tolerance: 0.01
        }))
      }
    };
    const completed = async (result: PurchaseLifecycleResult) => {
      if (result.kind !== "order_created") return;
      setNotice(`Purchase order ${result.po_number} was saved as a draft. Issue it before receiving material.`);
      setOrderLines([{ description: "", specification: "", unit: "kg", quantity: "", rate: "", gst: "18" }]);
      setWorkspace("overview");
      await reload();
    };
    const result = await send(input, completed);
    if (result) await completed(result);
  }

  async function issueOrder(id: string) {
    const input: PurchaseLifecycleInput = { command: "order.issue", payload: { purchase_order_id: id } };
    const completed = async (result: PurchaseLifecycleResult) => {
      if (result.kind === "order_issued") await reload();
    };
    const result = await send(input, completed);
    if (result) await completed(result);
  }

  function openReceipt(orderId: string, lineId: string, suggestedUnit: string) {
    const selected = dashboard?.orders.find((row) => row.id === orderId) ?? (selectedOrder?.id === orderId ? selectedOrder : null);
    if (selected?.lines) setSelectedOrder({ ...selected, lines: selected.lines });
    setReceiptOrderId(orderId);
    setReceiptLineId(lineId);
    setReceiptNote("");
    setReceiptReference("");
    setReceivedQuantity("");
    setAcceptedQuantity("");
    setRejectedQuantity("0");
    setHeldQuantity("0");
    setWorkspace("receipt");
    setNotice(`Record actual received, accepted, rejected, and held ${suggestedUnit} for this PO line.`);
  }

  async function recordReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiptOrderId || !receiptLineId) return;
    const input: PurchaseLifecycleInput = {
      command: "receipt.record",
      payload: {
        idempotency_key: crypto.randomUUID(), purchase_order_id: receiptOrderId,
        receipt_date: receiptDate, reference: receiptReference,
        lines: [{
          purchase_order_line_id: receiptLineId,
          received_quantity: money(receivedQuantity), accepted_quantity: money(acceptedQuantity),
          rejected_quantity: money(rejectedQuantity), held_quantity: money(heldQuantity), note: receiptNote
        }]
      }
    };
    const completed = async (result: PurchaseLifecycleResult) => {
      if (result.kind !== "receipt_recorded") return;
      setReceiptOrderId("");
      setNotice("Receipt saved. Accepted quantities are available for invoice matching; no stock has been posted.");
      await reload();
      if (selectedOrder) await openOrder(selectedOrder.id, "order-detail", false);
      setWorkspace("overview");
    };
    const result = await send(input, completed);
    if (result) await completed(result);
  }

  function applyProposal(proposal: SupplierDocumentProposal) {
    setInvoiceNumber(proposal.invoice_number ?? "");
    setInvoiceDate(proposal.invoice_date ?? "");
    setDueDate("");
    setBillTax(proposal.tax_amount == null ? "" : String(proposal.tax_amount));
    setBillFreight(proposal.freight_amount == null ? "" : String(proposal.freight_amount));
    setBillDiscount(proposal.discount_amount == null ? "" : String(proposal.discount_amount));
    setBillTotal(proposal.total_amount == null ? "" : String(proposal.total_amount));
    const proposedLines = proposal.lines.map((line) => ({
      ...emptyLine(), quantity: line.quantity == null ? "" : String(line.quantity), unit: line.unit ?? "",
      rate: line.rate == null ? "" : String(line.rate), base_amount: line.base_amount == null ? "" : String(line.base_amount),
      tax_amount: line.tax_amount == null ? "" : String(line.tax_amount)
    }));
    setBillLines(proposedLines.length ? proposedLines : [emptyLine()]);
    setReviewConfirmed(false);
    setCurrentBill(null);
    setBillDirty(false);
  }

  function applyExtractedDocument(data: ExtractedDocument) {
    const nextSource: DocumentState = {
      id: data.source_id, source_hash: data.source_hash, source_name: data.source_name,
      proposal: data.proposal, uncertain_fields: data.uncertain_fields, review_revision: data.review_revision,
      review_hash: data.review_hash, reviewed_payload: data.reviewed_payload
    };
    setSource(nextSource);
    applyProposal(data.proposal);
    setVendorId("");
    setPurchaseOrderId("");
    if (data.reviewed_payload) {
      const previous = data.reviewed_payload;
      setVendorId(String(previous.vendor_id ?? ""));
      setPurchaseOrderId(String(previous.purchase_order_id ?? ""));
      setInvoiceNumber(String(previous.invoice_number ?? ""));
      setInvoiceDate(String(previous.invoice_date ?? ""));
      setDueDate(String(previous.due_date ?? ""));
      setBillTax(String(previous.tax_amount ?? ""));
      setBillFreight(String(previous.freight_amount ?? ""));
      setBillDiscount(String(previous.discount_amount ?? ""));
      setBillTotal(String(previous.total_amount ?? ""));
      const priorLines = Array.isArray(previous.lines) ? previous.lines as Array<Record<string, unknown>> : [];
      setBillLines(priorLines.map((line) => ({
        purchase_order_line_id: String(line.purchase_order_line_id ?? ""), quantity: String(line.quantity ?? ""),
        unit: String(line.unit ?? ""), rate: String(line.rate ?? ""), base_amount: String(line.base_amount ?? ""), tax_amount: String(line.tax_amount ?? "")
      })));
    }
    setWorkspace("bill-review");
    setNotice(`Text saved as ${data.source_name}. Check every suggested value against the source before saving the bill.`);
  }

  async function extractDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    let input: { fileName: string; text: string } | null = null;
    try {
      input = { fileName: file.name, text: await file.text() };
      const result = await extractSupplierDocumentAction(input);
      if (!result.success) {
        if (result.uncertain) setUncertainRequest({ kind: "extract", input });
        setNotice(result.error); return;
      }
      setUncertainRequest(null);
      applyExtractedDocument(result.data);
    } catch (error) {
      if (!input) {
        setNotice(error instanceof Error ? error.message : "Could not read the supplier text file.");
        return;
      }
      setUncertainRequest({ kind: "extract", input });
      setNotice("The supplier document response was lost, so its outcome is uncertain. Retry the exact saved upload before editing or submitting anything else.");
    } finally {
      setBusy(false);
    }
  }

  function selectOrder(id: string) {
    setPurchaseOrderId(id);
    const order = dashboard?.orders.find((row) => row.id === id) ?? (selectedOrder?.id === id ? selectedOrder : null);
    if (!order) return;
    if (order.lines) setSelectedOrder({ ...order, lines: order.lines });
    const firstLine = order.lines?.[0];
    setBillLines((previous) => previous.map((line, index) => ({
      ...line,
      purchase_order_line_id: order.lines?.find((candidate) => candidate.description.toLowerCase() === (source?.proposal.lines[index]?.description ?? "").toLowerCase())?.id
        ?? (order.lines?.length === 1 ? order.lines[0].id : line.purchase_order_line_id || firstLine?.id || "")
    })));
  }

  async function openOrder(id: string, view: WorkspaceView = "order-detail", showNotice = true) {
    const result = await send({ command: "order.load", payload: { purchase_order_id: id } });
    if (result?.kind !== "order_loaded") return;
    setSelectedOrder(result.order);
    setWorkspace(view);
    if (showNotice) setNotice(`${result.order.po_number} opened with its full line and receiving history.`);
  }

  function applyLoadedBill(bill: BillView) {
    setSelectedOrder(bill.order);
    setSource(bill.source);
    setVendorId(bill.vendor_id);
    setPurchaseOrderId(bill.purchase_order_id);
    setInvoiceNumber(bill.invoice_number);
    setInvoiceDate(bill.invoice_date);
    setDueDate(bill.due_date ?? "");
    setBillTax(String(bill.tax_amount));
    setBillFreight(String(bill.freight_amount));
    setBillDiscount(String(bill.discount_amount));
    setBillTotal(String(bill.total_amount));
    setBillLines(bill.lines.map((line) => ({
      purchase_order_line_id: line.purchase_order_line_id, quantity: String(line.quantity), unit: line.unit,
      rate: String(line.rate), base_amount: String(line.base_amount), tax_amount: String(line.tax_amount)
    })));
    setCurrentBill({
      id: bill.id, status: bill.status, match_status: bill.match_status, match_snapshot: bill.match_snapshot,
      source_hash: bill.source_hash, review_revision: bill.review_revision, review_hash: bill.review_hash
    });
    setReviewConfirmed(false);
    setBillDirty(false);
    setWorkspace("bill-review");
    setNotice(`Invoice ${bill.invoice_number} was reopened with its reviewed source, saved lines, and current receipt match.`);
  }

  async function openBill(id: string) {
    const result = await send({ command: "bill.load", payload: { bill_id: id } });
    if (result?.kind === "bill_loaded") applyLoadedBill(result.bill);
  }

  async function retryExactRequest() {
    const pending = uncertainRequest;
    if (!pending) return;
    if (pending.kind === "command") {
      const result = await send(pending.input, pending.afterSuccess, true);
      if (!result) return;
      if (pending.afterSuccess) await pending.afterSuccess(result);
      else await reload();
      return;
    }

    setBusy(true);
    try {
      const result = await extractSupplierDocumentAction(pending.input);
      if (!result.success) {
        setNotice(`The exact upload is still unconfirmed. ${result.error}`);
        if (!result.uncertain) setUncertainRequest(null);
        return;
      }
      setUncertainRequest(null);
      applyExtractedDocument(result.data);
    } catch (error) {
      setNotice(`The exact upload is still unconfirmed. ${error instanceof Error ? error.message : "Retry failed."}`);
    } finally {
      setBusy(false);
    }
  }

  function prepareReview() {
    const payload = {
      vendor_id: vendorId,
      purchase_order_id: purchaseOrderId,
      invoice_number: invoiceNumber.trim(),
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      tax_amount: money(billTax),
      freight_amount: money(billFreight),
      discount_amount: money(billDiscount),
      total_amount: money(billTotal),
      lines: billLines.map((line) => ({
        purchase_order_line_id: line.purchase_order_line_id,
        quantity: money(line.quantity), unit: line.unit, rate: money(line.rate),
        base_amount: money(line.base_amount), tax_amount: money(line.tax_amount)
      }))
    };
    return supplierBillReviewSchema.safeParse(payload);
  }

  async function saveReviewedBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || !reviewConfirmed) return;
    const reviewed = prepareReview();
    if (!reviewed.success) { setNotice(reviewed.error.issues[0]?.message ?? "Check the reviewed bill values."); return; }
    const sourceAtSubmit = source;
    const reviewedPayload = reviewed.data;
    const createBill = async (nextSource: DocumentState) => {
      const input: PurchaseLifecycleInput = { command: "bill.create", payload: {
        source_id: nextSource.id, source_hash: nextSource.source_hash, review_revision: nextSource.review_revision, review_hash: nextSource.review_hash ?? ""
      } };
      const completed = async (result: PurchaseLifecycleResult) => {
        if (result.kind !== "bill_created") return;
        setCurrentBill({ id: result.id, status: result.status, match_status: result.match_status,
          match_snapshot: result.match_snapshot, source_hash: nextSource.source_hash, review_revision: nextSource.review_revision,
          review_hash: nextSource.review_hash ?? "" });
        setNotice(result.match_status === "matched"
          ? "The reviewed invoice matches this purchase order and accepted receipts. Posting will create a pending expense for finance approval."
          : "The reviewed invoice is saved as an unmatched draft. Resolve every exception before it can be posted.");
        setReviewConfirmed(false);
        setBillDirty(false);
        setWorkspace("bill-review");
        await reload();
      };
      const created = await send(input, completed);
      if (created) await completed(created);
    };
    const continueReview = async (result: PurchaseLifecycleResult) => {
      if (result.kind !== "document_reviewed") return;
      const nextSource = { ...sourceAtSubmit, review_revision: result.review_revision, review_hash: result.review_hash, reviewed_payload: reviewedPayload };
      setSource(nextSource);
      await createBill(nextSource);
    };
    const reviewInput: PurchaseLifecycleInput = { command: "document.review", payload: {
      source_id: sourceAtSubmit.id, source_hash: sourceAtSubmit.source_hash,
      expected_revision: sourceAtSubmit.review_revision, reviewed: reviewedPayload
    } };
    const review = await send(reviewInput, continueReview);
    if (review) await continueReview(review);
  }

  async function rematchBill(id: string) {
    if (!currentBill || currentBill.id !== id || billDirty) return;
    const completed = async (result: PurchaseLifecycleResult) => {
      if (result.kind !== "bill_match") return;
      setCurrentBill((current) => current?.id === id ? { ...current, status: result.status, match_status: result.match_status, match_snapshot: result.match_snapshot } : current);
      setNotice(result.match_status === "matched" ? "Supplier bill now matches current accepted receipts." : "Supplier bill remains on hold until its exceptions are resolved.");
      await reload();
    };
    const result = await send({ command: "bill.match", payload: { bill_id: id } }, completed);
    if (result) await completed(result);
  }

  async function postBill() {
    if (!currentBill || billDirty || currentBill.status !== "draft" || currentBill.match_status !== "matched") return;
    const input: PurchaseLifecycleInput = { command: "bill.post", payload: {
      bill_id: currentBill.id, source_hash: currentBill.source_hash,
      review_revision: currentBill.review_revision, review_hash: currentBill.review_hash
    } };
    const completed = async (result: PurchaseLifecycleResult) => {
      if (result.kind !== "bill_posted") return;
      setCurrentBill((current) => current?.id === result.id ? { ...current, status: "posted" } : current);
      setNotice("Supplier bill posted to expenses as pending finance approval. Use the existing expense approval and supplier payment workflow.");
      await reload();
    };
    const result = await send(input, completed);
    if (result) await completed(result);
  }

  function renderMatch(match: CurrentBill["match_snapshot"]) {
    return <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Purchase order and receipt match result">
      <p className={`font-bold ${match.matched ? "text-emerald-700" : "text-amber-800"}`}>{match.matched ? "Matched" : "On hold"}</p>
      {match.exceptions.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{match.exceptions.map((exception) => <li key={exception}>{exception}</li>)}</ul> : null}
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <p>Expected freight: INR {match.expected.freight_amount.toFixed(2)}</p><p>Billed freight: INR {match.actual.freight_amount.toFixed(2)}</p>
        <p>Expected tax: INR {match.expected.tax_amount.toFixed(2)}</p><p>Billed tax: INR {match.actual.tax_amount.toFixed(2)}</p>
      </div>
      {match.lines.map((line, index) => <p className="mt-2 text-sm text-slate-700" key={`${line.description}-${index}`}>
        {line.description}: received accepted {line.accepted_received} {line.unit}, previously billed {line.previously_billed} {line.unit}, this bill {line.quantity} {line.unit}.
      </p>)}
    </div>;
  }

  const availableOrders = [...(dashboard?.orders ?? [])];
  if (selectedOrder && !availableOrders.some((order) => order.id === selectedOrder.id)) availableOrders.push(selectedOrder);
  const reviewVendors = [...(dashboard?.vendors ?? [])];
  if (selectedOrder && !reviewVendors.some(vendor => vendor.id === selectedOrder.vendor_id)) {
    reviewVendors.push({ id: selectedOrder.vendor_id, vendor_name: selectedOrder.vendor_name });
  }

  return <main className="space-y-8 pb-12">
    <header className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-7 text-white sm:px-8">
      <div className="pointer-events-none absolute -right-8 -top-14 h-48 w-48 rounded-full border-[28px] border-amber-400/20" />
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-300">Vendor operations / purchasing</p>
      <h1 className="mt-3 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">Purchase orders with a receiving trail</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Record what was ordered, what physically arrived, and what passed acceptance. A supplier bill only reaches expenses after its reviewed source and accepted quantities match.</p>
      <p className="mt-3 text-xs text-slate-400">Accepted receipt quantities support matching only. This workflow does not post stock or payment entries.</p>
    </header>

    {notice ? <p role="status" aria-live="polite" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">{notice}</p> : null}
    {!dashboard ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{initialError ?? "Purchasing records are unavailable."}</div> : null}
    {uncertainRequest ? <section role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p>The exact request is retained. Editing is paused until its outcome is confirmed.</p>
      <button type="button" onClick={retryExactRequest} disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2.5 font-extrabold text-slate-950 disabled:opacity-50">{busy ? "Retrying exact request..." : "Retry exact request"}</button>
    </section> : null}

    <fieldset disabled={busy || !!uncertainRequest} className="contents">
    <nav aria-label="Purchasing workspace" className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <button type="button" onClick={() => setWorkspace("overview")} aria-current={workspace === "overview" ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-bold ${workspace === "overview" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}>Overview</button>
      {canManage ? <button type="button" onClick={() => setWorkspace("new-order")} aria-current={workspace === "new-order" ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-bold ${workspace === "new-order" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}>New purchase order</button> : null}
      {canManage ? <button type="button" onClick={() => setWorkspace("bill-review")} aria-current={workspace === "bill-review" ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-bold ${workspace === "bill-review" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}>Review supplier bill</button> : null}
      {!uncertainRequest ? <Link href="/vendors/purchasing/database" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">Full purchasing database</Link> : null}
    </nav>

    {workspace === "new-order" && canManage ? <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
      <form onSubmit={createOrder} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">New purchase</p><h2 className="mt-1 text-2xl font-extrabold text-slate-950">Draft a purchase order</h2></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">Supplier<select required value={orderVendor} onChange={(event) => setOrderVendor(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"><option value="">Choose a supplier</option>{dashboard?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_name}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">Order date<input required type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
        </div>
        <div className="space-y-3">
          {orderLines.map((line, index) => <fieldset key={index} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-6">
            <legend className="px-1 text-sm font-bold text-slate-800">Line {index + 1}</legend>
            <label className="text-xs font-semibold text-slate-600 sm:col-span-3">Material / service<input required value={line.description} onChange={(event) => setOrderLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-600 sm:col-span-3">Specification<input required value={line.specification} onChange={(event) => setOrderLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, specification: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-600">Unit<select value={line.unit} onChange={(event) => setOrderLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value as PurchaseUnit } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{["kg", "m", "piece", "set", "box", "lot"].map((unit) => <option key={unit}>{unit}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Ordered qty<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => setOrderLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-600">Rate INR / unit<input required min="0" step="0.01" type="number" value={line.rate} onChange={(event) => setOrderLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-600">GST %<input required min="0" max="100" step="0.01" type="number" value={line.gst} onChange={(event) => setOrderLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, gst: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <div className="flex items-end"><button type="button" disabled={orderLines.length === 1} onClick={() => setOrderLines((old) => old.filter((_, rowIndex) => rowIndex !== index))} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500 underline disabled:opacity-40">Remove line</button></div>
          </fieldset>)}
          <button type="button" disabled={orderLines.length >= 100} onClick={() => setOrderLines((old) => [...old, { description: "", specification: "", unit: "kg", quantity: "", rate: "", gst: "18" }])} className="text-sm font-bold text-slate-700 underline">Add another PO line</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">Expected total freight (INR)<input min="0" step="0.01" type="number" value={expectedFreight} onChange={(event) => setExpectedFreight(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <label className="text-sm font-semibold text-slate-700">Expected total discount (INR)<input min="0" step="0.01" type="number" value={expectedDiscount} onChange={(event) => setExpectedDiscount(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
        </div>
        <button disabled={busy || !dashboard?.vendors.length} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Saving..." : "Save draft purchase order"}</button>
      </form>
      <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-800">Matching policy</p>
        <h2 className="mt-1 text-xl font-extrabold text-slate-950">Differences stay visible</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">Line quantities must be covered by accepted receipts. Rates, GST, freight, discount, and the invoice total are compared to the issued purchase order using its stored tolerances.</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">Only an owner or admin can approve tolerance above INR 0.01 when the PO is created. An unmatched bill remains a draft and cannot enter the expense ledger.</p>
      </aside>
    </section> : null}

    {workspace === "overview" ? <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Open work / latest 10</p><h2 className="mt-1 text-2xl font-extrabold text-slate-950">Purchase orders</h2></div><button type="button" onClick={reload} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">Refresh</button></div>
      {!dashboard?.orders.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">No purchase orders have been recorded yet.</p> : <div className="grid gap-4 lg:grid-cols-2">{dashboard.orders.map((order) => <article key={order.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{order.po_number} / {order.order_date}</p><h3 className="mt-1 text-lg font-extrabold text-slate-950">{order.vendor_name}</h3></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${order.status === "open" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{order.status}</span></div>
        <div className="mt-4 space-y-3">{order.lines?.map((line) => <div key={line.id} className="rounded-2xl bg-slate-50 p-4">
          <p className="font-bold text-slate-900">{line.description}</p><p className="mt-1 text-xs text-slate-600">{line.specification}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-3">
            <span>Ordered: {line.ordered_quantity} {line.unit}</span><span>Received: {line.received_quantity} {line.unit}</span><span>Accepted: {line.accepted_quantity} {line.unit}</span>
            <span>Rejected: {line.rejected_quantity} {line.unit}</span><span>Held: {line.held_quantity} {line.unit}</span><span>Billed: {line.billed_quantity} {line.unit}</span>
          </div>
          {canReceive && order.status === "open" ? <button type="button" onClick={() => openReceipt(order.id, line.id, line.unit)} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">Record this receipt</button> : null}
        </div>)}</div>
        <button type="button" onClick={() => openOrder(order.id)} className="mt-4 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">Open full PO</button>
        {canManage && order.status === "draft" ? <button type="button" onClick={() => issueOrder(order.id)} disabled={busy} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Issue PO for receiving</button> : null}
      </article>)}</div>}
    </section> : null}

    {workspace === "order-detail" && selectedOrder ? <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Purchase order / {selectedOrder.status}</p>
      <h2 className="mt-1 text-2xl font-extrabold text-slate-950">{selectedOrder.po_number}</h2>
      <p className="mt-1 text-sm text-slate-600">{selectedOrder.vendor_name} / ordered {selectedOrder.order_date}</p>
      <div className="mt-5 space-y-3">{selectedOrder.lines.map((line) => <article key={line.id} className="rounded-2xl bg-slate-50 p-4">
        <h3 className="font-bold text-slate-950">{line.description}</h3><p className="mt-1 text-xs text-slate-600">{line.specification}</p>
        <p className="mt-3 text-sm text-slate-700">Ordered {line.ordered_quantity} {line.unit}; received {line.received_quantity}; accepted {line.accepted_quantity}; rejected {line.rejected_quantity}; held {line.held_quantity}; billed {line.billed_quantity}.</p>
        <ReceiptBalances line={line} />
        {canReceive && selectedOrder.status === "open" ? <button type="button" onClick={() => openReceipt(selectedOrder.id, line.id, line.unit)} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">Record this receipt</button> : null}
      </article>)}</div>
      {canManage && selectedOrder.status === "draft" ? <button type="button" onClick={() => issueOrder(selectedOrder.id)} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Issue PO for receiving</button> : null}
      <button type="button" onClick={() => setWorkspace("overview")} className="mt-4 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">Back to overview</button>
    </section> : null}

    {workspace === "receipt" && canReceive && receiptOrderId ? <form onSubmit={recordReceipt} className="rounded-3xl border border-cyan-200 bg-cyan-50 p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-900">Stores receipt / {selectedOrder?.po_number ?? receiptOrderId}</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Record actual disposition</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold text-slate-700">Receipt date<input required type="date" max={kolkataToday()} value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
        <label className="text-sm font-semibold text-slate-700">GRN / weighment reference<input value={receiptReference} onChange={(event) => setReceiptReference(event.target.value)} maxLength={120} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
        <label className="text-sm font-semibold text-slate-700">Actual received<input required type="number" min="0.001" step="0.001" value={receivedQuantity} onChange={(event) => setReceivedQuantity(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
        <label className="text-sm font-semibold text-slate-700">Accepted<input required type="number" min="0" step="0.001" value={acceptedQuantity} onChange={(event) => setAcceptedQuantity(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
        <label className="text-sm font-semibold text-slate-700">Rejected<input required type="number" min="0" step="0.001" value={rejectedQuantity} onChange={(event) => setRejectedQuantity(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
        <label className="text-sm font-semibold text-slate-700">Held pending review<input required type="number" min="0" step="0.001" value={heldQuantity} onChange={(event) => setHeldQuantity(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Stores note<input value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} maxLength={1000} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
      </div>
      <div className="mt-4 flex gap-3"><button disabled={busy} className="rounded-xl bg-cyan-950 px-4 py-2.5 text-sm font-bold text-white">{busy ? "Recording..." : "Save receipt"}</button><button type="button" onClick={() => { setReceiptOrderId(""); setWorkspace("overview"); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</button></div>
      <p className="mt-3 text-xs text-slate-600">Accepted + rejected + held must exactly equal actual received. Rejected and held quantities are never treated as accepted.</p>
    </form> : null}

    {workspace === "bill-review" ? <section className="grid gap-6 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
      <fieldset disabled={!canManage || currentBill?.status === "posted"} className="contents">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Supplier document</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Extract text for review</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">Upload a real text or CSV invoice. Extraction proposes values only. Missing and conflicting fields are flagged, and every bill field still requires review against the source.</p>
        <label className="mt-5 block text-sm font-bold text-slate-700">Invoice text or CSV<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={extractDocument} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-2 text-sm" /></label>
        {source ? <div className="mt-4 rounded-2xl bg-slate-50 p-4"><p className="font-bold text-slate-900">{source.source_name}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-500">SHA-256 {source.source_hash}</p>
          <p className="mt-3 text-xs font-bold text-amber-900">Review flags: {source.uncertain_fields.length ? source.uncertain_fields.join(", ") : "None"}</p>
          <p className="mt-2 text-xs text-slate-600">These fields are suggestions until a person reviews and confirms the exact uploaded source version.</p></div> : null}
      </div>
      <form onSubmit={saveReviewedBill} onChange={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") return;
        setBillDirty(true);
        setReviewConfirmed(false);
      }} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Three way match</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Review supplier bill</h2></div>
        {!source ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Choose a text or CSV source before creating a supplier bill.</p> : <>
          <div className="grid gap-4 sm:grid-cols-2">
<label className="text-sm font-semibold text-slate-700">Supplier<select required value={vendorId} onChange={(event) => { setVendorId(event.target.value); const match = availableOrders.find((order) => order.vendor_id === event.target.value && order.status === "open"); if (match) selectOrder(match.id); }} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"><option value="">Confirm supplier</option>{reviewVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_name}</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700">Open PO<select required value={purchaseOrderId} onChange={(event) => selectOrder(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"><option value="">Choose matching PO</option>{availableOrders.filter((order) => order.vendor_id === vendorId && order.status === "open").map((order) => <option key={order.id} value={order.id}>{order.po_number}</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700">Invoice number<input required value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} maxLength={120} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
            <label className="text-sm font-semibold text-slate-700">Invoice date<input required type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
            <label className="text-sm font-semibold text-slate-700">Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          </div>
          <div className="space-y-3">
            {billLines.map((line, index) => {
              const activeOrder = availableOrders.find((order) => order.id === purchaseOrderId);
              return <fieldset key={index} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
                <legend className="px-1 text-sm font-bold text-slate-800">Billed line {index + 1}</legend>
                <label className="text-xs font-semibold text-slate-600 sm:col-span-3">Matched PO line<select required value={line.purchase_order_line_id} onChange={(event) => setBillLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, purchase_order_line_id: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Choose a line</option>{activeOrder?.lines?.map((poLine) => <option key={poLine.id} value={poLine.id}>{poLine.description} / {poLine.specification} / {poLine.unit}</option>)}</select></label>
                <label className="text-xs font-semibold text-slate-600">Billed quantity<input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setBillLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <label className="text-xs font-semibold text-slate-600">Unit<select required value={line.unit} onChange={(event) => setBillLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Choose unit</option>{["kg", "m", "piece", "set", "box", "lot"].map((unit) => <option key={unit}>{unit}</option>)}</select></label>
                <label className="text-xs font-semibold text-slate-600">Billed rate<input required type="number" min="0" step="0.01" value={line.rate} onChange={(event) => setBillLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <label className="text-xs font-semibold text-slate-600">Base amount<input required type="number" min="0" step="0.01" value={line.base_amount} onChange={(event) => setBillLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, base_amount: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <label className="text-xs font-semibold text-slate-600">Line tax<input required type="number" min="0" step="0.01" value={line.tax_amount} onChange={(event) => setBillLines((old) => old.map((row, rowIndex) => rowIndex === index ? { ...row, tax_amount: event.target.value } : row))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <button type="button" disabled={billLines.length <= 1} onClick={() => setBillLines((old) => old.filter((_, rowIndex) => rowIndex !== index))} className="justify-self-start rounded-lg px-2 py-2 text-xs font-bold text-slate-500 underline disabled:opacity-40">Remove line</button>
              </fieldset>;
            })}
            <button type="button" disabled={billLines.length >= 100} onClick={() => setBillLines((old) => [...old, emptyLine()])} className="text-sm font-bold text-slate-700 underline">Add another invoice line</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-semibold text-slate-700">Tax total<input required type="number" min="0" step="0.01" value={billTax} onChange={(event) => setBillTax(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm font-semibold text-slate-700">Freight<input required type="number" min="0" step="0.01" value={billFreight} onChange={(event) => setBillFreight(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm font-semibold text-slate-700">Discount<input required type="number" min="0" step="0.01" value={billDiscount} onChange={(event) => setBillDiscount(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm font-semibold text-slate-700">Invoice total<input required type="number" min="0.01" step="0.01" value={billTotal} onChange={(event) => setBillTotal(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-slate-800"><input required type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="mt-1" /><span>I compared the supplier, invoice number/date, PO lines, quantities, rates, tax, freight, and total against this exact uploaded source.</span></label>
          <div className="flex flex-wrap gap-3"><button disabled={busy || !reviewConfirmed} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-extrabold text-slate-950 disabled:opacity-50">{busy ? "Checking..." : currentBill ? "Save correction and recheck" : "Save reviewed bill and match"}</button>
            {currentBill?.status === "draft" && !billDirty ? <button type="button" disabled={busy} onClick={() => rematchBill(currentBill.id)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Recheck current receipts</button> : null}
            {currentBill?.status === "draft" && !billDirty && currentBill.match_status === "matched" ? <button type="button" disabled={busy} onClick={postBill} className="rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white">Post to expenses</button> : null}</div>
          {billDirty && currentBill ? <p role="status" className="text-sm text-amber-800">Bill details changed. Save and review this version before matching or posting.</p> : null}
          {currentBill ? <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-bold text-slate-950">Bill {currentBill.status} / {currentBill.match_status}</p>{renderMatch(currentBill.match_snapshot)}</div> : null}
        </>}
      </form>
      </fieldset>
    </section> : null}

    {workspace === "overview" ? <section className="space-y-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Financial control</p><h2 className="mt-1 text-2xl font-extrabold text-slate-950">Supplier bills</h2><p className="mt-1 text-sm text-slate-600">Drafts show unresolved quantity, rate, tax, freight, or total differences. A posted bill links to the expense approval and payment workflow.</p></div>
      {!dashboard?.bills.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">No supplier bills have been recorded.</p> : <div className="grid gap-4 lg:grid-cols-2">{dashboard.bills.map((bill) => <article key={bill.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{bill.po_number} / {bill.invoice_date}</p><h3 className="mt-1 text-lg font-extrabold text-slate-950">{bill.vendor_name}</h3><p className="text-sm text-slate-700">Invoice {bill.invoice_number}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${bill.match_status === "matched" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{bill.status} / {bill.match_status}</span></div>
        <p className="mt-3 font-mono text-sm text-slate-700">INR {bill.total_amount.toFixed(2)}</p>
        {renderMatch(bill.match_snapshot)}
        <button type="button" onClick={() => openBill(bill.id)} className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">Open bill</button>
        {bill.expense_ledger_id ? <p className="mt-3 text-xs text-slate-600">Expense ledger entry {bill.expense_ledger_id} is pending finance approval.</p> : null}
      </article>)}</div>}
    </section> : null}
    </fieldset>
  </main>;
}
