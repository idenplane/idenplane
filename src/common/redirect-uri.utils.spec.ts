import {
  matchesRedirectUri,
  matchesReturnUrl,
  redirectUriListProblem,
  wildcardRedirectUris,
} from './redirect-uri.utils.js';

describe('matchesRedirectUri', () => {
  const CB = 'https://app.example.com/callback';

  describe('exact matching (default since 0.11.0)', () => {
    it('accepts the registered URI', () => {
      expect(matchesRedirectUri(CB, [CB])).toBe(true);
    });

    it('refuses a non-string value, such as a repeated redirect_uri parameter', () => {
      const repeated = [CB, 'https://evil.example.com/'] as unknown as string;
      expect(matchesRedirectUri(repeated, [CB])).toBe(false);
      expect(
        matchesRedirectUri(repeated, ['https://app.example.com/*'], {
          allowWildcard: true,
        }),
      ).toBe(false);
      expect(matchesRedirectUri(undefined as unknown as string, [CB])).toBe(
        false,
      );
    });

    it('accepts when any registered URI matches', () => {
      expect(matchesRedirectUri(CB, ['https://other.example.com/cb', CB])).toBe(
        true,
      );
    });

    it('rejects another host', () => {
      expect(matchesRedirectUri('https://evil.example/callback', [CB])).toBe(
        false,
      );
    });

    it('rejects a trailing slash either way', () => {
      expect(matchesRedirectUri(`${CB}/`, [CB])).toBe(false);
      expect(matchesRedirectUri(CB, [`${CB}/`])).toBe(false);
      expect(
        matchesRedirectUri('https://app.example.com', [
          'https://app.example.com/',
        ]),
      ).toBe(false);
    });

    it('compares scheme and host case-sensitively (no normalisation)', () => {
      expect(matchesRedirectUri('HTTPS://app.example.com/callback', [CB])).toBe(
        false,
      );
      expect(matchesRedirectUri('https://APP.example.com/callback', [CB])).toBe(
        false,
      );
      expect(matchesRedirectUri('https://app.example.com/Callback', [CB])).toBe(
        false,
      );
    });

    it('rejects a different port, scheme or default port spelled out', () => {
      expect(
        matchesRedirectUri('https://app.example.com:8443/callback', [CB]),
      ).toBe(false);
      expect(matchesRedirectUri('http://app.example.com/callback', [CB])).toBe(
        false,
      );
      expect(
        matchesRedirectUri('https://app.example.com:443/callback', [CB]),
      ).toBe(false);
    });

    it('rejects path traversal and encoding tricks', () => {
      for (const uri of [
        'https://app.example.com/callback/../admin',
        'https://app.example.com/callback/..',
        'https://app.example.com/callback/./',
        'https://app.example.com/callback%2F..%2Fadmin',
        'https://app.example.com/callback%2e%2e',
        'https://app.example.com/callback\\..\\admin',
        'https://app.example.com/%63allback',
        'https://app.example.com/callback@evil.example',
        'https://app.example.com.evil.example/callback',
        'https://app.example.com@evil.example/callback',
      ]) {
        expect(matchesRedirectUri(uri, [CB])).toBe(false);
      }
    });

    it('rejects an added query string, and accepts a registered one exactly', () => {
      expect(matchesRedirectUri(`${CB}?next=/admin`, [CB])).toBe(false);
      expect(matchesRedirectUri(`${CB}?a=1`, [`${CB}?a=1`])).toBe(true);
      expect(matchesRedirectUri(`${CB}?a=2`, [`${CB}?a=1`])).toBe(false);
      expect(matchesRedirectUri(`${CB}?a=1&b=2`, [`${CB}?a=1`])).toBe(false);
    });

    it('refuses fragments, even when registered verbatim', () => {
      expect(matchesRedirectUri(`${CB}#x`, [CB])).toBe(false);
      expect(matchesRedirectUri(`${CB}#x`, [`${CB}#x`])).toBe(false);
      expect(matchesRedirectUri(`${CB}#`, [CB])).toBe(false);
      expect(
        matchesRedirectUri(`${CB}#x`, ['https://app.example.com/*'], {
          allowWildcard: true,
        }),
      ).toBe(false);
    });

    it('treats a /* entry as a literal string without the opt-in', () => {
      const wild = 'http://localhost:4000/*';
      expect(matchesRedirectUri('http://localhost:4000/callback', [wild])).toBe(
        false,
      );
      expect(matchesRedirectUri('http://localhost:4000', [wild])).toBe(false);
      expect(
        matchesRedirectUri('http://localhost:4000/callback', [wild], {
          allowWildcard: false,
        }),
      ).toBe(false);
    });

    it('accepts nothing when nothing is registered', () => {
      expect(matchesRedirectUri(CB, [])).toBe(false);
    });
  });

  describe('loopback redirect URIs (RFC 8252 §7.3)', () => {
    it('accepts any port on 127.0.0.1 and [::1]', () => {
      expect(
        matchesRedirectUri('http://127.0.0.1:51234/cb', [
          'http://127.0.0.1/cb',
        ]),
      ).toBe(true);
      expect(
        matchesRedirectUri('http://127.0.0.1:1/cb', [
          'http://127.0.0.1:8080/cb',
        ]),
      ).toBe(true);
      expect(
        matchesRedirectUri('http://[::1]:65535/cb', ['http://[::1]/cb']),
      ).toBe(true);
      expect(
        matchesRedirectUri('http://127.0.0.1/cb', ['http://127.0.0.1:9/cb']),
      ).toBe(true);
    });

    it('still requires the rest to match exactly', () => {
      const reg = ['http://127.0.0.1/cb'];
      expect(matchesRedirectUri('http://127.0.0.1:5000/cb/', reg)).toBe(false);
      expect(matchesRedirectUri('http://127.0.0.1:5000/other', reg)).toBe(
        false,
      );
      expect(matchesRedirectUri('http://127.0.0.1:5000/cb?x=1', reg)).toBe(
        false,
      );
      expect(matchesRedirectUri('https://127.0.0.1:5000/cb', reg)).toBe(false);
      expect(matchesRedirectUri('http://[::1]:5000/cb', reg)).toBe(false);
      expect(matchesRedirectUri('http://127.0.0.1:5000/cb#x', reg)).toBe(false);
    });

    it('rejects invalid ports and lookalike hosts', () => {
      const reg = ['http://127.0.0.1/cb'];
      expect(matchesRedirectUri('http://127.0.0.1:0/cb', reg)).toBe(false);
      expect(matchesRedirectUri('http://127.0.0.1:65536/cb', reg)).toBe(false);
      expect(matchesRedirectUri('http://127.0.0.1:99999/cb', reg)).toBe(false);
      expect(
        matchesRedirectUri('http://127.0.0.1.evil.example:80/cb', reg),
      ).toBe(false);
      expect(
        matchesRedirectUri('http://127.0.0.1:80@evil.example/cb', reg),
      ).toBe(false);
    });

    it('gives localhost no port exception (RFC 8252 §8.3)', () => {
      expect(
        matchesRedirectUri('http://localhost:5000/cb', ['http://localhost/cb']),
      ).toBe(false);
      expect(
        matchesRedirectUri('http://localhost:3000/cb', [
          'http://localhost:3000/cb',
        ]),
      ).toBe(true);
    });
  });

  describe('insecure wildcard opt-in (allowInsecureWildcardRedirectUris)', () => {
    const wild = ['http://localhost:4000/*'];
    const opt = { allowWildcard: true };

    it('matches paths below the base and the bare base', () => {
      expect(
        matchesRedirectUri('http://localhost:4000/callback', wild, opt),
      ).toBe(true);
      expect(
        matchesRedirectUri('http://localhost:4000/auth/code', wild, opt),
      ).toBe(true);
      expect(matchesRedirectUri('http://localhost:4000', wild, opt)).toBe(true);
      expect(
        matchesRedirectUri('http://localhost:4000/cb?next=%2Fhome', wild, opt),
      ).toBe(true);
    });

    it('stays on the registered origin', () => {
      expect(
        matchesRedirectUri('http://localhost:4001/callback', wild, opt),
      ).toBe(false);
      expect(
        matchesRedirectUri('https://localhost:4000/callback', wild, opt),
      ).toBe(false);
    });

    it('stays below the registered path', () => {
      const app = ['https://app.example.com/app/*'];
      for (const uri of [
        'https://app.example.com/app/../admin',
        'https://app.example.com/app/./x/../../admin',
        'https://app.example.com/app/%2e%2e/admin',
        'https://app.example.com/app/..%2Fadmin',
        'https://app.example.com/app/x%2F..%2F..%2Fadmin',
        'https://app.example.com/app/..\\admin',
        'https://app.example.com/application',
        'https://app.example.com/admin',
      ]) {
        expect(matchesRedirectUri(uri, app, opt)).toBe(false);
      }
      expect(
        matchesRedirectUri('https://app.example.com/app/x/cb', app, opt),
      ).toBe(true);
    });

    it('still matches exact entries next to wildcards', () => {
      const uris = [CB, 'http://localhost:3000/*'];
      expect(matchesRedirectUri(CB, uris, opt)).toBe(true);
      expect(matchesRedirectUri('http://localhost:3000/auth', uris, opt)).toBe(
        true,
      );
    });
  });
});

