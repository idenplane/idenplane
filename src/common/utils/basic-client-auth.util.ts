/** Client credentials sent with HTTP Basic authentication. */
export interface BasicClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Reads client credentials from an `Authorization: Basic` header
 * (RFC 6749 §2.3.1). Returns `null` when the header is absent or uses another
 * scheme, and `'malformed'` when it is Basic but cannot be decoded.
 *
 * Both parts are form-urlencoded before base64 encoding, so `+` stands for a
 * space and percent-escapes are decoded.
 */
export function parseBasicClientCredentials(
  header: string | undefined,
): BasicClientCredentials | null | 'malformed' {
  if (!header || !/^basic /i.test(header)) return null;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString(
    'utf8',
  );
  const separator = decoded.indexOf(':');
  if (separator <= 0) return 'malformed';
  try {
    return {
      clientId: formDecode(decoded.slice(0, separator)),
      clientSecret: formDecode(decoded.slice(separator + 1)),
    };
  } catch {
    return 'malformed';
  }
}

function formDecode(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '));
}
