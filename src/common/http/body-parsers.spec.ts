import {
  IMPORT_JSON_BODY_LIMIT,
  JSON_BODY_LIMIT,
  SCIM_JSON_BODY_LIMIT,
  isImportRequest,
  isScimRequest,
} from './body-parsers.js';

describe('isImportRequest', () => {
  it.each([
    '/admin/realms/import',
    '/admin/realms/import?overwrite=true',
    '/admin/migration/keycloak',
    '/admin/migration/auth0',
    '/admin/migration/zitadel',
    '/admin/migration/authentik/',
    '/api/v1/admin/realms/import',
    '/api/v2/admin/migration/keycloak',
  ])('POST %s gets the import limit', (url) => {
    expect(isImportRequest({ method: 'POST', url })).toBe(true);
  });

  it.each([
    ['POST', '/admin/realms'],
    ['POST', '/admin/realms/import-x'],
    ['POST', '/admin/realms/demo/import'],
    ['POST', '/admin/migration/other'],
    ['POST', '/realms/demo/admin/realms/import'],
    ['POST', '/x/admin/realms/import'],
    ['PUT', '/admin/realms/import'],
    ['GET', '/admin/migration/keycloak'],
  ])('%s %s keeps the default limit', (method, url) => {
    expect(isImportRequest({ method, url })).toBe(false);
  });

  it('the limits are the documented ones', () => {
    expect(JSON_BODY_LIMIT).toBe('100kb');
    expect(IMPORT_JSON_BODY_LIMIT).toBe('10mb');
  });
});

describe('isScimRequest', () => {
  it.each([
    '/scim/v2/acme/Groups/g-1',
    '/scim/v2/acme/Bulk',
    '/SCIM/v2/acme/Users?x=1',
  ])('%s gets the SCIM limit', (url) => {
    expect(isScimRequest({ url })).toBe(true);
  });

  it.each(['/scim', '/admin/realms/acme/scim/tokens', '/x/scim/v2/acme/Users'])(
    '%s keeps the default limit',
    (url) => {
      expect(isScimRequest({ url })).toBe(false);
    },
  );

  it('is 1 MiB, the Bulk maxPayloadSize', () => {
    expect(SCIM_JSON_BODY_LIMIT).toBe(1024 * 1024);
  });
});
