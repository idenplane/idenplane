export interface EmailProvider {
  readonly name: string;
  sendEmail(to: string, subject: string, html: string): Promise<void>;
  isConfigured(): boolean;
}
