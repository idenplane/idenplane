import { Inject, Injectable, HttpStatus, Logger } from '@nestjs/common';
import type { Client } from '@prisma/client';
import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import { ClientSecretService } from '../clients/client-secret.service.js';
import { OAuthTokenError } from '../auth/oauth-token-error.js';
import { parseBasicClientCredentials } from '../common/utils/basic-client-auth.util.js';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';
import { MTLS_CONFIG, type MtlsConfig } from '../mtls/mtls-config.js';
import {
  ClientCertificateResolverRegistry,
  type CertificateAuthMethod,
  type CertificateBindingClaims,
} from './client-certificate-resolver.js';
import { CertificateAuthFailureBudget } from './certificate-auth-failure-budget.js';

/** RFC 7591 `token_endpoint_auth_method` values the server knows. */
export type ClientAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'none'
  | 'tls_client_auth'
  | 'self_signed_tls_client_auth';

/** Why client authentication failed, independent of the wording an endpoint uses. */
export type ClientAuthFailure =
  | 'malformed_basic'
  | 'multiple_methods'
  | 'client_id_mismatch'
  | 'missing_client_id'
  | 'unknown_client'
  | 'missing_secret'
  | 'no_secret_configured'
  | 'invalid_secret'
  | 'unsupported_method'
  | 'wrong_method'
  | 'credential_with_certificate_method'
  | 'missing_certificate'
  | 'invalid_certificate'
  | 'bound_tokens_need_certificate'
  | 'too_many_failures';

type FailureCode = 'invalid_client' | 'invalid_request' | 'slow_down';

const FAILURES: Record<
  ClientAuthFailure,
  { code: FailureCode; description: string }
> = {
  malformed_basic: {
    code: 'invalid_client',
    description: 'Malformed HTTP Basic client credentials',
  },
  multiple_methods: {
    code: 'invalid_request',
    description: 'Use either HTTP Basic or client_secret, not both',
  },
  client_id_mismatch: {
    code: 'invalid_request',
    description: 'client_id does not match the HTTP Basic credentials',
  },
  missing_client_id: {
    code: 'invalid_client',
    description: 'client_id is required',
  },
  unknown_client: { code: 'invalid_client', description: 'Invalid client' },
  missing_secret: {
    code: 'invalid_client',
    description: 'client_secret is required',
  },
  no_secret_configured: {
    code: 'invalid_client',
    description: 'Client has no secret configured',
  },
  invalid_secret: {
    code: 'invalid_client',
    description: 'Invalid client credentials',
  },
  unsupported_method: {
    code: 'invalid_client',
    description: 'Client authentication method is not available',
  },
  wrong_method: {
    code: 'invalid_client',
    description:
      'Client authentication method does not match the registered token_endpoint_auth_method',
  },
  credential_with_certificate_method: {
    code: 'invalid_request',
    description:
      'This client authenticates with a certificate; do not send a client secret or assertion',
  },
  missing_certificate: {
    code: 'invalid_client',
    description: 'A client certificate is required',
  },
  // One description for every way a certificate can fail, so the response
  // tells a caller nothing about which check it failed.
  invalid_certificate: {
    code: 'invalid_client',
    description: 'Invalid client certificate',
  },
  // RFC 8705 §3: a client registered for certificate-bound access tokens
  // asked for a token without presenting a certificate to bind it to.
  bound_tokens_need_certificate: {
    code: 'invalid_client',
    description:
      'This client receives certificate-bound access tokens; present a client certificate over mutual TLS',
  },
  too_many_failures: {
    code: 'slow_down',
    description: 'Too many failed attempts with this certificate; retry later',
  },
};

const STATUS: Record<FailureCode, HttpStatus> = {
  invalid_client: HttpStatus.UNAUTHORIZED,
  invalid_request: HttpStatus.BAD_REQUEST,
  slow_down: HttpStatus.TOO_MANY_REQUESTS,
};

/**
 * A failed client authentication. `invalid_client` is 401 and
 * `invalid_request` 400, as RFC 6749 §5.2 asks; a spent certificate failure
 * budget is 429 `slow_down` with `Retry-After`. `reason` lets an endpoint
 * keep its own wording; `detail` is for logs only.
 */
export class ClientAuthError extends OAuthTokenError {
  constructor(
    readonly reason: ClientAuthFailure,
    options: { retryAfterSeconds?: number; detail?: string } = {},
  ) {
    const { code, description } = FAILURES[reason];
    super(code, description, STATUS[code]);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.detail = options.detail;
  }

  /** Internal: which certificate check failed. Never sent to the client. */
  readonly detail?: string;
}

/** The client credentials a request carries, before any is checked. */
export interface PresentedClientCredentials {
  /** From Basic, else the `client_id` parameter. */
  clientId: string | undefined;
  /** The secret and how it was sent, when one was. */
  secret:
    | { method: 'client_secret_basic' | 'client_secret_post'; value: string }
    | undefined;
  /** A `client_assertion`/`client_assertion_type` parameter was sent. */
  assertion: boolean;
}

