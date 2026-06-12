import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { dataExchangeJobSchema } from "@/lib/validations/schemas";
import { getErrorMessage } from "@/lib/utils/errors";

type ModuleConfig = {
  table: string;
  label: string;
  columns: string[];
  requiredForImport: string[];
};

const moduleConfigs: Record<string, ModuleConfig> = {
  customers: {
    table: "customers",
    label: "customers",
    columns: ["customer_name", "company_name", "customer_type", "phone", "whatsapp_number", "email", "gst_number", "city", "state", "pincode", "contact_person", "payment_terms", "notes", "is_active"],
    requiredForImport: ["customer_name"]
  },
  aluminium_profiles: {
    table: "aluminium_profiles",
    label: "profiles",
    columns: ["profile_code", "profile_name", "application_category", "section_weight_kg_per_m", "alloy", "temper", "standard_length_m", "notes", "is_active"],
    requiredForImport: ["profile_code", "profile_name", "section_weight_kg_per_m"]
  },
  vendors: {
    table: "vendors",
    label: "vendors",
    columns: ["vendor_name", "vendor_type", "contact_person", "phone", "email", "gst_number", "city", "state", "payment_terms", "notes", "is_active"],
    requiredForImport: ["vendor_name", "vendor_type"]
  },
  inventory_items: {
    table: "inventory_items",
    label: "inventory_items",
    columns: ["item_code", "item_name", "item_category", "unit", "current_stock", "reorder_level", "average_rate", "location", "is_active"],
    requiredForImport: ["item_code", "item_name", "item_category", "unit"]
  },
  branches: {
    table: "branches",
    label: "branches",
    columns: ["branch_name", "branch_type", "address", "city", "state", "pincode", "phone", "manager_name", "is_active"],
    requiredForImport: ["branch_name", "branch_type"]
  }
};

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "data_exchange")) {
      return NextResponse.json({ error: "You do not have permission to run data exchange jobs." }, { status: 403 });
    }

    const supabase = await createClient();
    const body = await request.json();
    const parsed = dataExchangeJobSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid data exchange request" }, { status: 400 });

    const config = moduleConfigs[parsed.data.module_name];
    if (!config) return NextResponse.json({ error: "Unsupported data exchange module" }, { status: 400 });

    const jobResult = await supabase.from("data_exchange_jobs").insert({
      company_id: context.companyId,
      job_type: parsed.data.job_type,
      module_name: parsed.data.module_name,
      status: "running",
      started_by: context.userId,
      started_at: new Date().toISOString()
    }).select().single();
    if (jobResult.error || !jobResult.data) return NextResponse.json({ error: getErrorMessage(jobResult.error, "Could not create data exchange job") }, { status: 500 });

    if (parsed.data.job_type === "export") {
      const result = await supabase.from(config.table as any).select(config.columns.join(",")).eq("company_id", context.companyId).order("created_at", { ascending: false });
      if (result.error) throw result.error;
      const csv = toCsv(config.columns, result.data ?? []);
      const completedJob = await completeJob(supabase, jobResult.data.id, context.companyId, { rows: result.data?.length ?? 0 });
      return NextResponse.json({ csv, filename: `${config.label}.csv`, job: completedJob, message: `Exported ${result.data?.length ?? 0} records` });
    }

    const csvText = String(body.csv ?? "").trim();
    if (!csvText) {
      const failedJob = await failJob(supabase, jobResult.data.id, context.companyId, "Paste CSV text before importing");
      return NextResponse.json({ error: "Paste CSV text before importing", job: failedJob }, { status: 400 });
    }
    const rows = parseCsv(csvText);
    const missingColumns = config.requiredForImport.filter((column) => !rows.headers.includes(column));
    if (missingColumns.length) {
      const message = `Missing required columns: ${missingColumns.join(", ")}`;
      const failedJob = await failJob(supabase, jobResult.data.id, context.companyId, message);
      return NextResponse.json({ error: message, job: failedJob }, { status: 400 });
    }

    const payload = rows.records.map((record) => sanitizeImportRecord(config, record, context.companyId));
    const insertResult = await supabase.from(config.table as any).insert(payload).select("id");
    if (insertResult.error) throw insertResult.error;
    const completedJob = await completeJob(supabase, jobResult.data.id, context.companyId, { rows: insertResult.data?.length ?? 0 });
    return NextResponse.json({ job: completedJob, message: `Imported ${insertResult.data?.length ?? 0} records` });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Data exchange failed") }, { status: 500 });
  }
}

async function completeJob(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string, companyId: string, result: Record<string, unknown>) {
  const { data } = await supabase.from("data_exchange_jobs").update({
    status: "completed",
    result_json: result,
    completed_at: new Date().toISOString()
  }).eq("id", jobId).eq("company_id", companyId).select().single();
  return data;
}

async function failJob(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string, companyId: string, errorMessage: string) {
  const { data } = await supabase.from("data_exchange_jobs").update({
    status: "failed",
    error_message: errorMessage,
    completed_at: new Date().toISOString()
  }).eq("id", jobId).eq("company_id", companyId).select().single();
  return data;
}

function toCsv(columns: string[], rows: Record<string, any>[]) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","));
  return [header, ...body].join("\n");
}

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(csv: string) {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = splitCsvLine(lines[0] ?? "").map((header) => header.trim());
  const records = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = values[index]?.trim() ?? "";
      return record;
    }, {});
  });
  return { headers, records };
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function sanitizeImportRecord(config: ModuleConfig, record: Record<string, string>, companyId: string) {
  const output: Record<string, unknown> = { company_id: companyId };
  for (const column of config.columns) {
    const value = record[column];
    if (value === undefined || value === "") continue;
    if (["is_active"].includes(column)) output[column] = ["true", "1", "yes", "active"].includes(value.toLowerCase());
    else if (["section_weight_kg_per_m", "standard_length_m", "current_stock", "reorder_level", "average_rate"].includes(column)) output[column] = Number(value);
    else output[column] = stripHtmlTags(value);
  }
  return output;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}
