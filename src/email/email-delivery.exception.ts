import { BadGatewayException } from '@nestjs/common';

/**
 * The email provider (SMTP server or delivery API) refused or could not take
 * a message: 502 Bad Gateway. The message is chosen by
 * {@link safeEmailDeliveryMessage} and never carries the provider's own
 * error text, so the global exception filter returns it even in production
 * (`exposeMessage`), where other 5xx messages are replaced.
 */
export class EmailDeliveryException extends BadGatewayException {
  readonly exposeMessage = true;

  constructor(message: string) {
    super(message);
  }
}

const CONNECTION_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ETLS',
  'EPROTOCOL',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

/**
 * A message for an admin about why a test email was not sent, safe to return
 * in an HTTP response. Only the error's code (nodemailer's `code`, or the
 * HTTP status of an API provider) is looked at: the provider's message text
 * can quote the server's reply, host names or the envelope, and is logged
 * instead.
 */
export function safeEmailDeliveryMessage(err: unknown): string {
  const code =
    typeof (err as { code?: unknown } | null)?.code === 'string'
      ? (err as { code: string }).code
      : '';
  const text = err instanceof Error ? err.message : '';
  const apiStatus = /^\w+ API error (\d{3})\b/.exec(text)?.[1];

  let reason: string;
  if (code === 'EAUTH' || apiStatus === '401' || apiStatus === '403') {
    reason =
      'the email provider rejected the credentials. Check the username and password, or the API key.';
  } else if (CONNECTION_CODES.has(code)) {
    reason =
      'could not connect to the mail server. Check the host, port and TLS setting.';
  } else if (code === 'EENVELOPE') {
    reason = 'the mail server refused the sender or recipient address.';
  } else {
    reason =
      'the email provider did not accept the message. The server log has the details.';
  }
  return `The test email could not be sent: ${reason}`;
}
