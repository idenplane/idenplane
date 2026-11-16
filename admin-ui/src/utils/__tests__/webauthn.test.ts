import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64urlToBuffer, bufferToBase64url, createPasskey, getPasskey } from '../webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe('base64url', () => {
  it('round-trips bytes, without padding or URL-unsafe characters', () => {
    const input = bytes(251, 255, 191, 0, 1);
    const encoded = bufferToBase64url(input);
    expect(encoded).toBe('-_-_AAE');
    expect(new Uint8Array(base64urlToBuffer(encoded))).toEqual(new Uint8Array(input));
  });
});

describe('passkey ceremonies', () => {
  const original = navigator.credentials;
  afterEach(() => {
    Object.defineProperty(navigator, 'credentials', { value: original, configurable: true });
  });

  function fakeCredential(response: Record<string, unknown>) {
    return {
      id: 'cred-id',
      rawId: bytes(1, 2, 3),
      type: 'public-key',
      response,
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({}),
    };
  }

  it('turns registration options into browser types and the result into JSON', async () => {
    const create = vi.fn().mockResolvedValue(
      fakeCredential({
        clientDataJSON: bytes(4),
        attestationObject: bytes(5),
        getTransports: () => ['internal'],
      }),
    );
    Object.defineProperty(navigator, 'credentials', { value: { create }, configurable: true });

    const result = await createPasskey({
      challenge: 'AQID',
      rp: { id: 'localhost', name: 'x' },
      user: { id: 'dXNlcg', name: 'admin', displayName: 'admin' },
      excludeCredentials: [{ id: 'AQ', transports: ['usb'] }],
    });

    const publicKey = create.mock.calls[0][0].publicKey;
    expect(new Uint8Array(publicKey.challenge)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(publicKey.user.id)).toBe('user');
    expect(publicKey.excludeCredentials[0]).toMatchObject({ type: 'public-key', transports: ['usb'] });
    expect(result).toMatchObject({
      id: 'cred-id',
      rawId: 'AQID',
      response: { clientDataJSON: 'BA', attestationObject: 'BQ', transports: ['internal'] },
    });
  });

  it('turns an assertion into JSON', async () => {
    const get = vi.fn().mockResolvedValue(
      fakeCredential({
        clientDataJSON: bytes(4),
        authenticatorData: bytes(5),
        signature: bytes(6),
        userHandle: bytes(7),
      }),
    );
    Object.defineProperty(navigator, 'credentials', { value: { get }, configurable: true });
    const result = await getPasskey({ challenge: 'AQID', allowCredentials: [{ id: 'AQ' }] });
    expect(result).toMatchObject({
      response: { clientDataJSON: 'BA', authenticatorData: 'BQ', signature: 'Bg', userHandle: 'Bw' },
    });
  });

  it('fails when the browser returns no credential', async () => {
    Object.defineProperty(navigator, 'credentials', {
      value: { get: vi.fn().mockResolvedValue(null) },
      configurable: true,
    });
    await expect(getPasskey({ challenge: 'AQID' })).rejects.toThrow('No passkey');
  });
});
