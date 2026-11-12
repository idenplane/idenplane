import { CidrMatcher, CidrListError } from './cidr.js';

/** DI token for the validated {@link MtlsConfig}. */
export const MTLS_CONFIG = Symbol('MTLS_CONFIG');

export type ProxyCertFormat = 'pem-urlencoded' | 'rfc9440';
export type UntrustedHeaderAction = 'reject' | 'strip';

export interface MtlsListenerConfig {
  port: number;
  host: string | undefined;
  certFile: string;
  keyFile: string;
  keyPassphraseFile: string | undefined;
  minVersion: 'TLSv1.2' | 'TLSv1.3';
  /** CAs named in the CertificateRequest. A hint only; never trusted. */
  handshakeCaFile: string | undefined;
}

export interface MtlsProxyConfig {
  /** Lower-case header name, as Node stores it. */
  certHeader: string;
  format: ProxyCertFormat;
  chainHeader: string | undefined;
  trustedProxies: CidrMatcher;
  untrustedHeaderAction: UntrustedHeaderAction;
}

/**
 * Certificate client authentication settings (RFC 8705). Everything is off
 * unless `MTLS_ENABLED=true`; with it off, the listener and the proxy header
 * are `null` and no request carries a certificate.
 */
export interface MtlsConfig {
  enabled: boolean;
  listener: MtlsListenerConfig | null;
  proxy: MtlsProxyConfig | null;
  /** https origin advertised in `mtls_endpoint_aliases`. */
  baseUrl: string | undefined;
  globalTrustAnchorsFile: string | undefined;
  maxCertHeaderBytes: number;
  maxChainDepth: number;
  authFailureLimitPerMinute: number;
}

export class MtlsConfigError extends Error {
  constructor(message: string) {
    super(`Invalid mTLS configuration: ${message}`);
    this.name = 'MtlsConfigError';
  }
}

const DEFAULT_MAX_CERT_HEADER_BYTES = 16 * 1024;
const DEFAULT_MAX_CHAIN_DEPTH = 5;
const DEFAULT_AUTH_FAILURE_LIMIT_PER_MINUTE = 20;

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
}

function readBoolean(env: Env, name: string): boolean {
  const value = read(env, name);
  if (value === undefined) return false;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new MtlsConfigError(`${name} must be true or false, got "${value}"`);
}

function readInt(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = read(env, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new MtlsConfigError(
      `${name} must be an integer from ${min} to ${max}, got "${value}"`,
    );
  }
  return Number(value);
}

function readEnum<T extends string>(
  env: Env,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = read(env, name);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new MtlsConfigError(
      `${name} must be one of ${allowed.join(', ')}, got "${value}"`,
    );
  }
  return value as T;
}

function readHeaderName(env: Env, name: string): string | undefined {
  const value = read(env, name);
  if (value === undefined) return undefined;
  // RFC 9110 token characters.
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) {
    throw new MtlsConfigError(`${name} is not a valid header name: "${value}"`);
  }
  return value.toLowerCase();
}

/**
 * Reads and validates the `MTLS_*` variables. Throws {@link MtlsConfigError}
 * on any setting that is unsafe or incomplete, so the process refuses to
 * start rather than run with a half-configured trust boundary.
 *
 * Every setting is validated even while `MTLS_ENABLED` is off, so turning it
 * on later cannot surface a configuration error in production.
 */
