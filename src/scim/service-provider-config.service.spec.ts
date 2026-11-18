import { ScimServiceProviderConfigService } from './service-provider-config.service';
import { SCIM_JSON_BODY_LIMIT } from '../common/http/body-parsers';
import type { ScimSchemaAttribute } from './types/scim.types';

const service = new ScimServiceProviderConfigService();

const names = (attributes: ScimSchemaAttribute[]) =>
  attributes.map((a) => a.name);

describe('SCIM discovery', () => {
  describe('ServiceProviderConfig', () => {
    const config = service.getConfig('acme');

    it('claims exactly what works', () => {
      expect(config.patch).toEqual({ supported: true });
      expect(config.changePassword).toEqual({ supported: true });
      expect(config.sort).toEqual({ supported: false });
      expect(config.etag).toEqual({ supported: false });
      expect(config.filter).toMatchObject({ supported: true, maxResults: 100 });
    });

    it("advertises Bulk's payload limit as the body limit SCIM enforces", () => {
      expect(config.bulk).toEqual({
        supported: true,
        maxOperations: 1000,
        maxPayloadSize: SCIM_JSON_BODY_LIMIT,
      });
    });

    it('lists only the bearer token scheme the guard accepts', () => {
      expect(config.authenticationSchemes?.map((s) => s.type)).toEqual([
        'oauthbearertoken',
      ]);
    });

    it('carries meta with the realm URL it was asked at', () => {
      expect(config.meta).toEqual({
        resourceType: 'ServiceProviderConfig',
        location: expect.stringMatching(
          /\/scim\/v2\/acme\/ServiceProviderConfig$/,
        ) as string,
      });
    });
  });

  describe('Schemas', () => {
    const user = service.getSchemaById(
      'urn:ietf:params:scim:schemas:core:2.0:User',
    )!;

    it('describes password as write-only and never returned', () => {
      expect(user.attributes.find((a) => a.name === 'password')).toMatchObject({
        mutability: 'writeOnly',
        returned: 'never',
      });
    });

    it('lists only the attributes that are stored', () => {
      expect(names(user.attributes)).not.toEqual(
        expect.arrayContaining(['ims']),
      );
      for (const absent of [
        'ims',
        'photos',
        'entitlements',
        'roles',
        'x509Certificates',
      ]) {
        expect(names(user.attributes)).not.toContain(absent);
      }
      expect(names(user.attributes)).toEqual(
        expect.arrayContaining([
          'userName',
          'name',
          'displayName',
          'emails',
          'phoneNumbers',
          'addresses',
          'active',
          'groups',
          'externalId',
        ]),
      );
    });

    it('marks returned attributes as returned', () => {
      const groups = user.attributes.find((a) => a.name === 'groups')!;
      expect(groups.returned).toBe('default');
      expect(groups.mutability).toBe('readOnly');
      const emails = user.attributes.find((a) => a.name === 'emails')!;
      expect(
        emails.subAttributes?.find((a) => a.name === 'primary')?.returned,
      ).toBe('default');
    });

    it('gives every attribute the characteristics RFC 7643 §7 lists', () => {
      const walk = (attributes: ScimSchemaAttribute[]) => {
        for (const a of attributes) {
          expect(a).toEqual(
            expect.objectContaining({
              name: expect.any(String) as string,
              type: expect.any(String) as string,
              multiValued: expect.any(Boolean) as boolean,
              required: expect.any(Boolean) as boolean,
              mutability: expect.any(String) as string,
              returned: expect.any(String) as string,
              description: expect.any(String) as string,
            }),
          );
          if (a.subAttributes) walk(a.subAttributes);
        }
      };
      for (const schema of service.getSchemas()) walk(schema.attributes);
    });

    it('finds schemas and resource types case-insensitively, with meta', () => {
      expect(
        service.getSchemaById(
          'URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER',
        )?.name,
      ).toBe('EnterpriseUser');
      expect(service.getResourceTypeByName('user')?.meta).toEqual({
        resourceType: 'ResourceType',
        location: expect.stringMatching(
          /\/scim\/v2\/ResourceTypes\/User$/,
        ) as string,
      });
    });

    it('does not let a caller modify the published schemas', () => {
      const copy = service.getSchemas()[0];
      copy.attributes.length = 0;
      expect(service.getSchemas()[0].attributes.length).toBeGreaterThan(0);
    });
  });
});
