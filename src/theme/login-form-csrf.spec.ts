import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every POST form rendered by a theme's `login` or `account` templates must
 * embed the `_csrf` hidden field (the double-submit token validated by
 * CsrfService). Regression guards for:
 *   - #22: `login/device.hbs` omitted it, so device approve/deny → 403.
 *   - #24: `account/totp-setup.hbs` (and the other account forms) omitted it,
 *     and the corresponding controllers never called validateCsrf — every
 *     account self-service POST (incl. password change & delete-account) was
 *     missing its layered CSRF defense.
 */
describe('theme POST forms embed the CSRF field', () => {
  const themesRoot = join(process.cwd(), 'themes');
  const themes = readdirSync(themesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Subtrees of each theme that render user-facing forms — both must embed _csrf.
  const themeSubtrees = ['login', 'account'] as const;

  const cases: Array<{
    theme: string;
    subtree: string;
    file: string;
    content: string;
  }> = [];
  for (const theme of themes) {
    for (const subtree of themeSubtrees) {
      const dir = join(themesRoot, theme, subtree, 'templates');
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.hbs'));
      } catch {
        continue; // theme/subtree absent
      }
      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf8');
        if (/<form[^>]*method=["']POST["']/i.test(content)) {
          cases.push({ theme, subtree, file, content });
        }
      }
    }
  }

  it('discovers POST-form templates to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    '$theme/$subtree/$file includes name="_csrf"',
    ({ content }) => {
      expect(content).toContain('name="_csrf"');
    },
  );
});