export function loadMtlsConfig(env: Env = process.env): MtlsConfig {
  const enabled = readBoolean(env, 'MTLS_ENABLED');

  // ── Direct TLS listener ─────────────────────────────────────────────────
  const portText = read(env, 'MTLS_LISTEN_PORT');
  let listener: MtlsListenerConfig | null = null;
  if (portText !== undefined) {
    const port = readInt(env, 'MTLS_LISTEN_PORT', 0, 0, 65535);
    const certFile = read(env, 'MTLS_TLS_CERT_FILE');
    const keyFile = read(env, 'MTLS_TLS_KEY_FILE');
    if (!certFile || !keyFile) {
      throw new MtlsConfigError(
        'MTLS_LISTEN_PORT needs both MTLS_TLS_CERT_FILE and MTLS_TLS_KEY_FILE',
      );
    }
    listener = {
      port,
      host: read(env, 'MTLS_LISTEN_HOST'),
      certFile,
      keyFile,
      keyPassphraseFile: read(env, 'MTLS_TLS_KEY_PASSPHRASE_FILE'),
      minVersion: readEnum(
        env,
        'MTLS_TLS_MIN_VERSION',
        ['TLSv1.2', 'TLSv1.3'] as const,
        'TLSv1.2',
      ),
      handshakeCaFile: read(env, 'MTLS_HANDSHAKE_CA_FILE'),
    };
  } else {
    for (const name of [
      'MTLS_LISTEN_HOST',
      'MTLS_TLS_CERT_FILE',
      'MTLS_TLS_KEY_FILE',
      'MTLS_TLS_KEY_PASSPHRASE_FILE',
      'MTLS_HANDSHAKE_CA_FILE',
    ]) {
      if (read(env, name) !== undefined) {
        throw new MtlsConfigError(`${name} is set but MTLS_LISTEN_PORT is not`);
      }
    }
  }

  // ── Certificate header from a TLS-terminating proxy ─────────────────────
  const certHeader = readHeaderName(env, 'MTLS_PROXY_CERT_HEADER');
  const chainHeader = readHeaderName(env, 'MTLS_PROXY_CERT_CHAIN_HEADER');
  const cidrs = read(env, 'MTLS_TRUSTED_PROXY_CIDRS');
  let proxy: MtlsProxyConfig | null = null;
  if (certHeader !== undefined) {
    if (cidrs === undefined) {
      throw new MtlsConfigError(
        'MTLS_PROXY_CERT_HEADER needs MTLS_TRUSTED_PROXY_CIDRS: only a proxy ' +
          'you trust may tell the server which certificate a client presented',
      );
    }
    let trustedProxies: CidrMatcher;
    try {
      trustedProxies = CidrMatcher.parse(cidrs);
    } catch (err) {
      if (err instanceof CidrListError) {
        throw new MtlsConfigError(`MTLS_TRUSTED_PROXY_CIDRS: ${err.message}`);
      }
      throw err;
    }
    if (chainHeader === certHeader) {
      throw new MtlsConfigError(
        'MTLS_PROXY_CERT_CHAIN_HEADER must differ from MTLS_PROXY_CERT_HEADER',
      );
    }
    proxy = {
      certHeader,
      format: readEnum(
        env,
        'MTLS_PROXY_CERT_FORMAT',
        ['pem-urlencoded', 'rfc9440'] as const,
        'pem-urlencoded',
      ),
      chainHeader,
      trustedProxies,
      untrustedHeaderAction: readEnum(
        env,
        'MTLS_PROXY_UNTRUSTED_HEADER_ACTION',
        ['reject', 'strip'] as const,
        'reject',
      ),
    };
  } else {
    for (const name of [
      'MTLS_PROXY_CERT_CHAIN_HEADER',
      'MTLS_PROXY_CERT_FORMAT',
      'MTLS_TRUSTED_PROXY_CIDRS',
      'MTLS_PROXY_UNTRUSTED_HEADER_ACTION',
    ]) {
      if (read(env, name) !== undefined) {
        throw new MtlsConfigError(
          `${name} is set but MTLS_PROXY_CERT_HEADER is not`,
        );
      }
    }
  }

  // ── Advertised aliases ──────────────────────────────────────────────────
  const baseUrl = read(env, 'MTLS_BASE_URL');
  if (baseUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new MtlsConfigError(`MTLS_BASE_URL is not a URL: "${baseUrl}"`);
    }
    if (url.protocol !== 'https:') {
      throw new MtlsConfigError(
        `MTLS_BASE_URL must be an https URL, got "${baseUrl}"`,
      );
    }
  }

  const config: MtlsConfig = {
    enabled,
    listener,
    proxy,
    baseUrl: baseUrl?.replace(/\/+$/, ''),
    globalTrustAnchorsFile: read(env, 'MTLS_GLOBAL_TRUST_ANCHORS_FILE'),
    maxCertHeaderBytes: readInt(
      env,
      'MTLS_MAX_CERT_HEADER_BYTES',
      DEFAULT_MAX_CERT_HEADER_BYTES,
      512,
      1024 * 1024,
    ),
    maxChainDepth: readInt(
      env,
      'MTLS_MAX_CHAIN_DEPTH',
      DEFAULT_MAX_CHAIN_DEPTH,
      1,
      10,
    ),
    authFailureLimitPerMinute: readInt(
      env,
      'MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE',
      DEFAULT_AUTH_FAILURE_LIMIT_PER_MINUTE,
      1,
      100_000,
    ),
  };

  // Validated above, inert until enabled.
  if (!enabled) {
    return { ...config, listener: null, proxy: null };
  }
  return config;
}

/**
 * Startup check, called from `main.ts` before the application is created.
 * Throws {@link MtlsConfigError} with a message that names the variable.
 */
export function validateMtlsConfig(env: Env = process.env): MtlsConfig {
  return loadMtlsConfig(env);
}
