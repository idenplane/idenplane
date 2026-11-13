import { HttpException, HttpStatus } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { PresentedClientCertificate } from './client-certificate.source.js';

/** The `cnf` member RFC 8705 §3.1 defines for a certificate-bound token. */
export const X5T_S256 = 'x5t#S256';

/** The certificate a request presented, or a function that reads it. */
export type PresentedCertificateInput =
  | Pick<PresentedClientCertificate, 'x5tS256'>
  | null
  | undefined
  | (() => Pick<PresentedClientCertificate, 'x5tS256'> | null | undefined);

/** Why a bound token was refused. The wording is sent to the client. */
const DESCRIPTIONS = {
  missing:
    'The access token is bound to a client certificate; present that certificate over mutual TLS',
  mismatch: 'The access token is bound to a different client certificate',
  malformed: 'The access token carries an unsupported confirmation (cnf)',
} as const;

export type CertificateBindingFailure = keyof typeof DESCRIPTIONS;

/**
 * A certificate-bound access token used without its certificate: 401
 * `invalid_token` with a `WWW-Authenticate: Bearer` challenge (RFC 6750 §3,
 * RFC 8705 §3). The global exception filter writes {@link wwwAuthenticate}.
 */
export class CertificateBindingError extends HttpException {
  /** The `WWW-Authenticate` header value; built from constants only. */
  readonly wwwAuthenticate: string;

  constructor(readonly reason: CertificateBindingFailure) {
    const description = DESCRIPTIONS[reason];
    super(
      { error: 'invalid_token', error_description: description },
      HttpStatus.UNAUTHORIZED,
    );
    this.wwwAuthenticate = `Bearer error="invalid_token", error_description="${description}"`;
  }
}

/**
 * The `x5t#S256` a token is bound to, `null` for an unbound token. Throws
 * {@link CertificateBindingError} (`malformed`) for a `cnf` this server does
 * not issue: a binding it cannot check is not a binding it may ignore.
 */
export function boundCertificateThumbprint(
  payload: Record<string, unknown>,
): string | null {
  if (!('cnf' in payload) || payload['cnf'] === undefined) return null;
  const cnf = payload['cnf'];
  if (typeof cnf !== 'object' || cnf === null || Array.isArray(cnf)) {
    throw new CertificateBindingError('malformed');
  }
  const thumbprint = (cnf as Record<string, unknown>)[X5T_S256];
  if (typeof thumbprint !== 'string' || thumbprint === '') {
    throw new CertificateBindingError('malformed');
  }
  return thumbprint;
}

function sameThumbprint(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Enforces RFC 8705 §3 at a resource endpoint: a token whose `cnf` carries an
 * `x5t#S256` is accepted only from a request that presents that certificate,
 * through the certificate listener's handshake or a trusted proxy's header
 * (see ClientCertificateSource). An unbound token passes untouched.
 *
 * `presented` may be a function so the certificate is read only for a bound
 * token: an unbound token's request behaves exactly as without mTLS. A
 * certificate that cannot be read (a malformed proxy header) counts as none.
 *
 * Throws {@link CertificateBindingError}.
 */
export function assertCertificateBinding(
  payload: Record<string, unknown>,
  presented: PresentedCertificateInput,
): void {
  const bound = boundCertificateThumbprint(payload);
  if (bound === null) return;

  let certificate: Pick<PresentedClientCertificate, 'x5tS256'> | null;
  try {
    certificate =
      (typeof presented === 'function' ? presented() : presented) ?? null;
  } catch {
    certificate = null;
  }
  if (!certificate) throw new CertificateBindingError('missing');
  if (!sameThumbprint(certificate.x5tS256, bound)) {
    throw new CertificateBindingError('mismatch');
  }
}