describe('redirectUriListProblem', () => {
  it('accepts exact URIs', () => {
    expect(
      redirectUriListProblem('redirectUris', ['https://a.example/cb'], false),
    ).toBeNull();
    expect(redirectUriListProblem('redirectUris', undefined, false)).toBeNull();
  });

  it('refuses a wildcard without the opt-in, naming the opt-in', () => {
    const problem = redirectUriListProblem(
      'redirectUris',
      ['https://a.example/*'],
      false,
    );
    expect(problem).toContain('allowInsecureWildcardRedirectUris');
    expect(problem).toContain('https://a.example/*');
  });

  it('accepts a trailing /* with the opt-in, and no other *', () => {
    expect(
      redirectUriListProblem('redirectUris', ['https://a.example/*'], true),
    ).toBeNull();
    expect(
      redirectUriListProblem('redirectUris', ['https://*.a.example/cb'], true),
    ).toContain('only a trailing');
    expect(
      redirectUriListProblem('redirectUris', ['https://a.example/*/*'], true),
    ).toContain('only a trailing');
  });

  it('refuses fragments', () => {
    expect(
      redirectUriListProblem(
        'postLogoutRedirectUris',
        ['https://a.example/cb#x'],
        true,
      ),
    ).toContain('fragment');
  });
});

describe('wildcardRedirectUris', () => {
  it('lists the /* entries', () => {
    expect(
      wildcardRedirectUris([
        'https://a.example/cb',
        'https://a.example/*',
        '*',
      ]),
    ).toEqual(['https://a.example/*']);
  });
});

describe('matchesReturnUrl (forward-auth return URLs)', () => {
  it('keeps /* prefix matching for proxy applications', () => {
    const allowed = ['https://grafana.example.com/*'];
    expect(
      matchesReturnUrl('https://grafana.example.com/d/abc?x=1', allowed),
    ).toBe(true);
    expect(matchesReturnUrl('https://grafana.example.com', allowed)).toBe(true);
    expect(matchesReturnUrl('https://evil.example/', allowed)).toBe(false);
  });
});