export interface ClientAuthInput {
  /**
   * The realm. The certificate methods need its flags; missing flags (e.g.
   * a realm row cached before they existed) count as off.
   */
  realm: {
    id: string;
    mtlsClientAuthEnabled?: boolean;
    mtlsTrustGlobalAnchors?: boolean;
  };
  /** Request parameters: `client_id`, `client_secret`. */
  body: Record<string, unknown> | undefined;
  /** The `Authorization` header, if any. */
  authorization?: string;
  /** The certificate the request presented (see ClientCertificateSource). */
  clientCert?: PresentedClientCertificate | null;
  /**
   * Runs once the client is identified and before its credentials are
   * checked, e.g. the grant-type allowlist, so its error wins over a wrong
   * secret and no hash is computed for a request that fails anyway.
   */
  beforeCredentialCheck?: (client: Client) => void;
  /**
   * Skip the credential check: for a client inside this server (forward
   * auth), which proves itself by PKCE instead of a secret it never holds.
   */
  skipCredentialCheck?: boolean;
}

export interface AuthenticatedClient {
  client: Client;
  clientId: string;
  /** The method that authenticated the client. */
  method: ClientAuthMethod;
  /** The certificate the request presented, if any (not necessarily used). */
  certificate: PresentedClientCertificate | null;
  /**
   * The `x5t#S256` of the certificate that authenticated the client, when a
   * certificate method did; `null` otherwise.
   */
  x5tS256: string | null;
  /** The client's tokens must be bound to that certificate (RFC 8705 §3). */
  bindToCertificate: boolean;
  /** Private claims the resolver attaches to the bound access token. */
  bindingClaims?: CertificateBindingClaims;
}

/**
 * The one place an OAuth client is authenticated, for every endpoint that
 * needs it.
 *
 * - One method per request: HTTP Basic together with a `client_secret`
 *   parameter, or a `client_id` parameter naming a different client than
 *   Basic, is `invalid_request`.
 * - The client's method is its registered `token_endpoint_auth_method`.
 *   Without one it is inferred: CONFIDENTIAL means `client_secret_basic` or
 *   `client_secret_post`, PUBLIC means `none`. A registered secret method
 *   accepts only that method.
 * - `tls_client_auth` / `self_signed_tls_client_auth` (RFC 8705) work only
 *   with `MTLS_ENABLED` and the realm's `mtlsClientAuthEnabled`; otherwise
 *   they are `invalid_client`. Such a client sending a secret or assertion
 *   too is `invalid_request`. Repeated failures with one certificate are
 *   429 (MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE).
 * - A certificate presented by a client of any other method is ignored.
 * - An NHI-backed client (`nhiIdentityId`) only ever authenticates with a
 *   certificate method.
 * - An unknown or disabled client is `invalid_client`.
 */
@Injectable()
export class ClientAuthenticator {
  private readonly logger = new Logger(ClientAuthenticator.name);

  constructor(
    private readonly lookups: CachedLookupsService,
    private readonly clientSecrets: ClientSecretService,
    readonly certificateResolvers: ClientCertificateResolverRegistry,
    @Inject(MTLS_CONFIG) private readonly mtls: Pick<MtlsConfig, 'enabled'>,
    private readonly failureBudget: CertificateAuthFailureBudget,
  ) {}

  /**
   * Reads the credentials a request presents and enforces one method per
   * request, without looking anything up. Throws {@link ClientAuthError}.
   */
  readCredentials(
    input: Pick<ClientAuthInput, 'body' | 'authorization'>,
  ): PresentedClientCredentials {
    const body = input.body ?? {};
    const bodyClientId = body['client_id'];
    const bodySecret = body['client_secret'];
    const assertion =
      body['client_assertion'] !== undefined ||
      body['client_assertion_type'] !== undefined;
    const basic = parseBasicClientCredentials(input.authorization);
    if (basic === 'malformed') throw new ClientAuthError('malformed_basic');
    if (basic) {
      if (bodySecret !== undefined) {
        throw new ClientAuthError('multiple_methods');
      }
      if (bodyClientId !== undefined && bodyClientId !== basic.clientId) {
        throw new ClientAuthError('client_id_mismatch');
      }
      return {
        clientId: basic.clientId,
        secret: { method: 'client_secret_basic', value: basic.clientSecret },
        assertion,
      };
    }
    return {
      clientId: typeof bodyClientId === 'string' ? bodyClientId : undefined,
      secret:
        typeof bodySecret === 'string'
          ? { method: 'client_secret_post', value: bodySecret }
          : undefined,
      assertion,
    };
  }

