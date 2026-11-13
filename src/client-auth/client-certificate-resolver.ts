import { Injectable } from '@nestjs/common';
import type { Client } from '@prisma/client';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';

/** Which RFC 8705 §2 method a resolver answers for. */
export type CertificateAuthMethod =
  'tls_client_auth' | 'self_signed_tls_client_auth';

export interface ClientCertificateResolution {
  /** The client the certificate authenticates. */
  clientId: string;
  method: CertificateAuthMethod;
  /** When the client's tokens must be bound to the certificate (`cnf`). */
  bindToCertificate: boolean;
}

/**
 * The certificate was this resolver's to judge and does not authenticate
 * the client. `reason` is for logs only; the client is told nothing more
 * than `invalid_client`.
 */
export interface ClientCertificateRejection {
  rejected: string;
}

export interface ClientCertificateResolveInput {
  realm: {
    id: string;
    mtlsClientAuthEnabled?: boolean;
    mtlsTrustGlobalAnchors?: boolean;
  };
  client: Client;
  method: CertificateAuthMethod;
  certificate: PresentedClientCertificate;
}

/**
 * Decides whether a presented certificate authenticates a client: the client
 * table (PR 2) and NHI credentials (PR 4) each register one. A resolver
 * returns `null` when the client is not one it knows about, so the next one
 * is asked; the first non-null answer decides.
 */
export interface ClientCertificateResolver {
  readonly name: string;
  resolve(
    input: ClientCertificateResolveInput,
  ): Promise<ClientCertificateResolution | ClientCertificateRejection | null>;
  /**
   * Whether a token bound to `x5tS256` and issued to `client` may still be
   * used (introspection): `true` or `false` when the client is one this
   * resolver knows about, `null` otherwise. Optional: a resolver without it
   * leaves the decision to the token's other checks.
   */
  bindingActive?(input: CertificateBindingInput): Promise<boolean | null>;
}

export interface CertificateBindingInput {
  realm: ClientCertificateResolveInput['realm'];
  client: Client;
  /** The token's `cnf.x5t#S256`, or `null` for an unbound token. */
  x5tS256: string | null;
}

/**
 * The resolvers certificate authentication may consult. With none
 * registered no `tls_*` method can succeed: it fails closed.
 */
@Injectable()
export class ClientCertificateResolverRegistry {
  private readonly registered: ClientCertificateResolver[] = [];

  register(resolver: ClientCertificateResolver): void {
    if (this.registered.some((r) => r.name === resolver.name)) {
      throw new Error(
        `Client certificate resolver "${resolver.name}" is already registered`,
      );
    }
    this.registered.push(resolver);
  }

  resolvers(): readonly ClientCertificateResolver[] {
    return this.registered;
  }

  /**
   * The first answer of a resolver that knows the client (see
   * {@link ClientCertificateResolver.bindingActive}), or `null` when none
   * does.
   */
  async bindingActive(input: CertificateBindingInput): Promise<boolean | null> {
    for (const resolver of this.registered) {
      const answer = (await resolver.bindingActive?.(input)) ?? null;
      if (answer !== null) return answer;
    }
    return null;
  }
}
