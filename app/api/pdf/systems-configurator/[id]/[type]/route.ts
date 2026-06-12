import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { buildSystemConfiguratorPdf, type SystemReportType } from "@/lib/pdf/systems-configurator-pdf";
import { getSystemQuoteReadiness } from "@/lib/systems-configurator/quote-readiness";
import { getErrorMessage } from "@/lib/utils/errors";

const allowedTypes = new Set<SystemReportType>(["customer_quote", "cutting_list", "glass_list", "hardware_bom", "internal_costing", "production_sheet", "optimization_report"]);

function fileName(configurationNumber: string | null | undefined, type: string) {
  return `${configurationNumber || "system-configuration"}-${type}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  try {
    const { id, type } = await params;
    if (!allowedTypes.has(type as SystemReportType)) return NextResponse.json({ error: "Unsupported report type" }, { status: 400 });

    const context = await getSessionContext();
    const canShowInternalCost = ["owner", "admin", "accounts"].includes(context.role);
    if (type === "internal_costing" && !canShowInternalCost) return NextResponse.json({ error: "Internal costing report is restricted" }, { status: 403 });

    const supabase = await createClient();
    const [companyResult, settingsResult, configurationResult, profileCutsResult, glassCutsResult, beadingCutsResult, hardwareBomResult, materialSummaryResult, optimizationRunResult] = await Promise.all([
      supabase.from("companies").select("name, legal_name, gst_number, billing_address, city, state, pincode, phone, email").eq("id", context.companyId).single(),
      supabase.from("company_settings").select("default_quote_terms, default_terms_and_conditions, default_payment_terms, default_delivery_terms, bank_details, default_bank_details").eq("company_id", context.companyId).maybeSingle(),
      supabase.from("system_configurations").select("*, customers(customer_name, company_name, gst_number, billing_address, shipping_address), system_series(series_code, series_name), glass_items(glass_code, glass_name), finish_options(finish_code, finish_name)").eq("id", id).eq("company_id", context.companyId).single(),
      supabase.from("system_profile_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("profile_code", { ascending: true }).order("sort_order", { ascending: true }),
      supabase.from("system_glass_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("panel_index", { ascending: true }),
      supabase.from("system_beading_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("panel_index", { ascending: true }),
      supabase.from("system_hardware_bom").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("hardware_category", { ascending: true }),
      supabase.from("system_material_summary").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("material_type", { ascending: true }),
      supabase.from("profile_optimization_runs").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("run_number", { ascending: false }).limit(1).maybeSingle()
    ]);

    if (companyResult.error || !companyResult.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (configurationResult.error || !configurationResult.data) return NextResponse.json({ error: "Configuration not found" }, { status: 404 });
    for (const result of [settingsResult, profileCutsResult, glassCutsResult, beadingCutsResult, hardwareBomResult, materialSummaryResult, optimizationRunResult]) {
      if (result.error) return NextResponse.json({ error: getErrorMessage(result.error) }, { status: 500 });
    }

    if (type === "customer_quote") {
      const readiness = getSystemQuoteReadiness(configurationResult.data, profileCutsResult.data ?? [], true);
      if (!readiness.ready) return NextResponse.json({ error: readiness.reason ?? "Configuration is not ready for customer quote PDF." }, { status: 409 });
    }

    const bytes = await buildSystemConfiguratorPdf({
      company: companyResult.data,
      settings: settingsResult.data,
      configuration: configurationResult.data,
      profileCuts: profileCutsResult.data ?? [],
      glassCuts: glassCutsResult.data ?? [],
      beadingCuts: beadingCutsResult.data ?? [],
      hardwareBom: hardwareBomResult.data ?? [],
      materialSummary: materialSummaryResult.data ?? [],
      optimizationRun: optimizationRunResult.data,
      reportType: type as SystemReportType,
      canShowInternalCost
    });

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName(configurationResult.data.configuration_number, type)}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not generate system report PDF") }, { status: 500 });
  }
}
