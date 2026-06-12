// Provider abstraction for WhatsApp Business and other communication channels

export interface MessagePayload {
  toPhone: string;
  templateName: string;
  variables: Record<string, string>;
  language?: string;
}

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface CommunicationProvider {
  sendMessage(payload: MessagePayload): Promise<SendResult>;
  checkStatus(providerMessageId: string): Promise<string>;
}

// 1. Manual / Click-to-chat Provider (Default fallback)
export class ManualWhatsAppProvider implements CommunicationProvider {
  async sendMessage(payload: MessagePayload): Promise<SendResult> {
    void payload;
    // In manual mode, we just return a success state to log the interaction, 
    // but the actual message sending relies on the user clicking the generated wa.me link.
    return {
      success: true,
      providerMessageId: `manual_${Date.now()}`
    };
  }

  async checkStatus(providerMessageId: string): Promise<string> {
    void providerMessageId;
    return "manually_logged";
  }

  // Helper to generate the click-to-chat URL
  generateWaMeLink(phone: string, text: string): string {
    const cleanPhone = phone.replace(/\D/g, "");
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  }
}

// 2. WhatsApp Web Automation adapter
export class WhatsAppWebAutomationProvider implements CommunicationProvider {
  async sendMessage(payload: MessagePayload): Promise<SendResult> {
    void payload;
    return {
      success: false,
      error: "WhatsApp Web automation is not configured. Use the manual click-to-chat flow or configure an approved provider."
    };
  }

  async checkStatus(providerMessageId: string): Promise<string> {
    void providerMessageId;
    return "unavailable";
  }
}

// 3. WhatsApp Business API adapter
export class WhatsAppBusinessAPIProvider implements CommunicationProvider {
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendMessage(payload: MessagePayload): Promise<SendResult> {
    void payload;
    if (!this.apiKey) {
      return { success: false, error: "WhatsApp Business API credentials are not configured." };
    }
    return {
      success: false,
      error: "WhatsApp Business API transport is not wired yet. Manual click-to-chat remains the safe sending path."
    };
  }

  async checkStatus(providerMessageId: string): Promise<string> {
    void providerMessageId;
    return this.apiKey ? "unavailable" : "not_configured";
  }
}

// Factory to get the configured provider for a company
export function getCommunicationProvider(companyConfig?: any): CommunicationProvider {
  // Currently defaulting to Manual mode unless config states otherwise
  if (companyConfig?.whatsapp_provider === "business_api" && companyConfig?.whatsapp_api_key) {
    return new WhatsAppBusinessAPIProvider(companyConfig.whatsapp_api_key);
  }
  return new ManualWhatsAppProvider();
}
