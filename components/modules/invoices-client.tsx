"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, MasterDataManager } from "./master-data-manager";
import { invoiceSchema } from "@/lib/validations/schemas";
import { invoiceStatuses, labelize, type SessionContext } from "@/types/app";
import { createClient } from "@/lib/supabase/browser";

export function InvoicesClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [customers, setCustomers] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    supabase.from("customers").select("id, customer_name, company_name")
      .eq("company_id", context.companyId)
      .eq("is_active", true)
      .then(({ data }) => {
        if (data) setCustomers(data.map(c => ({ 
          value: c.id, 
          label: c.company_name ? `${c.customer_name} (${c.company_name})` : c.customer_name 
        })));
      });
  }, [supabase, context.companyId]);

  return (
    <MasterDataManager
      title="Invoices"
      description="Manage tax invoices, proformas, track payments, and view outstanding balances."
      table="invoices"
      select="*, customers(customer_name), balance_due"
      context={context}
      schema={invoiceSchema}
      searchPlaceholder="Search invoice number, customer..."
      defaultValues={{ invoice_date: new Date().toISOString().split('T')[0], status: "draft", subtotal: 0, tax_total: 0, grand_total: 0, amount_paid: 0 }}
      fields={[
        { name: "customer_id", label: "Customer", type: "select", options: customers, required: true },
        { name: "invoice_number", label: "Invoice Number" },
        { name: "invoice_date", label: "Invoice Date", type: "date", required: true },
        { name: "due_date", label: "Due Date", type: "date" },
        { name: "subtotal", label: "Subtotal (₹)", type: "number", required: true },
        { name: "tax_total", label: "Tax Amount (₹)", type: "number", required: true },
        { name: "grand_total", label: "Grand Total (₹)", type: "number", required: true },
        { name: "status", label: "Status", type: "select", options: invoiceStatuses.map(c => ({ value: c, label: labelize(c) })) }
      ]}
      columns={[
        { label: "Invoice No", value: (row) => row.invoice_number || <span className="text-neutral-500 italic">Draft</span> },
        { label: "Customer", value: (row) => row.customers?.customer_name || "Unknown" },
        { label: "Date", value: (row) => row.invoice_date },
        { label: "Total", value: (row) => `₹ ${row.grand_total.toLocaleString()}` },
        { label: "Balance", value: (row) => {
            const bal = row.balance_due ?? (row.grand_total - (row.amount_paid || 0));
            return bal > 0 ? <span className="text-orange">₹ {bal.toLocaleString()}</span> : <span className="text-emerald-500">₹ 0</span>;
        }},
        { label: "Status", value: (row) => <Badge value={row.status} /> }
      ]}
      canDelete={context.role === "owner" || context.role === "admin"}
    />
  );
}