  /** Authenticates the calling client. Throws {@link ClientAuthError}. */
  async authenticate(input: ClientAuthInput): Promise<AuthenticatedClient> {
    const presented = this.readCredentials(input);
    const clientId = presented.clientId;
    if (!clientId) throw new ClientAuthError('missing_client_id');

    const client = await this.lookups.client(input.realm.id, clientId);
    if (!client || !client.enabled) {
      throw new ClientAuthError('unknown_client');
    }

    input.beforeCredentialCheck?.(client);

    const certificate = input.clientCert ?? null;
    const registered = registeredMethods(client);
    const done = (method: ClientAuthMethod): AuthenticatedClient => ({
      client,
      clientId,
      method,
      certificate,
      x5tS256: null,
      bindToCertificate: false,
    });

    // A registration that contradicts the client type authenticates nobody.
    if (registered.length === 0)
      throw new ClientAuthError('unsupported_method');

    // An NHI-backed client authenticates with its identity's certificates
    // only; whatever its row says otherwise, it has no secret to check.
    if (client.nhiIdentityId && !registered.some(isCertificateMethod)) {
      throw new ClientAuthError('unsupported_method');
    }

    if (input.skipCredentialCheck) return done(registered[0]);

    if (registered.includes('none')) {
      // A public client has no credential to check. A secret it sends anyway
      // is ignored, as it always has been.
      return done('none');
    }

    const certificateMethod = registered.find(isCertificateMethod);
    if (certificateMethod) {
      return this.authenticateWithCertificate(
        input,
        client,
        clientId,
        certificateMethod as CertificateAuthMethod,
        presented,
        certificate,
      );
    }

    const secret = presented.secret;
    if (secret && !registered.includes(secret.method)) {
      throw new ClientAuthError('wrong_method');
    }
    if (!secret?.value) throw new ClientAuthError('missing_secret');
    if (!client.clientSecret) {
      throw new ClientAuthError('no_secret_configured');
    }
    if (!(await this.clientSecrets.verify(client, secret.value))) {
      throw new ClientAuthError('invalid_secret');
    }
    return done(secret.method);
  }

  private async authenticateWithCertificate(
    input: ClientAuthInput,
    client: Client,
    clientId: string,
    method: CertificateAuthMethod,
    presented: PresentedClientCredentials,
    certificate: PresentedClientCertificate | null,
  ): Promise<AuthenticatedClient> {
    const realm = input.realm;
    if (!this.mtls.enabled || realm.mtlsClientAuthEnabled !== true) {
      throw new ClientAuthError('unsupported_method');
    }
    if (presented.secret || presented.assertion) {
      throw new ClientAuthError('credential_with_certificate_method');
    }
    if (!certificate) throw new ClientAuthError('missing_certificate');

    const retryAfter = await this.failureBudget.retryAfter(
      realm.id,
      certificate.x5tS256,
    );
    if (retryAfter !== null) {
      throw new ClientAuthError('too_many_failures', {
        retryAfterSeconds: retryAfter,
      });
    }

    let rejection = 'no_resolver';
    for (const resolver of this.certificateResolvers.resolvers()) {
      let result;
      try {
        result = await resolver.resolve({ realm, client, method, certificate });
      } catch (err) {
        this.logger.error(
          `Certificate resolver "${resolver.name}" failed: ${(err as Error).message}`,
        );
        rejection = `resolver_error:${resolver.name}`;
        break;
      }
      if (result === null) continue;
      if ('rejected' in result) {
        rejection = result.rejected;
        break;
      }
      if (result.clientId === clientId && result.method === method) {
        return {
          client,
          clientId,
          method,
          certificate,
          x5tS256: certificate.x5tS256,
          bindToCertificate: result.bindToCertificate,
          ...(result.bindingClaims
            ? { bindingClaims: result.bindingClaims }
            : {}),
        };
      }
      rejection = 'resolver_mismatch';
      break;
    }

    await this.failureBudget
      .recordFailure(realm.id, certificate.x5tS256)
      .catch((err: Error) =>
        this.logger.warn(
          `Could not count a certificate failure: ${err.message}`,
        ),
      );
    this.logger.warn(
      `Certificate authentication failed for client "${clientId}" in realm ${realm.id} (${method}): ${rejection}`,
    );
    throw new ClientAuthError('invalid_certificate', { detail: rejection });
  }
}

export function isCertificateMethod(method: ClientAuthMethod): boolean {
  return (
    method === 'tls_client_auth' || method === 'self_signed_tls_client_auth'
  );
}

/** The methods each client type may register. */
export function methodFitsClientType(
  method: ClientAuthMethod,
  clientType: Client['clientType'],
): boolean {
  return clientType === 'PUBLIC' ? method === 'none' : method !== 'none';
}

/**
 * The methods a client may use: its registered `token_endpoint_auth_method`,
 * or, when it has none, the ones its type implies. Empty when the
 * registered method contradicts the client type.
 */
export function registeredMethods(
  client: Pick<Client, 'clientType'> &
    Partial<Pick<Client, 'tokenEndpointAuthMethod'>>,
): readonly ClientAuthMethod[] {
  const explicit = client.tokenEndpointAuthMethod;
  if (explicit) {
    return methodFitsClientType(explicit, client.clientType) ? [explicit] : [];
  }
  return client.clientType === 'PUBLIC'
    ? ['none']
    : ['client_secret_basic', 'client_secret_post'];
}
