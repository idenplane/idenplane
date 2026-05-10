/**
 * Interface for SMS providers.
 * Each provider implements this interface to send SMS messages.
 */
export interface SmsProvider {
  /**
   * Unique identifier for this provider (e.g., 'twilio', 'vonage').
   */
  readonly name: string;

  /**
   * Send an SMS message.
   * @param to - Recipient phone number (E.164 format recommended)
   * @param message - Message content
   * @returns void on success
   * @throws Error if sending fails
   */
  sendSms(to: string, message: string): Promise<void>;

  /**
   * Check if the provider is properly configured.
   * @returns true if provider is ready to send messages
   */
  isConfigured(): boolean;
}
