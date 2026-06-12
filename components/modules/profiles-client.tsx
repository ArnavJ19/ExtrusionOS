"use client";

import { Badge, MasterDataManager } from "./master-data-manager";
import { profileSchema } from "@/lib/validations/schemas";
import { applicationCategories, labelize, type SessionContext } from "@/types/app";
import { formatWeight } from "@/lib/utils/format";

export function ProfilesClient({ context }: { context: SessionContext }) {
  return (
    <MasterDataManager
      title="Aluminium Profiles"
      description="Maintain profile master data. Section weight in kg/m is critical for quotation accuracy."
      table="aluminium_profiles"
      select="*"
      context={context}
      schema={profileSchema}
      searchPlaceholder="Search code, profile name, category..."
      defaultValues={{ profile_code: "", profile_name: "", application_category: "sliding_window", section_weight_kg_per_m: "", alloy: "6063", temper: "T6", finish_options: "mill_finish, powder_coating, anodizing", standard_length_m: "5.8", drawing_url: "", image_url: "", notes: "", is_active: true }}
      fields={[
        { name: "profile_code", label: "Profile code", required: true },
        { name: "profile_name", label: "Profile name", required: true },
        { name: "application_category", label: "Application category", type: "select", options: applicationCategories.map((value) => ({ value, label: labelize(value) })) },
        { name: "section_weight_kg_per_m", label: "Section weight kg/m", type: "number", step: "0.001", required: true },
        { name: "alloy", label: "Alloy" },
        { name: "temper", label: "Temper" },
        { name: "finish_options", label: "Finish options (comma separated)" },
        { name: "standard_length_m", label: "Standard length (m)", type: "number", step: "0.01" },
        { name: "drawing_url", label: "Drawing URL" },
        { name: "image_url", label: "Image URL" },
        { name: "notes", label: "Notes", type: "textarea" },
        { name: "is_active", label: "Active", type: "checkbox" }
      ]}
      columns={[
        { label: "Code", value: (row) => row.profile_code },
        { label: "Profile", value: (row) => row.profile_name },
        { label: "Category", value: (row) => <Badge value={row.application_category} /> },
        { label: "Weight", value: (row) => formatWeight(row.section_weight_kg_per_m) },
        { label: "Alloy", value: (row) => row.alloy },
        { label: "Temper", value: (row) => row.temper },
        { label: "Std length", value: (row) => row.standard_length_m ? `${row.standard_length_m} m` : "-" },
        { label: "Status", value: (row) => <Badge value={row.is_active ? "active" : "inactive"} /> }
      ]}
      canDelete={context.role === "owner" || context.role === "admin"}
    />
  );
}
