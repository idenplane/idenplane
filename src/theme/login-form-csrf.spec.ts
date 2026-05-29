import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every POST form rendered by a login theme must embed the `_csrf` hidden field
 * (the double-submit token validated by CsrfService). Regression guard for #22:
 * `device.hbs` omitted it, so every device approve/deny POST failed CSRF
 * validation (403) and the Device Authorization flow was unusable end-to-end.
 */
describe('login theme POST forms embed the CSRF field', () => {
  const themesRoot = join(process.cwd(), 'themes');
  const themes = readdirSync(themesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const cases: Array<{ theme: string; file: string; content: string }> = [];
  for (const theme of themes) {
    const dir = join(themesRoot, theme, 'login', 'templates');
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.hbs'));
    } catch {
      continue; // theme has no login templates
    }
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf8');
      if (/<form[^>]*method=["']POST["']/i.test(content)) {
        cases.push({ theme, file, content });
      }
    }
  }

  it('discovers POST-form templates to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('$theme/$file includes name="_csrf"', ({ content }) => {
    expect(content).toContain('name="_csrf"');
  });
});
