import Handlebars from 'handlebars';

/**
 * Login-template values that tell a theme the current step does not take a
 * password: `passkeyOnly` (a passkey step with no password fallback) and
 * `passwordFormHidden` (any such step: passkey or social). A theme that
 * gates its password form on either one hides it when it should.
 */
export const PASSWORD_FORM_FLAGS: readonly string[] = [
  'passkeyOnly',
  'passwordFormHidden',
];

/** Collects the names every path expression of a template reads. */
class PathCollector extends Handlebars.Visitor {
  readonly names = new Set<string>();

  PathExpression(path: hbs.AST.PathExpression): void {
    for (const part of path.parts) this.names.add(part);
  }
}

/**
 * True when the template reads at least one of `names` in an expression
 * (`{{#if passkeyOnly}}`, `{{#unless passwordFormHidden}}`, a helper
 * argument, `@root.passkeyOnly`...). Comments do not count: the template is
 * parsed, never searched as text. Throws when it does not parse.
 */
export function templateReads(
  source: string,
  names: readonly string[],
): boolean {
  const collector = new PathCollector();
  collector.accept(Handlebars.parse(source));
  return names.some((name) => collector.names.has(name));
}

/**
 * Warnings for a theme's own `login.hbs` (not errors: the theme still
 * works, and the server answers a password posted on a passkey-only step
 * with the page again and a message, without ending the sign-in).
 */
export function lintLoginTemplate(source: string): string[] {
  let reads: boolean;
  try {
    reads = templateReads(source, PASSWORD_FORM_FLAGS);
  } catch (err) {
    return [
      `login.hbs does not parse as a Handlebars template: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    ];
  }
  if (reads) return [];
  return [
    'login.hbs does not read passkeyOnly (or passwordFormHidden), so it shows its password form on a passkey-only step of a custom auth flow. ' +
      'Wrap the password form in {{#unless passwordFormHidden}} (or {{#unless passkeyOnly}}), as the built-in themes do.',
  ];
}
