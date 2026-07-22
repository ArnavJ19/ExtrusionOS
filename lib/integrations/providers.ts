export type IntegrationStatus = "not_configured" | "connected" | "error" | "disabled";
export type SyncStatus = "queued" | "running" | "completed" | "failed" | "partial";

export type IntegrationConfig = {
  companyId: string;
  providerName: string;
  config: Record<string, unknown>;
  secretReference?: string | null;
};

export type IntegrationResult = {
  success: boolean;
  status: SyncStatus;
  recordsProcessed?: number;
  recordsFailed?: number;
  error?: string;
};

export type InvoiceExportPayload = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amount: number;
};

export type CustomerExportPayload = {
  customerId: string;
  customerName: string;
  gstNumber?: string | null;
};

export type PaymentExportPayload = {
  paymentId: string;
  invoiceNumber: string;
  amount: number;
  paidAt: string;
};

export type ImportedLead = {
  leadName: string;
  companyName?: string;
  phone?: string;
  email?: string;
  source: string;
  raw: Record<string, unknown>;
};

export interface AccountingProvider {
  exportInvoice(payload: InvoiceExportPayload): Promise<IntegrationResult>;
  exportCustomer(payload: CustomerExportPayload): Promise<IntegrationResult>;
  exportPayment(payload: PaymentExportPayload): Promise<IntegrationResult>;
  importLedgerBalance(customerId: string): Promise<IntegrationResult & { balance?: number }>;
}

export interface LeadProvider {
  importLeads(): Promise<IntegrationResult & { leads?: ImportedLead[] }>;
  mapLeadFields(rawLead: Record<string, unknown>): ImportedLead;
}

export interface CommunicationProvider {
  sendMessage(payload: { to: string; templateName: string; variables: Record<string, string> }): Promise<IntegrationResult>;
  checkStatus(providerMessageId: string): Promise<IntegrationResult & { deliveryStatus?: string }>;
}

export class ManualAccountingProvider implements AccountingProvider {
  private readonly integration: IntegrationConfig;

  constructor(integration: IntegrationConfig) {
    this.integration = integration;
  }

  async exportInvoice(payload: InvoiceExportPayload): Promise<IntegrationResult> {
    return manualBridgeResult(this.integration.providerName, `Invoice ${payload.invoiceNumber} ready for manual export.`);
  }

  async exportCustomer(payload: CustomerExportPayload): Promise<IntegrationResult> {
    return manualBridgeResult(this.integration.providerName, `Customer ${payload.customerName} ready for manual export.`);
  }

  async exportPayment(payload: PaymentExportPayload): Promise<IntegrationResult> {
    return manualBridgeResult(this.integration.providerName, `Payment ${payload.paymentId} ready for manual export.`);
  }

  async importLedgerBalance(customerId: string): Promise<IntegrationResult & { balance?: number }> {
    return { ...manualBridgeResult(this.integration.providerName, `Ledger balance import pending for ${customerId}.`), balance: undefined };
  }
}

export class ManualLeadProvider implements LeadProvider {
  private readonly integration: IntegrationConfig;

  constructor(integration: IntegrationConfig) {
    this.integration = integration;
  }

  async importLeads(): Promise<IntegrationResult & { leads?: ImportedLead[] }> {
    return { ...manualBridgeResult(this.integration.providerName, "Lead import file can be uploaded through data exchange."), leads: [] };
  }

  mapLeadFields(rawLead: Record<string, unknown>): ImportedLead {
    return {
      leadName: String(rawLead.name ?? rawLead.lead_name ?? "Imported lead"),
      companyName: rawLead.company ? String(rawLead.company) : undefined,
      phone: rawLead.phone ? String(rawLead.phone) : undefined,
      email: rawLead.email ? String(rawLead.email) : undefined,
      source: this.integration.providerName,
      raw: rawLead
    };
  }
}

export class ManualCommunicationProvider implements CommunicationProvider {
  private readonly integration: IntegrationConfig;

  constructor(integration: IntegrationConfig) {
    this.integration = integration;
  }

  async sendMessage(payload: { to: string; templateName: string; variables: Record<string, string> }): Promise<IntegrationResult> {
    return manualBridgeResult(this.integration.providerName, `Message ${payload.templateName} queued for manual send to ${payload.to}.`);
  }

  async checkStatus(providerMessageId: string): Promise<IntegrationResult & { deliveryStatus?: string }> {
    return { ...manualBridgeResult(this.integration.providerName, `Manual status check for ${providerMessageId}.`), deliveryStatus: "manual" };
  }
}

export function createAccountingProvider(integration: IntegrationConfig): AccountingProvider {
  return new ManualAccountingProvider(integration);
}

export function createLeadProvider(integration: IntegrationConfig): LeadProvider {
  return new ManualLeadProvider(integration);
}

export function createCommunicationProvider(integration: IntegrationConfig): CommunicationProvider {
  return new ManualCommunicationProvider(integration);
}

function manualBridgeResult(providerName: string, note: string): IntegrationResult {
  return {
    success: false,
    status: "failed",
    recordsProcessed: 0,
    recordsFailed: 0,
    error: `${providerName} has no automated connector configured. ${note}`
  };
}
