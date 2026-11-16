import type { NestExpressApplication } from '@nestjs/platform-express';
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
 * too. The size limit stays body-parser's default, as before.
 *
 * Shared by main.ts and the e2e test app so the two cannot drift.
 */
export const JSON_MEDIA_TYPES = ['application/json', SCIM_CONTENT_TYPE];

export function registerBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { type: JSON_MEDIA_TYPES });
}
