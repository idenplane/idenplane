import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';
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
 * realm and user exports and get {@link IMPORT_JSON_BODY_LIMIT}, and SCIM
 * ({@link isScimRequest}), which gets {@link SCIM_JSON_BODY_LIMIT}: a PUT
 * of a group lists every member, and that is the `maxPayloadSize` the
 * ServiceProviderConfig advertises for Bulk. A larger body is answered
 * with 413. Keeping the small limit everywhere else bounds
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
 * The JSON body limit of the SCIM endpoints, in bytes; equal to the
 * ServiceProviderConfig's `bulk.maxPayloadSize`.
 */
export const SCIM_JSON_BODY_LIMIT = 1024 * 1024;

/** The SCIM endpoints, `/scim/v2/...`. */
export function isScimRequest(req: Pick<Request, 'url'>): boolean {
  return /^\/scim\/v2\//i.test(req.url ?? '');
}

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
  const scim = json({ type: JSON_MEDIA_TYPES, limit: SCIM_JSON_BODY_LIMIT });
  // The name is load-bearing: NestJS looks for a middleware called
  // `jsonParser` to decide not to add its own (see above).
  app.use(function jsonParser(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const parser = isImportRequest(req)
      ? imports
      : isScimRequest(req)
        ? scim
        : standard;
    parser(req, res, next);
  });
}
