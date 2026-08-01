/**
 * Reject non-HTTPS Idenplane server URLs, since they would send bearer
 * tokens and JWKS responses over the wire in plaintext. Loopback hosts
 * (localhost, 127.0.0.1, ::1) are always exempt because local development
 * has no TLS to offer; anywhere else, opt in explicitly with
 * `allowInsecureHttp: true` if plaintext HTTP is genuinely intended.
 */
export function assertSecureServerUrl(serverUrl: string, allowInsecureHttp: boolean | undefined): void {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error(`Idenplane: invalid server URL "${serverUrl}"`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:') {
    const isLoopback =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    if (isLoopback || allowInsecureHttp) return;
    throw new Error(
      `Idenplane: refusing insecure "http://" server URL "${serverUrl}". ` +
        `Use "https://", or pass allowInsecureHttp: true if this is intentional.`,
    );
  }
  throw new Error(`Idenplane: server URL must use "https://" (got "${parsed.protocol}//" in "${serverUrl}")`);
}
