/**
 * RFC 8705 §3 certificate-bound access tokens, for a resource server.
 *
 * A token issued to a client registered with
 * `tlsClientCertificateBoundAccessTokens` carries
 * `cnf: { "x5t#S256": <thumbprint> }`: it is valid only on a request whose
 * mutual-TLS client certificate has that thumbprint.
 *
 * No Node-only APIs: Web Crypto and `btoa` work in Node 18+, browsers and
 * edge runtimes alike.
 */

/** The certificate a request presented, for checking a token's binding. */
export interface CertificateBindingOptions {
  /**
   * The `x5t#S256` of the client certificate the request presented:
   * base64url(SHA-256(DER)), unpadded. See {@link computeX5tS256}.
   */
  certificateThumbprint?: string;
  /** The presented client certificate itself, DER-encoded. */
  certificate?: Uint8Array | ArrayBuffer;
}

/** A certificate-bound token used without its certificate. */
export class CertificateBindingError extends Error {
  /** The RFC 6750 error code a resource server should answer with. */
  readonly code = 'invalid_token';

  constructor(
    readonly reason: 'missing' | 'mismatch' | 'malformed',
    message: string,
  ) {
    super(message);
    this.name = 'CertificateBindingError';
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  // At most two `=` of padding, always at the end.
  let end = base64.length;
  while (end > 0 && base64[end - 1] === '=') end--;
  return base64.slice(0, end).replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * The RFC 8705 `x5t#S256` of a DER-encoded certificate: base64url of its
 * SHA-256 digest, without padding.
 */
export async function computeX5tS256(der: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  // Copy into a fresh ArrayBuffer: a Node Buffer may be a view on a larger
  // pool, and Buffer#slice returns a view, not a copy.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return base64url(new Uint8Array(digest));
}

/**
 * The thumbprint a token is bound to, or `null` for an unbound token.
 * Throws {@link CertificateBindingError} for a `cnf` without a usable
 * `x5t#S256`: a binding that cannot be checked is never ignored.
 */
export function boundCertificateThumbprint(payload: Record<string, unknown>): string | null {
  const cnf = payload['cnf'];
  if (cnf === undefined) return null;
  const thumbprint =
    typeof cnf === 'object' && cnf !== null && !Array.isArray(cnf)
      ? (cnf as Record<string, unknown>)['x5t#S256']
      : undefined;
  if (typeof thumbprint !== 'string' || thumbprint === '') {
    throw new CertificateBindingError('malformed', 'Unsupported token confirmation (cnf)');
  }
  return thumbprint;
}

/**
 * Checks a verified token's certificate binding against the certificate the
 * request presented. An unbound token passes. A bound token passes only with
 * a matching certificate; without one it is refused (fail closed).
 */
export async function assertCertificateBinding(
  payload: Record<string, unknown>,
  options: CertificateBindingOptions = {},
): Promise<void> {
  const bound = boundCertificateThumbprint(payload);
  if (bound === null) return;
  const presented =
    options.certificateThumbprint ??
    (options.certificate ? await computeX5tS256(options.certificate) : undefined);
  if (!presented) {
    throw new CertificateBindingError(
      'missing',
      'The token is bound to a client certificate, and none was presented',
    );
  }
  if (presented !== bound) {
    throw new CertificateBindingError(
      'mismatch',
      'The token is bound to a different client certificate',
    );
  }
}
