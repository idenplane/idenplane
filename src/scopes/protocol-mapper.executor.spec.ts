import {
  ProtocolMapperExecutor,
  type MapperContext,
} from './protocol-mapper.executor.js';
import type { ProtocolMapper } from '@prisma/client';

describe('ProtocolMapperExecutor', () => {
  let executor: ProtocolMapperExecutor;
  const context: MapperContext = {
    userId: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    emailVerified: true,
    firstName: 'Test',
    lastName: 'User',
    realmRoles: ['admin', 'user'],
    resourceAccess: { 'my-client': { roles: ['client-role'] } },
  };

  beforeEach(() => {
    executor = new ProtocolMapperExecutor();
  });

  describe('oidc-usermodel-attribute-mapper', () => {
    it('should map username attribute to JWT claim', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-1',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'username-mapper',
        config: {
          'user.attribute': 'username',
          'claim.name': 'preferred_username',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        preferred_username: 'testuser',
      });
    });

    it('should map email attribute to JWT claim', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-2',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'email-mapper',
        config: {
          'user.attribute': 'email',
          'claim.name': 'email',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        email: 'test@example.com',
      });
    });

    it('should map emailVerified attribute to JWT claim', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-3',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'email-verified-mapper',
        config: {
          'user.attribute': 'emailVerified',
          'claim.name': 'email_verified',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        email_verified: true,
      });
    });

    it('should map firstName attribute to JWT claim', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-4',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'first-name-mapper',
        config: {
          'user.attribute': 'firstName',
          'claim.name': 'given_name',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        given_name: 'Test',
      });
    });

    it('should map lastName attribute to JWT claim', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-5',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'last-name-mapper',
        config: {
          'user.attribute': 'lastName',
          'claim.name': 'family_name',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        family_name: 'User',
      });
    });

    it('should not add claim when user attribute is null', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-6',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'email-mapper',
        config: {
          'user.attribute': 'email',
          'claim.name': 'email',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const contextWithNullEmail: MapperContext = {
        ...context,
        email: null,
      };

      const payload = {};
      executor.executeMappers([mapper], contextWithNullEmail, payload);

      expect(payload).toEqual({});
    });

    it('should not add claim when user.attribute is missing from config', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-7',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'invalid-mapper',
        config: {
          'claim.name': 'some_claim',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({});
    });

    it('should not add claim when claim.name is missing from config', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-8',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        name: 'invalid-mapper',
        config: {
          'user.attribute': 'username',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({});
    });
  });

  describe('oidc-hardcoded-claim-mapper', () => {
    it('should add hardcoded string value to JWT', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-9',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-hardcoded-claim-mapper',
        name: 'hardcoded-mapper',
        config: {
          'claim.name': 'custom_claim',
          'claim.value': 'hardcoded-value',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        custom_claim: 'hardcoded-value',
      });
    });

    it('should add hardcoded empty string value to JWT', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-10',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-hardcoded-claim-mapper',
        name: 'hardcoded-empty-mapper',
        config: {
          'claim.name': 'empty_claim',
          'claim.value': '',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        empty_claim: '',
      });
    });

    it('should not add claim when claim.name is missing', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-11',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-hardcoded-claim-mapper',
        name: 'invalid-hardcoded-mapper',
        config: {
          'claim.value': 'some-value',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({});
    });

    it('should not add claim when claim.value is missing', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-12',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-hardcoded-claim-mapper',
        name: 'invalid-hardcoded-mapper',
        config: {
          'claim.name': 'some_claim',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({});
    });
  });

  describe('oidc-role-list-mapper', () => {
    it('should add realm roles to JWT with default claim name', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-13',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-role-list-mapper',
        name: 'role-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        realm_access: { roles: ['admin', 'user'] },
        resource_access: { 'my-client': { roles: ['client-role'] } },
      });
    });

    it('should add realm roles with explicit realm_access claim name', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-14',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-role-list-mapper',
        name: 'role-mapper',
        config: {
          'claim.name': 'realm_access',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        realm_access: { roles: ['admin', 'user'] },
        resource_access: { 'my-client': { roles: ['client-role'] } },
      });
    });

    it('should not add roles when claim name is not realm_access', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-15',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-role-list-mapper',
        name: 'role-mapper',
        config: {
          'claim.name': 'custom_roles',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({});
    });
  });

  describe('oidc-audience-mapper', () => {
    it('should add audience claim when payload is empty', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-16',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-audience-mapper',
        name: 'audience-mapper',
        config: {
          'included.client.audience': 'my-api',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        aud: 'my-api',
      });
    });

    it('should convert string audience to array when adding new audience', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-17',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-audience-mapper',
        name: 'audience-mapper',
        config: {
          'included.client.audience': 'my-api',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = { aud: 'existing-audience' };
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        aud: ['existing-audience', 'my-api'],
      });
    });

    it('should append to existing array audience', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-18',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-audience-mapper',
        name: 'audience-mapper',
        config: {
          'included.client.audience': 'my-api',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = { aud: ['audience-1', 'audience-2'] };
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        aud: ['audience-1', 'audience-2', 'my-api'],
      });
    });

    it('should not add audience when included.client.audience is missing', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-19',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-audience-mapper',
        name: 'invalid-audience-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({});
    });
  });

  describe('oidc-full-name-mapper', () => {
    it('should add full name from firstName and lastName', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-20',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-full-name-mapper',
        name: 'full-name-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = {};
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        name: 'Test User',
      });
    });

    it('should add only firstName when lastName is null', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-21',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-full-name-mapper',
        name: 'full-name-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const contextWithoutLastName: MapperContext = {
        ...context,
        lastName: null,
      };

      const payload = {};
      executor.executeMappers([mapper], contextWithoutLastName, payload);

      expect(payload).toEqual({
        name: 'Test',
      });
    });

    it('should add only lastName when firstName is null', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-22',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-full-name-mapper',
        name: 'full-name-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const contextWithoutFirstName: MapperContext = {
        ...context,
        firstName: null,
      };

      const payload = {};
      executor.executeMappers([mapper], contextWithoutFirstName, payload);

      expect(payload).toEqual({
        name: 'User',
      });
    });

    it('should not add name when both firstName and lastName are null', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-23',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'oidc-full-name-mapper',
        name: 'full-name-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const contextWithoutName: MapperContext = {
        ...context,
        firstName: null,
        lastName: null,
      };

      const payload = {};
      executor.executeMappers([mapper], contextWithoutName, payload);

      expect(payload).toEqual({});
    });
  });

  describe('executeMappers with multiple mappers', () => {
    it('should execute multiple mappers in sequence', () => {
      const mappers: ProtocolMapper[] = [
        {
          id: 'mapper-24',
          clientScopeId: 'scope-1',
          protocol: 'openid-connect',
          mapperType: 'oidc-usermodel-attribute-mapper',
          name: 'username-mapper',
          config: {
            'user.attribute': 'username',
            'claim.name': 'preferred_username',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'mapper-25',
          clientScopeId: 'scope-1',
          protocol: 'openid-connect',
          mapperType: 'oidc-hardcoded-claim-mapper',
          name: 'hardcoded-mapper',
          config: {
            'claim.name': 'custom_claim',
            'claim.value': 'custom-value',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'mapper-26',
          clientScopeId: 'scope-1',
          protocol: 'openid-connect',
          mapperType: 'oidc-full-name-mapper',
          name: 'full-name-mapper',
          config: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const payload = {};
      executor.executeMappers(mappers, context, payload);

      expect(payload).toEqual({
        preferred_username: 'testuser',
        custom_claim: 'custom-value',
        name: 'Test User',
      });
    });

    it('should return the modified payload', () => {
      const mappers: ProtocolMapper[] = [
        {
          id: 'mapper-27',
          clientScopeId: 'scope-1',
          protocol: 'openid-connect',
          mapperType: 'oidc-usermodel-attribute-mapper',
          name: 'email-mapper',
          config: {
            'user.attribute': 'email',
            'claim.name': 'email',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const payload = { existing: 'value' };
      const result = executor.executeMappers(mappers, context, payload);

      expect(result).toBe(payload);
      expect(result).toEqual({
        existing: 'value',
        email: 'test@example.com',
      });
    });
  });

  describe('unknown mapper types', () => {
    it('should ignore unknown mapper types', () => {
      const mapper: ProtocolMapper = {
        id: 'mapper-28',
        clientScopeId: 'scope-1',
        protocol: 'openid-connect',
        mapperType: 'unknown-mapper-type',
        name: 'unknown-mapper',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = { existing: 'value' };
      executor.executeMappers([mapper], context, payload);

      expect(payload).toEqual({
        existing: 'value',
      });
    });
  });
});
