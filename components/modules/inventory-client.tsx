"use client";

import { Badge, MasterDataManager } from "./master-data-manager";
import { inventoryItemSchema } from "@/lib/validations/schemas";
import { inventoryCategories, labelize, type SessionContext } from "@/types/app";

export function InventoryClient({ context }: { context: SessionContext }) {
  return (
    <MasterDataManager
      title="Inventory Items"
      description="Manage raw materials, billets, finished goods, scrap, and consumables."
      table="inventory_items"
      select="*"
      context={context}
      schema={inventoryItemSchema}
      searchPlaceholder="Search item name, code, category..."
      defaultValues={{ item_code: "", item_name: "", item_category: "billets", unit: "kg", reorder_level: 0, location: "", is_active: true }}
      fields={[
        { name: "item_code", label: "Item Code", required: true },
        { name: "item_name", label: "Item Name", required: true },
        { name: "item_category", label: "Category", type: "select", options: inventoryCategories.map(c => ({ value: c, label: labelize(c) })) },
        { name: "unit", label: "Unit (e.g., kg, pcs, ltr)", required: true },
        { name: "reorder_level", label: "Reorder Level", type: "number" },
        { name: "location", label: "Location / Rack" },
        { name: "is_active", label: "Active", type: "checkbox" }
      ]}
      columns={[
        { label: "Code", value: (row) => row.item_code },
        { label: "Name", value: (row) => row.item_name },
        { label: "Category", value: (row) => <Badge value={row.item_category} /> },
        { label: "Unit", value: (row) => row.unit },
        { label: "Stock", value: (row) => row.current_stock?.toString() || "0" },
        { label: "Status", value: (row) => <Badge value={row.is_active ? "active" : "inactive"} /> }
      ]}
      canDelete={context.role === "owner" || context.role === "admin"}
    />
  );
}
