/**
 * Pure helpers for the Authentik importer: checking and unwrapping the
 * import file, and turning Authentik's field shapes into Idenplane's. No
 * Nest, no database, so each is tested on its own.
 */
import { IDP_ALIAS_PATTERN } from '../identity-providers/dto/create-identity-provider.dto.js';
import type {
  AuthentikExport,
  AuthentikOAuthSource,
  AuthentikRedirectUri,
  AuthentikUser,
} from './authentik-types.js';

export const AUTHENTIK_SECTIONS = [
  'users',
  'groups',
  'providers',
  'sources',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A section as Authentik's API returns it: the list itself, or a whole
 * paginated response whose `results` is the list.
 */
function sectionItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (isPlainObject(value) && Array.isArray(value['results'])) {
    return value['results'] as unknown[];
  }
  return null;
}

/**
 * What is wrong with an import file, one message per problem; empty when
 * it can be imported. Each section is optional; when present it must be a
 * list of objects, or a paginated response with such a list in `results`.
 */
export function authentikExportProblems(data: unknown): string[] {
  if (!isPlainObject(data)) return ['data must be an object'];
  const problems: string[] = [];
  for (const section of AUTHENTIK_SECTIONS) {
    const value = data[section];
    if (value === undefined || value === null) continue;
    const items = sectionItems(value);
    if (!items) {
      problems.push(
        `data.${section} must be an array, or an Authentik paginated response with a "results" array`,
      );
      continue;
    }
    const bad = items.findIndex((item) => !isPlainObject(item));
    if (bad !== -1) {
      problems.push(`data.${section}[${bad}] must be an object`);
    }
  }
  return problems;
}

/**
 * The import file with every section as a plain list. Sections that are
 * missing, or not a list (callers validate first), become empty lists.
 */
export function unwrapAuthentikExport(
  data: Record<string, unknown>,
): Required<AuthentikExport> {
  const list = <T>(section: (typeof AUTHENTIK_SECTIONS)[number]): T[] =>
    (sectionItems(data[section]) ?? []).filter(isPlainObject) as T[];
  return {
    users: list('users'),
    groups: list('groups'),
    providers: list('providers'),
    sources: list('sources'),
  };
}

/** An e-mail address to store: trimmed, with `""` (Authentik's "none") as null. */
export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  return trimmed === '' ? null : trimmed;
}

const SERVICE_ACCOUNT_TYPES = new Set([
  'service_account',
  'internal_service_account',
]);

/**
 * Why a user is not a person who signs in, or null when they are one:
 * Authentik's service accounts (outposts run as `internal_service_account`
 * users), service accounts from before user types existed (marked with an
 * attribute), and Django's `AnonymousUser` placeholder.
 */
export function authentikNonPersonReason(user: AuthentikUser): string | null {
  const type = (user.type ?? '').toLowerCase();
  if (SERVICE_ACCOUNT_TYPES.has(type)) {
    return `it is an Authentik ${type} (outposts and API integrations), not a person`;
  }
  if (user.attributes?.['goauthentik.io/user/service-account'] === true) {
    return 'it is an Authentik service account, not a person';
  }
  if (user.username?.startsWith('ak-outpost-')) {
    return 'it is an Authentik outpost account, not a person';
  }
  if (user.username === 'AnonymousUser') {
    return "it is Django's anonymous-user placeholder, not a person";
  }
  return null;
}

/** Characters that only make sense in a regular expression, never in a redirect URI. */
const REGEX_ONLY = /[*^$()[\]{}|\\+]/;

export interface RedirectUriPlan {
  /** Exact redirect URIs to store. */
  uris: string[];
  /** Entries left out, each with the reason. */
  skipped: { url: string; reason: string }[];
}

function checkedUrl(url: string): string | null {
  try {
    new URL(url);
    return null;
  } catch {
    return 'it is not an absolute URL';
  }
}

/**
 * An Authentik provider's `redirect_uris` in any of its shapes:
 * - a newline-separated string (before Authentik 2024.10, where a line
 *   could also be a regular expression);
 * - a list of `{ matching_mode, url }` (2024.10 and later);
 * - a list of URL strings.
 *
 * Idenplane matches redirect URIs exactly, so `strict` entries and plain
 * URLs are kept, and `regex` entries (or legacy lines with regex-only
 * characters) are left out, each with the reason.
 */
export function authentikRedirectUris(raw: unknown): RedirectUriPlan {
  const plan: RedirectUriPlan = { uris: [], skipped: [] };
  const keep = (url: string, legacyLine: boolean) => {
    if (legacyLine && REGEX_ONLY.test(url)) {
      plan.skipped.push({
        url,
        reason:
          'it looks like a regular expression, and Idenplane matches redirect URIs exactly',
      });
      return;
    }
    const problem = checkedUrl(url);
    if (problem) {
      plan.skipped.push({ url, reason: problem });
    } else if (!plan.uris.includes(url)) {
      plan.uris.push(url);
    }
  };

  if (typeof raw === 'string') {
    for (const line of raw.split(/\r?\n/)) {
      const url = line.trim();
      if (url) keep(url, true);
    }
    return plan;
  }
  if (!Array.isArray(raw)) return plan;
  for (const entry of raw as unknown[]) {
    if (typeof entry === 'string') {
      if (entry.trim()) keep(entry.trim(), false);
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const { matching_mode: mode, url } = entry as Partial<AuthentikRedirectUri>;
    if (typeof url !== 'string' || !url.trim()) continue;
    if (mode === undefined || mode === 'strict') {
      keep(url.trim(), false);
    } else if (mode === 'regex') {
      plan.skipped.push({
        url,
        reason:
          'it uses regex matching, and Idenplane matches redirect URIs exactly',
      });
    } else {
      plan.skipped.push({
        url,
        reason: `its matching mode "${String(mode)}" is unknown`,
      });
    }
  }
  return plan;
}

/** Lower-case, hyphen-separated, only `[a-z0-9-]`. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The identity provider alias for a source: its slug (which Authentik
 * already restricts to URL-safe characters), slugified if it has other
 * characters, else its slugified name. Null when neither gives an alias
 * the identity-provider API would accept.
 */
export function authentikSourceAlias(
  source: AuthentikOAuthSource,
): string | null {
  for (const candidate of [source.slug, source.name]) {
    if (typeof candidate !== 'string') continue;
    const alias = IDP_ALIAS_PATTERN.test(candidate)
      ? candidate
      : slugify(candidate);
    if (alias && IDP_ALIAS_PATTERN.test(alias)) return alias;
  }
  return null;
}

const WELL_KNOWN_SUFFIX = '/.well-known/openid-configuration';

/**
 * The issuer an OpenID Connect discovery URL belongs to (OpenID Connect
 * Discovery 1.0 §4: the URL is the issuer with this suffix appended), or
 * null when the URL does not end with the suffix.
 */
export function issuerFromWellKnownUrl(
  url: string | null | undefined,
): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed.endsWith(WELL_KNOWN_SUFFIX)) return null;
  const issuer = trimmed.slice(0, -WELL_KNOWN_SUFFIX.length);
  return checkedUrl(issuer) === null ? issuer : null;
}
