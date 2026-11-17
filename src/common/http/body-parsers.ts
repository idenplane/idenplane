import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';
import { SCIM_CONTENT_TYPE } from '../../scim/types/scim.types.js';

/**
 * Body parsers on top of NestJS's defaults (JSON and URL-encoded).
 *
 * The default JSON parser only reads `application/json`. SCIM clients
 * (Entra ID, Okta, OneLogin…) send `application/scim+json`, as RFC 7644 §3.1
 * requires, so without this their request bodies were never parsed and every
 * SCIM create, replace and patch failed.
 *
 * This parser REPLACES the default JSON one rather than adding to it: at
 * init NestJS skips its own JSON parser when a middleware named `jsonParser`
 * (which this is) is already registered. So it must list `application/json`
 * too.
 *
 * Size limits: {@link JSON_BODY_LIMIT} (body-parser's default) everywhere,
 * except the import endpoints ({@link isImportRequest}), which take whole
 * realm and user exports and get {@link IMPORT_JSON_BODY_LIMIT}. A larger
 * body is answered with 413. Keeping the small limit everywhere else bounds
 * what any unauthenticated request can make the server buffer and parse;
 * the import endpoints are admin-only, but the body is read before the
 * admin guard runs, so the larger limit is kept to these routes.
 *
 * Shared by main.ts and the e2e test app so the two cannot drift.
 */
export const JSON_MEDIA_TYPES = ['application/json', SCIM_CONTENT_TYPE];

/** The JSON body limit of every endpoint but the import ones. */
export const JSON_BODY_LIMIT = '100kb';

/** The JSON body limit of realm import and user migration. */
export const IMPORT_JSON_BODY_LIMIT = '10mb';

/**
 * `POST /admin/realms/import` and `POST /admin/migration/{keycloak,auth0,
 * zitadel,authentik}`, also under a URI version prefix (`/api/v1/...`).
 */
const IMPORT_PATH =
  /^(?:\/api\/v\d+)?\/admin\/(?:realms\/import|migration\/(?:keycloak|auth0|zitadel|authentik))\/?$/i;

export function isImportRequest(req: Pick<Request, 'method' | 'url'>): boolean {
  if (req.method !== 'POST') return false;
  const path = (req.url ?? '').split('?')[0];
  return IMPORT_PATH.test(path);
}

export function registerBodyParsers(app: NestExpressApplication): void {
  const standard = json({ type: JSON_MEDIA_TYPES, limit: JSON_BODY_LIMIT });
  const imports = json({
    type: JSON_MEDIA_TYPES,
    limit: IMPORT_JSON_BODY_LIMIT,
  });
  // The name is load-bearing: NestJS looks for a middleware called
  // `jsonParser` to decide not to add its own (see above).
  app.use(function jsonParser(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    (isImportRequest(req) ? imports : standard)(req, res, next);
  });
}

/** The form body limit of every endpoint but the SAML broker's ACS. */
export const FORM_BODY_LIMIT = '100kb';

/**
 * The form body limit of a SAML ACS: a SAMLResponse may be up to 512 KB
 * (MAX_SAML_RESPONSE_LENGTH), plus the RelayState and form encoding.
 */
export const SAML_ACS_FORM_BODY_LIMIT = '600kb';

/** `POST /realms/{realm}/broker/{alias}/saml/acs`, also under a version prefix. */
const SAML_ACS_PATH =
  /^(?:\/api\/v\d+)?\/realms\/[^/]+\/broker\/[^/]+\/saml\/acs\/?$/i;

export function isSamlAcsRequest(
  req: Pick<Request, 'method' | 'url'>,
): boolean {
  if (req.method !== 'POST') return false;
  return SAML_ACS_PATH.test((req.url ?? '').split('?')[0]);
}

/**
 * Replaces NestJS's URL-encoded parser (same options: `extended`, 100 KB),
 * giving only the SAML ACS the larger limit. The name is load-bearing, as
 * for `jsonParser`.
 */
export function registerFormBodyParser(app: NestExpressApplication): void {
  const standard = urlencoded({ extended: true, limit: FORM_BODY_LIMIT });
  const samlAcs = urlencoded({
    extended: true,
    limit: SAML_ACS_FORM_BODY_LIMIT,
  });
  app.use(function urlencodedParser(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    (isSamlAcsRequest(req) ? samlAcs : standard)(req, res, next);
  });
}
