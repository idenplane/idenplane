import { parseBasicClientCredentials } from './basic-client-auth.util.js';

const header = (raw: string) => `Basic ${Buffer.from(raw).toString('base64')}`;

describe('parseBasicClientCredentials', () => {
  it('ignores a missing header or another scheme', () => {
    expect(parseBasicClientCredentials(undefined)).toBeNull();
    expect(parseBasicClientCredentials('Bearer abc')).toBeNull();
  });

  it('form-decodes both parts (RFC 6749 §2.3.1)', () => {
    expect(parseBasicClientCredentials(header('my%20app:a+b%3Ac'))).toEqual({
      clientId: 'my app',
      clientSecret: 'a b:c',
    });
  });

  it('accepts a lower-case scheme', () => {
    expect(
      parseBasicClientCredentials(
        `basic ${Buffer.from('id:s').toString('base64')}`,
      ),
    ).toEqual({ clientId: 'id', clientSecret: 's' });
  });

  it('reports malformed credentials', () => {
    expect(parseBasicClientCredentials(header('no-separator'))).toBe(
      'malformed',
    );
    expect(parseBasicClientCredentials(header(':secret'))).toBe('malformed');
    expect(parseBasicClientCredentials(header('bad%zz:secret'))).toBe(
      'malformed',
    );
  });
});
