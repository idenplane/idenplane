import fc from 'fast-check';
import { escapeHtml } from './html-escape.util';

/**
 * Property-based tests for escapeHtml, which guards every user-controlled
 * value (display names, User-Agent strings, URLs...) placed into HTML emails.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** What an HTML parser reads back from the escaped text. */
const unescape = (html: string) =>
  html.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]);

/** Any text, weighted towards the characters that matter in HTML. */
const text = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 200 }),
  fc
    .array(
      fc.constantFrom(
        '<',
        '>',
        '"',
        "'",
        '&',
        '&amp;',
        '&lt;',
        '&#39;',
        '&#x3C;',
        '<script>',
        '"><img src=x onerror=alert(1)>',
        '`',
        '=',
        ' ',
        'a',
      ),
      { maxLength: 30 },
    )
    .map((parts) => parts.join('')),
);

describe('escapeHtml (property-based)', () => {
  it('leaves no character that could open a tag or end an attribute', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(escapeHtml(input)).not.toMatch(/[<>"']/);
      }),
      { numRuns: 500 },
    );
  });

  it('leaves every & starting one of its own entities', () => {
    fc.assert(
      fc.property(text, (input) => {
        const bareAmpersand = /&(?!(?:amp|lt|gt|quot|#39);)/;
        expect(escapeHtml(input)).not.toMatch(bareAmpersand);
      }),
      { numRuns: 500 },
    );
  });

  it('reads back as exactly the input', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(unescape(escapeHtml(input))).toBe(input);
      }),
      { numRuns: 500 },
    );
  });

  it('changes nothing in text without HTML-special characters', () => {
    fc.assert(
      fc.property(
        fc
          .string({ unit: 'binary', maxLength: 200 })
          .filter((s) => !/[&<>"']/.test(s)),
        (input) => {
          expect(escapeHtml(input)).toBe(input);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('renders numbers as their text, and null or undefined as nothing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double(),
          fc.integer(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (value) => {
          expect(escapeHtml(value)).toBe(
            value === null || value === undefined ? '' : String(value),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
