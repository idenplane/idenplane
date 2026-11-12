import { loadMtlsConfig, MtlsConfigError } from './mtls-config.js';

const proxyEnv = {
  MTLS_ENABLED: 'true',
  MTLS_PROXY_CERT_HEADER: 'X-Client-Cert',
  MTLS_TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
};

const listenerEnv = {
  MTLS_ENABLED: 'true',
  MTLS_LISTEN_PORT: '8443',
  MTLS_TLS_CERT_FILE: '/etc/idenplane/tls.crt',
  MTLS_TLS_KEY_FILE: '/etc/idenplane/tls.key',
};

describe('loadMtlsConfig', () => {
  it('turns everything off by default', () => {
    const config = loadMtlsConfig({});
    expect(config.enabled).toBe(false);
    expect(config.listener).toBeNull();
    expect(config.proxy).toBeNull();
    expect(config.baseUrl).toBeUndefined();
  });

  it('keeps the listener and proxy header off until MTLS_ENABLED is true', () => {
    const config = loadMtlsConfig({
      ...proxyEnv,
      ...listenerEnv,
      MTLS_ENABLED: 'false',
    });
    expect(config.listener).toBeNull();
    expect(config.proxy).toBeNull();
  });

  it('reads a complete proxy and listener configuration', () => {
    const config = loadMtlsConfig({
      ...proxyEnv,
      ...listenerEnv,
      MTLS_LISTEN_HOST: '127.0.0.1',
      MTLS_PROXY_CERT_FORMAT: 'rfc9440',
      MTLS_PROXY_UNTRUSTED_HEADER_ACTION: 'strip',
      MTLS_BASE_URL: 'https://mtls.example.com/',
    });
    expect(config.enabled).toBe(true);
    expect(config.proxy?.certHeader).toBe('x-client-cert');
    expect(config.proxy?.format).toBe('rfc9440');
    expect(config.proxy?.untrustedHeaderAction).toBe('strip');
    expect(config.proxy?.trustedProxies.contains('10.1.1.1')).toBe(true);
    expect(config.listener).toMatchObject({
      port: 8443,
      host: '127.0.0.1',
      minVersion: 'TLSv1.2',
    });
    expect(config.baseUrl).toBe('https://mtls.example.com');
  });

  it('defaults to rejecting an untrusted header', () => {
    expect(loadMtlsConfig(proxyEnv).proxy?.untrustedHeaderAction).toBe(
      'reject',
    );
  });

  it('refuses a certificate header without MTLS_TRUSTED_PROXY_CIDRS', () => {
    expect(() =>
      loadMtlsConfig({
        MTLS_ENABLED: 'true',
        MTLS_PROXY_CERT_HEADER: 'X-Client-Cert',
      }),
    ).toThrow(/MTLS_TRUSTED_PROXY_CIDRS/);
  });

  it('refuses a certificate header without CIDRs even while disabled', () => {
    expect(() =>
      loadMtlsConfig({ MTLS_PROXY_CERT_HEADER: 'X-Client-Cert' }),
    ).toThrow(MtlsConfigError);
  });

  it.each(['*', '0.0.0.0/0', '::/0', '10.0.0.0/8, *'])(
    'refuses MTLS_TRUSTED_PROXY_CIDRS=%s',
    (cidrs) => {
      expect(() =>
        loadMtlsConfig({ ...proxyEnv, MTLS_TRUSTED_PROXY_CIDRS: cidrs }),
      ).toThrow(/MTLS_TRUSTED_PROXY_CIDRS.*every address/);
    },
  );

  it.each(['MTLS_TLS_CERT_FILE', 'MTLS_TLS_KEY_FILE'])(
    'refuses a listener port without %s',
    (missing) => {
      const env: Record<string, string> = { ...listenerEnv };
      delete env[missing];
      expect(() => loadMtlsConfig(env)).toThrow(
        /MTLS_TLS_CERT_FILE and MTLS_TLS_KEY_FILE/,
      );
    },
  );

  it.each(['http://mtls.example.com', 'ftp://mtls.example.com', 'not a url'])(
    'refuses MTLS_BASE_URL=%s',
    (baseUrl) => {
      expect(() => loadMtlsConfig({ MTLS_BASE_URL: baseUrl })).toThrow(
        /MTLS_BASE_URL/,
      );
    },
  );

  it.each([
    [{ MTLS_ENABLED: 'maybe' }, /MTLS_ENABLED/],
    [{ ...listenerEnv, MTLS_LISTEN_PORT: '70000' }, /MTLS_LISTEN_PORT/],
    [{ ...listenerEnv, MTLS_TLS_MIN_VERSION: 'TLSv1' }, /MTLS_TLS_MIN_VERSION/],
    [{ ...proxyEnv, MTLS_PROXY_CERT_FORMAT: 'xfcc' }, /MTLS_PROXY_CERT_FORMAT/],
    [
      { ...proxyEnv, MTLS_PROXY_UNTRUSTED_HEADER_ACTION: 'ignore' },
      /MTLS_PROXY_UNTRUSTED_HEADER_ACTION/,
    ],
    [
      { ...proxyEnv, MTLS_PROXY_CERT_HEADER: 'bad header' },
      /MTLS_PROXY_CERT_HEADER/,
    ],
    [
      { ...proxyEnv, MTLS_PROXY_CERT_CHAIN_HEADER: 'x-client-cert' },
      /must differ/,
    ],
    [
      { MTLS_TRUSTED_PROXY_CIDRS: '10.0.0.0/8' },
      /MTLS_PROXY_CERT_HEADER is not/,
    ],
    [{ MTLS_TLS_CERT_FILE: '/x' }, /MTLS_LISTEN_PORT is not/],
    [{ MTLS_MAX_CHAIN_DEPTH: '0' }, /MTLS_MAX_CHAIN_DEPTH/],
  ])('refuses %j', (env, message) => {
    expect(() => loadMtlsConfig(env)).toThrow(message);
  });
});
