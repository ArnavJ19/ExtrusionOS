"use server";

import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { buildDieTechnicalSheetPdf } from "@/lib/reports/pcda/die-technical-sheet";
import { buildProfileTechnicalSheetPdf } from "@/lib/reports/pcda/profile-technical-sheet";
import { buildCustomerSafeReportModel } from "@/lib/reports/pcda/customer-report";
import { generateCSV, generateExcel, generatePDF, storeReport, type GeneratedReportFile } from "@/lib/reports/pcda/generator";
import { checkReportReadiness } from "@/lib/reports/pcda/readiness";
import { getReportTemplate, type ReportTemplateKey } from "@/lib/reports/pcda/templates";
import { getErrorMessage } from "@/lib/utils/errors";

export type ReportFormat = "pdf" | "csv" | "excel";

const PROFITABILITY_ROLES = new Set(["owner", "admin", "accounts"]);
const DOWNLOADABLE_RECORD_RESOURCES = {
  quote: "quotes",
  order: "orders",
  profile: "profiles",
  die: "dies",
  production_job: "production",
  quality_inspection: "quality",
  dispatch: "dispatches",
} as const;

function canGenerateTemplate(role: string, templateKey: ReportTemplateKey): boolean {
  const template = getReportTemplate(templateKey);
  if (!template) return false;
  if (templateKey === "profitability") return PROFITABILITY_ROLES.has(role);
  return template.roles.includes(role);
}

function fileForFormat(format: ReportFormat, model: Awaited<ReturnType<typeof buildCustomerSafeReportModel>>): Promise<GeneratedReportFile> | GeneratedReportFile {
  if (format === "csv") return generateCSV(model);
  if (format === "excel") return generateExcel(model);
  return generatePDF(model);
}

export async function generateReport(
  templateKey: ReportTemplateKey,
  recordId: string,
  format: ReportFormat = "pdf"
): Promise<{ success: boolean; storagePath?: string; downloadUrl?: string; error?: string; missingFields?: string[] }> {
  try {
    const context = await getSessionContext();
    const supabase = await createClient();
    const template = getReportTemplate(templateKey);
    if (!template) return { success: false, error: "Unknown report template" };
    if (!canGenerateTemplate(context.role, templateKey)) return { success: false, error: "You do not have permission to generate this report." };
    if (format === "csv" && !template.supportsCsv) return { success: false, error: "This template does not support CSV export." };
    if (format === "excel" && !template.supportsExcel) return { success: false, error: "This template does not support Excel export." };

    const readiness = await checkReportReadiness(templateKey, recordId, context.companyId, supabase);
    if (!readiness.ready) {
      return { success: false, error: "Report is not ready to generate.", missingFields: readiness.missingFields };
    }

    const model = await buildCustomerSafeReportModel(templateKey, recordId, context.companyId);
    const file = await fileForFormat(format, model);
    const safeRecordNumber = model.header.recordNumber.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || recordId;
    const reportVersion = `${Date.now()}-${crypto.randomUUID()}`;
    const storagePath = `${context.companyId}/reports/${template.recordType}/${recordId}/${reportVersion}-${templateKey}-${safeRecordNumber}.${file.extension}`;

    await storeReport(supabase, file, storagePath);

    const { error: reportInsertError } = await supabase.from("technical_reports").insert({
      company_id: context.companyId,
      template_key: templateKey,
      record_type: template.recordType,
      record_id: recordId,
      record_number: model.header.recordNumber,
      revision_number: Number(model.header.revisionNumber) || 1,
      storage_path: storagePath,
      generated_by: context.userId
    });
    if (reportInsertError) {
      throw new Error(`Could not save report history: ${reportInsertError.message}`);
    }

    const signed = await supabase.storage.from("reports").createSignedUrl(storagePath, 60 * 10);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(`Could not create report download: ${signed.error?.message ?? "Signed URL unavailable"}`);
    }
    return { success: true, storagePath, downloadUrl: signed.data.signedUrl };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Report generation failed") };
  }
}

