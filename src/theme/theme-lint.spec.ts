import { readFileSync } from 'fs';
import { join } from 'path';
import { lintLoginTemplate, templateReads } from './theme-lint.js';

const FORM = '<form method="POST"><input name="password"></form>';

describe('lintLoginTemplate', () => {
  it('warns when the template never reads passkeyOnly or passwordFormHidden', () => {
    const warnings = lintLoginTemplate(`{{#if error}}{{error}}{{/if}}${FORM}`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does not read passkeyOnly/);
  });

  it.each([
    `{{#unless passkeyOnly}}${FORM}{{/unless}}`,
    `{{#unless passwordFormHidden}}${FORM}{{/unless}}`,
    `{{#if passkeyOnly}}<p>Use your passkey</p>{{else}}${FORM}{{/if}}`,
    `{{#each items}}{{#unless @root.passkeyOnly}}${FORM}{{/unless}}{{/each}}`,
    `{{#with realm}}{{#unless ../passwordFormHidden}}${FORM}{{/unless}}{{/with}}`,
    `{{#if (eq passkeyOnly false)}}${FORM}{{/if}}`,
    `{{#unless this.passkeyOnly}}${FORM}{{/unless}}`,
  ])('accepts a template that reads the flag: %s', (source) => {
    expect(lintLoginTemplate(source)).toEqual([]);
  });

  it('does not count a mention in a comment, or plain text', () => {
    expect(
      lintLoginTemplate(
        `{{!-- honours passkeyOnly --}}{{! passwordFormHidden }}<p>passkeyOnly</p>${FORM}`,
      ),
    ).toHaveLength(1);
  });

  it('does not count a different name that contains the flag', () => {
    expect(
      lintLoginTemplate(`{{#unless notPasskeyOnly}}${FORM}{{/unless}}`),
    ).toHaveLength(1);
  });

  it('reports a template that does not parse, instead of throwing', () => {
    const warnings = lintLoginTemplate('{{#if passkeyOnly}}unclosed');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does not parse/);
  });

  it.each(['idenplane', 'midnight'])(
    'passes the built-in %s login.hbs',
    (theme) => {
      const source = readFileSync(
        join(process.cwd(), 'themes', theme, 'login', 'templates', 'login.hbs'),
        'utf-8',
      );
      expect(lintLoginTemplate(source)).toEqual([]);
    },
  );
});

describe('templateReads', () => {
  it('reads helper arguments and hash values', () => {
    expect(templateReads('{{msg "x" flag=passkeyOnly}}', ['passkeyOnly'])).toBe(
      true,
    );
    expect(templateReads('{{msg passkeyOnly}}', ['passkeyOnly'])).toBe(true);
  });
});
