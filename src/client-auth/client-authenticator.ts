import { Injectable, HttpStatus } from '@nestjs/common';
import type { Client } from '@prisma/client';
import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import { ClientSecretService } from '../clients/client-secret.service.js';
import { OAuthTokenError } from '../auth/oauth-token-error.js';
import { parseBasicClientCredentials } from '../common/utils/basic-client-auth.util.js';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';
import { ClientCertificateResolverRegistry } from './client-certificate-resolver.js';

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
  | 'unsupported_method';

const FAILURES: Record<
  ClientAuthFailure,
  { code: 'invalid_client' | 'invalid_request'; description: string }
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
};

/**
 * A failed client authentication. `invalid_client` is 401 and
 * `invalid_request` 400, as RFC 6749 §5.2 asks; `reason` lets an endpoint
 * keep its own wording.
 */
export class ClientAuthError extends OAuthTokenError {
  constructor(readonly reason: ClientAuthFailure) {
    const { code, description } = FAILURES[reason];
    super(
      code,
      description,
      code === 'invalid_client'
        ? HttpStatus.UNAUTHORIZED
        : HttpStatus.BAD_REQUEST,
    );
  }
}

/** The client credentials a request carries, before any is checked. */
export interface PresentedClientCredentials {
  /** From Basic, else the `client_id` parameter. */
  clientId: string | undefined;
  /** The secret and how it was sent, when one was. */
  secret:
    | { method: 'client_secret_basic' | 'client_secret_post'; value: string }
    | undefined;
}

export interface ClientAuthInput {
  realm: { id: string };
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
}

/**
 * The one place an OAuth client is authenticated, for every endpoint that
 * needs it: token, introspection, revocation.
 *
 * - One method per request: HTTP Basic together with a `client_secret`
 *   parameter, or a `client_id` parameter naming a different client than
 *   Basic, is `invalid_request`.
 * - The client's method is its registered `token_endpoint_auth_method`;
 *   clients registered before that existed infer it, CONFIDENTIAL meaning
 *   `client_secret_basic` or `client_secret_post` and PUBLIC meaning `none`.
 * - An unknown or disabled client is `invalid_client`.
 * - `tls_client_auth` and `self_signed_tls_client_auth` are not accepted yet:
 *   no {@link ClientCertificateResolverRegistry} resolver is registered.
 */
@Injectable()
export class ClientAuthenticator {
  constructor(
    private readonly lookups: CachedLookupsService,
    private readonly clientSecrets: ClientSecretService,
    /** Consulted by the certificate methods once they are accepted. */
    readonly certificateResolvers: ClientCertificateResolverRegistry,
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
      };
    }
    return {
      clientId: typeof bodyClientId === 'string' ? bodyClientId : undefined,
      secret:
        typeof bodySecret === 'string'
          ? { method: 'client_secret_post', value: bodySecret }
          : undefined,
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

    if (input.skipCredentialCheck) {
      return { client, clientId, method: registered[0], certificate };
    }

    if (registered.includes('none')) {
      // A public client has no credential to check. A secret it sends anyway
      // is ignored, as it always has been.
      return { client, clientId, method: 'none', certificate };
    }

    if (registered.some(isCertificateMethod)) {
      // Certificate authentication is not accepted in this release, whatever
      // resolvers are registered: it fails closed.
      throw new ClientAuthError('unsupported_method');
    }

    const secret = presented.secret;
    if (!secret?.value) throw new ClientAuthError('missing_secret');
    if (!client.clientSecret) {
      throw new ClientAuthError('no_secret_configured');
    }
    if (!(await this.clientSecrets.verify(client, secret.value))) {
      throw new ClientAuthError('invalid_secret');
    }
    return { client, clientId, method: secret.method, certificate };
  }
}

export function isCertificateMethod(method: ClientAuthMethod): boolean {
  return (
    method === 'tls_client_auth' || method === 'self_signed_tls_client_auth'
  );
}

/**
 * The methods a client may use. There is no stored
 * `token_endpoint_auth_method` yet, so it is inferred from the client type.
 */
export function registeredMethods(
  client: Pick<Client, 'clientType'>,
): readonly ClientAuthMethod[] {
  return client.clientType === 'PUBLIC'
    ? ['none']
    : ['client_secret_basic', 'client_secret_post'];
}
