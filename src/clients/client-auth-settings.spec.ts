import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  clientAuthSettingsProblem,
  type ClientAuthSettings,
} from './client-auth-settings.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

const base: ClientAuthSettings = {
  clientType: 'CONFIDENTIAL',
  tokenEndpointAuthMethod: null,
  tlsClientAuthSubjectDn: null,
  tlsClientAuthSanDns: null,
  tlsClientAuthSanUri: null,
  tlsClientAuthSanIp: null,
  tlsClientAuthSanEmail: null,
};

const problem = (settings: Partial<ClientAuthSettings>) =>
  clientAuthSettingsProblem({ ...base, ...settings });

describe('clientAuthSettingsProblem', () => {
  it('accepts the legacy null method for both types', () => {
    expect(problem({})).toBeUndefined();
    expect(problem({ clientType: 'PUBLIC' })).toBeUndefined();
  });

  it('accepts tls_client_auth with exactly one rule', () => {
    expect(
      problem({
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSanUri: 'spiffe://example.com/a',
      }),
    ).toBeUndefined();
  });

  it('refuses tls_client_auth with no rule or two', () => {
    expect(problem({ tokenEndpointAuthMethod: 'tls_client_auth' })).toMatch(
      /exactly one.*0 set/,
    );
    expect(
      problem({
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSanDns: 'a.example',
        tlsClientAuthSubjectDn: 'CN=a',
      }),
    ).toMatch(/2 set/);
  });

  it('accepts self_signed_tls_client_auth before any certificate is registered', () => {
    expect(
      problem({ tokenEndpointAuthMethod: 'self_signed_tls_client_auth' }),
    ).toBeUndefined();
  });

  it('refuses rules with any other method', () => {
    expect(
      problem({
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
        tlsClientAuthSanDns: 'a.example',
      }),
    ).toMatch(/only to tls_client_auth/);
    expect(problem({ tlsClientAuthSanDns: 'a.example' })).toMatch(
      /only to tls_client_auth/,
    );
  });

  it('keeps method and client type consistent', () => {
    expect(problem({ tokenEndpointAuthMethod: 'none' })).toMatch(/PUBLIC/);
    for (const method of [
      'client_secret_basic',
      'client_secret_post',
      'tls_client_auth',
      'self_signed_tls_client_auth',
    ] as const) {
      expect(
        problem({ clientType: 'PUBLIC', tokenEndpointAuthMethod: method }),
      ).toMatch(/CONFIDENTIAL/);
    }
    expect(
      problem({ clientType: 'PUBLIC', tokenEndpointAuthMethod: 'none' }),
    ).toBeUndefined();
  });
});

describe('client DTO validation', () => {
  const errors = async (body: Record<string, unknown>, dto = CreateClientDto) =>
    (
      await validate(
        plainToInstance(dto, { clientId: 'my-client', ...body }) as object,
      )
    ).map((e) => e.property);

  it('accepts every method and null', async () => {
    for (const method of [
      'client_secret_basic',
      'client_secret_post',
      'none',
      'tls_client_auth',
      'self_signed_tls_client_auth',
      null,
    ]) {
      expect(await errors({ tokenEndpointAuthMethod: method })).toEqual([]);
    }
  });

  it('refuses an unknown method', async () => {
    expect(
      await errors({ tokenEndpointAuthMethod: 'private_key_jwt' }),
    ).toEqual(['tokenEndpointAuthMethod']);
  });

  it.each([
    [
      'tlsClientAuthSubjectDn',
      'CN=device-1,O=Example\\, Inc.,C=US',
      'CN=a;O=b',
    ],
    ['tlsClientAuthSanDns', 'device-1.example.com', '*.example.com'],
    ['tlsClientAuthSanUri', 'spiffe://example.com/w', 'not a uri'],
    ['tlsClientAuthSanIp', '2001:db8::1', '300.1.1.1'],
    ['tlsClientAuthSanEmail', 'a@example.com', 'no-at-sign'],
  ])(
    '%s: accepts a good value, refuses a bad one, takes null',
    async (field, good, bad) => {
      expect(await errors({ [field]: good })).toEqual([]);
      expect(await errors({ [field]: bad })).toEqual([field]);
      expect(await errors({ [field]: null }, UpdateClientDto)).toEqual([]);
    },
  );

  it('refuses an empty subject DN and a DNS name that is an IP', async () => {
    expect(await errors({ tlsClientAuthSubjectDn: '' })).toEqual([
      'tlsClientAuthSubjectDn',
    ]);
    expect(await errors({ tlsClientAuthSanDns: '10.0.0.1' })).toEqual([
      'tlsClientAuthSanDns',
    ]);
  });
});
