import {
  IMPORT_JSON_BODY_LIMIT,
  JSON_BODY_LIMIT,
  isImportRequest,
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
