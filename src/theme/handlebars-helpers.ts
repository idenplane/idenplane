import hbs from 'hbs';

/**
 * Registers Handlebars helpers for the theme engine i18n system.
 * Must be called once during app bootstrap (in main.ts).
 */
export function registerHandlebarsHelpers(): void {
  // {{msg "loginTitle"}} — simple message lookup
  hbs.registerHelper('msg', function (key: string, options: any) {
    const messages: Record<string, string> =
      options?.data?.root?._messages ?? {};
    return messages[key] ?? key;
  });

  // {{msgArgs "consentRequesting" clientName}} — message with argument substitution
  // Supports {0}, {1}, ... placeholders in the message string
  hbs.registerHelper('msgArgs', function (key: string, ...args: any[]) {
    const options = args.pop(); // Handlebars passes options as last arg
    const messages: Record<string, string> =
      options?.data?.root?._messages ?? {};
    let text = messages[key] ?? key;

    for (let i = 0; i < args.length; i++) {
      text = text.replace(`{${i}}`, String(args[i] ?? ''));
    }

    return text;
  });

  // {{#if_eq a b}}...{{else}}...{{/if_eq}} — equality block helper
  hbs.registerHelper(
    'if_eq',
    function (this: unknown, a: unknown, b: unknown, options: any) {
      if (a === b) {
        return options.fn(this);
      }
      return options.inverse(this);
    },
  );
}
