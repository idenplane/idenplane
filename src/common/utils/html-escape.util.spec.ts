import { escapeHtml } from './html-escape.util';

describe('escapeHtml', () => {
  it('escapes all HTML metacharacters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml(`"&'<>`)).toBe('&quot;&amp;&#39;&lt;&gt;');
  });

  it('neutralizes an attribute-breakout payload', () => {
    // A User-Agent / display name like this must not be able to close the
    // double-quoted href and inject an onerror handler.
    const payload = '"><img src=x onerror=alert(1)>';
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('"');
    expect(escaped).not.toContain('<');
    expect(escaped).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('handles null/undefined as empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Acme Corp')).toBe('Acme Corp');
  });
});
