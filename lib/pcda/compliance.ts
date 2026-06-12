/**
 * PCDA Compliance Checklist Derivation
 *
 * When an order is created for a customer, the system derives the Compliance_Checklist
 * from the customer's required certificates. This is a pure, deterministic function.
 *
 * Requirements: 9.2, 19.7
 */

export type ComplianceRequirement = {
  certificate_type: string;
  description: string | null;
  is_mandatory: boolean;
};

export type ComplianceChecklistItem = {
  certificate_type: string;
  description: string | null;
  is_mandatory: boolean;
  status: "pending";
};

/**
 * Derive a compliance checklist from customer compliance requirements.
 *
 * Pure function: deterministic — equal inputs always produce equal outputs.
 * The generated checklist contains ALL active source items from the customer's requirements.
 * Each item starts with status "pending".
 *
 * Property 18 target: derived checklists contain all source items.
 */
export function deriveComplianceChecklist(
  requirements: ComplianceRequirement[]
): ComplianceChecklistItem[] {
  return requirements
    .filter((r) => r.certificate_type && r.certificate_type.trim().length > 0)
    .map((r) => ({
      certificate_type: r.certificate_type,
      description: r.description,
      is_mandatory: r.is_mandatory,
      status: "pending" as const,
    }));
}

/**
 * Merge customer-level required_certificates (text array) with
 * detailed customer_compliance_requirements records.
 *
 * If the customer has both a text array and detailed records,
 * the detailed records take precedence for matching certificate types,
 * and any types in the text array not covered by detailed records
 * are added as mandatory items.
 */
export function mergeComplianceSources(
  requiredCertificatesArray: string[] | null,
  detailedRequirements: ComplianceRequirement[]
): ComplianceRequirement[] {
  const merged: ComplianceRequirement[] = [...detailedRequirements];
  const existingTypes = new Set(
    detailedRequirements.map((r) => r.certificate_type.toLowerCase().trim())
  );

  if (requiredCertificatesArray) {
    for (const cert of requiredCertificatesArray) {
      const normalized = cert.toLowerCase().trim();
      if (normalized && !existingTypes.has(normalized)) {
        merged.push({
          certificate_type: cert.trim(),
          description: null,
          is_mandatory: true,
        });
        existingTypes.add(normalized);
      }
    }
  }

  return merged;
}