export async function getReportDownloadUrl(
  reportId: string
): Promise<{ success: boolean; downloadUrl?: string; error?: string }> {
  try {
    const context = await getSessionContext();
    const supabase = await createClient();
    const { data: report, error } = await supabase
      .from("technical_reports")
      .select("id, template_key, record_type, storage_path")
      .eq("id", reportId)
      .eq("company_id", context.companyId)
      .single();

    if (error || !report) {
      return { success: false, error: "Report not found." };
    }
    const template = getReportTemplate(report.template_key);
    if (!template || !canGenerateTemplate(context.role, template.key)) {
      return { success: false, error: "You do not have permission to download this report." };
    }

    const resource = DOWNLOADABLE_RECORD_RESOURCES[
      report.record_type as keyof typeof DOWNLOADABLE_RECORD_RESOURCES
    ];
    if (resource && !can(context.role, "read", resource)) {
      return { success: false, error: "You do not have permission to download this report." };
    }
    if (!report.storage_path.startsWith(`${context.companyId}/`)) {
      return { success: false, error: "Invalid report storage path." };
    }

    const signed = await supabase.storage.from("reports").createSignedUrl(report.storage_path, 60 * 10);
    if (signed.error || !signed.data?.signedUrl) {
      return { success: false, error: signed.error?.message ?? "Could not create download link." };
    }
    return { success: true, downloadUrl: signed.data.signedUrl };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not download report") };
  }
}

/**
 * Generate a die technical sheet PDF and store it in Supabase Storage.
 * Returns the storage path for download.
 */
export async function generateDieTechnicalSheet(dieId: string): Promise<{ success: boolean; storagePath?: string; error?: string }> {
  const context = await getSessionContext();
  const supabase = await createClient();

  const { data: die, error: dieError } = await supabase
    .from("dies")
    .select("*, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name, section_weight_kg_per_m), customers(customer_name, company_name)")
    .eq("id", dieId)
    .eq("company_id", context.companyId)
    .single();

  if (dieError || !die) return { success: false, error: "Die not found" };

  const { data: company } = await supabase.from("companies").select("name, gst_number").eq("id", context.companyId).single();

  const [trialsResult, correctionsResult, nitridingsResult] = await Promise.all([
    supabase.from("die_trials").select("*").eq("company_id", context.companyId).eq("die_id", dieId).order("trial_date", { ascending: false }).limit(20),
    supabase.from("die_corrections").select("*").eq("company_id", context.companyId).eq("die_id", dieId).order("correction_date", { ascending: false }).limit(20),
    supabase.from("die_nitriding_history").select("*").eq("company_id", context.companyId).eq("die_id", dieId).order("nitriding_date", { ascending: false }).limit(20),
  ]);

  const pdfBytes = await buildDieTechnicalSheetPdf({
    company: { name: company?.name ?? "Company", gst_number: company?.gst_number ?? undefined },
    die,
    profile: die.aluminium_profiles,
    customer: die.customers,
    trials: trialsResult.data ?? [],
    corrections: correctionsResult.data ?? [],
    nitridings: nitridingsResult.data ?? [],
    generatedBy: context.fullName ?? context.email ?? "System"
  });

  // Store in Supabase Storage
  const storagePath = `${context.companyId}/reports/die/${dieId}/${die.die_number}-technical-sheet.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("reports")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (uploadError) return { success: false, error: `Upload failed: ${uploadError.message}` };

  // Record in technical_reports table
  await supabase.from("technical_reports").insert({
    company_id: context.companyId,
    template_key: "die_technical",
    record_type: "die",
    record_id: dieId,
    record_number: die.die_number,
    storage_path: storagePath,
    generated_by: context.userId
  });

  return { success: true, storagePath };
}

/**
 * Generate a profile technical sheet PDF and store it in Supabase Storage.
 */
export async function generateProfileTechnicalSheet(profileId: string): Promise<{ success: boolean; storagePath?: string; error?: string }> {
  const context = await getSessionContext();
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("aluminium_profiles")
    .select("*, primary_die:dies!aluminium_profiles_primary_die_id_fkey(die_number, die_status), backup_die:dies!aluminium_profiles_backup_die_id_fkey(die_number, die_status)")
    .eq("id", profileId)
    .eq("company_id", context.companyId)
    .single();

  if (profileError || !profile) return { success: false, error: "Profile not found" };

  const { data: company } = await supabase.from("companies").select("name, gst_number").eq("id", context.companyId).single();

  const pdfBytes = await buildProfileTechnicalSheetPdf({
    company: { name: company?.name ?? "Company", gst_number: company?.gst_number ?? undefined },
    profile,
    primaryDie: profile.primary_die as any,
    backupDie: profile.backup_die as any,
    generatedBy: context.fullName ?? context.email ?? "System"
  });

  const storagePath = `${context.companyId}/reports/profile/${profileId}/${profile.profile_code}-technical-sheet.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("reports")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (uploadError) return { success: false, error: `Upload failed: ${uploadError.message}` };

  await supabase.from("technical_reports").insert({
    company_id: context.companyId,
    template_key: "profile_technical",
    record_type: "profile",
    record_id: profileId,
    record_number: profile.profile_code,
    storage_path: storagePath,
    generated_by: context.userId
  });

  return { success: true, storagePath };
}
