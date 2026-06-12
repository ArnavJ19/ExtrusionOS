"use client";

import { Badge, MasterDataManager } from "./master-data-manager";
import { customerSchema } from "@/lib/validations/schemas";
import { customerTypes, labelize, type SessionContext } from "@/types/app";

export function CustomersClient({ context }: { context: SessionContext }) {
  return (
    <MasterDataManager
      title="Customers"
      description="Manage fabricators, dealers, architects, solar customers, and other extrusion buyers with GST and WhatsApp-ready contact details."
      table="customers"
      select="*"
      context={context}
      schema={customerSchema}
      searchPlaceholder="Search name, company, phone, GST..."
      defaultValues={{ customer_name: "", company_name: "", customer_type: "fabricator", phone: "", whatsapp_number: "", email: "", gst_number: "", billing_address: "", shipping_address: "", city: "", state: "", pincode: "", contact_person: "", payment_terms: "", notes: "", is_active: true }}
      fields={[
        { name: "customer_name", label: "Customer name", required: true },
        { name: "company_name", label: "Company name" },
        { name: "customer_type", label: "Customer type", type: "select", options: customerTypes.map((value) => ({ value, label: labelize(value) })) },
        { name: "contact_person", label: "Contact person" },
        { name: "phone", label: "Phone" },
        { name: "whatsapp_number", label: "WhatsApp number" },
        { name: "email", label: "Email" },
        { name: "gst_number", label: "GST number" },
        { name: "billing_address", label: "Billing address", type: "textarea" },
        { name: "shipping_address", label: "Shipping address", type: "textarea" },
        { name: "city", label: "City" },
        { name: "state", label: "State" },
        { name: "pincode", label: "Pincode" },
        { name: "payment_terms", label: "Payment terms" },
        { name: "notes", label: "Notes", type: "textarea" },
        { name: "is_active", label: "Active", type: "checkbox" }
      ]}
      columns={[
        { label: "Customer", value: (row) => row.customer_name },
        { label: "Company", value: (row) => row.company_name },
        { label: "Type", value: (row) => <Badge value={row.customer_type} /> },
        { label: "Phone", value: (row) => row.phone },
        { label: "GST", value: (row) => row.gst_number },
        { label: "City", value: (row) => row.city },
        { label: "Status", value: (row) => <Badge value={row.is_active ? "active" : "inactive"} /> }
      ]}
      canDelete={context.role === "owner" || context.role === "admin"}
    />
  );
}
