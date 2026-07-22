"use server";

import {
  generateDieTechnicalSheet as generateDieTechnicalSheetImpl,
  generateProfileTechnicalSheet as generateProfileTechnicalSheetImpl,
  generateReport as generateReportImpl,
  getReportDownloadUrl as getReportDownloadUrlImpl,
  type ReportFormat,
} from "@/lib/actions/pcda-reports";
import type { ReportTemplateKey } from "@/lib/reports/pcda/templates";

export async function generateReport(
  templateKey: ReportTemplateKey,
  recordId: string,
  format: ReportFormat = "pdf"
) {
  return generateReportImpl(templateKey, recordId, format);
}

export async function getReportDownloadUrl(reportId: string) {
  return getReportDownloadUrlImpl(reportId);
}

export async function generateDieTechnicalSheet(dieId: string) {
  return generateDieTechnicalSheetImpl(dieId);
}

export async function generateProfileTechnicalSheet(profileId: string) {
  return generateProfileTechnicalSheetImpl(profileId);
}
