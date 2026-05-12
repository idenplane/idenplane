import { of } from 'rxjs';
import { AdminEventInterceptor } from './admin-event.interceptor.js';
import { ResourceType, OperationType } from './event-types.js';

describe('AdminEventInterceptor', () => {
  let interceptor: AdminEventInterceptor;
  let eventsService: { recordAdminEvent: jest.Mock };

  beforeEach(() => {
    eventsService = { recordAdminEvent: jest.fn() };
    interceptor = new AdminEventInterceptor(eventsService as any);
  });

  function createContext(overrides: {
    method?: string;
    path?: string;
    body?: any;
    realm?: any;
    adminUser?: any;
    ip?: string;
  }) {
    const request = {
      method: overrides.method ?? 'POST',
      path: overrides.path ?? '/admin/realms/test/users',
      body: 'body' in overrides ? overrides.body : {},
      ip: overrides.ip ?? '127.0.0.1',
      realm: 'realm' in overrides ? overrides.realm : { id: 'realm-1' },
      adminUser:
        'adminUser' in overrides ? overrides.adminUser : { userId: 'admin-1' },
    };
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    };
  }

  const nextHandler = { handle: () => of('response') };

  describe('intercept', () => {
    it('should record admin event for POST /admin/...users', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith({
            realmId: 'realm-1',
            adminUserId: 'admin-1',
            operationType: OperationType.CREATE,
            resourceType: ResourceType.USER,
            resourcePath: '/admin/realms/test/users',
            representation: {},
            ipAddress: '127.0.0.1',
          });
          done();
        },
      });
    });

    it('should record UPDATE for PUT method', (done) => {
      const context = createContext({
        method: 'PUT',
        path: '/admin/realms/test/clients/c1',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              operationType: OperationType.UPDATE,
              resourceType: ResourceType.CLIENT,
            }),
          );
          done();
        },
      });
    });

    it('should record UPDATE for PATCH method', (done) => {
      const context = createContext({
        method: 'PATCH',
        path: '/admin/realms/test/roles/r1',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              operationType: OperationType.UPDATE,
              resourceType: ResourceType.ROLE,
            }),
          );
          done();
        },
      });
    });

    it('should record DELETE without representation', (done) => {
      const context = createContext({
        method: 'DELETE',
        path: '/admin/realms/test/groups/g1',
        body: { some: 'data' },
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              operationType: OperationType.DELETE,
              resourceType: ResourceType.GROUP,
              representation: undefined,
            }),
          );
          done();
        },
      });
    });

    it('should detect SCOPE resource type for client-scopes paths', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/client-scopes',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: ResourceType.SCOPE }),
          );
          done();
        },
      });
    });

    it('should detect IDP resource type for identity-providers paths', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/identity-providers',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: ResourceType.IDP }),
          );
          done();
        },
      });
    });

    // ─── Skip cases ──────────────────────────────────

    it('should skip GET requests', (done) => {
      const context = createContext({
        method: 'GET',
        path: '/admin/realms/test/users',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip non-admin paths', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/realms/test/login',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip events API paths', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/events',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip admin-events API paths', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/admin-events',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip admin auth paths', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/auth/login',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip when realm is not set', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
        realm: null,
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip when adminUser is not set', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
        adminUser: null,
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should fall back to REALM resource type for unrecognized paths under /realms/', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/unknown-resource',
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: ResourceType.REALM }),
          );
          done();
        },
      });
    });

    // ─── Redaction ───────────────────────────────────

    it('should redact sensitive fields in body', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
        body: {
          username: 'newuser',
          password: 'secret123',
          clientSecret: 'my-secret',
          smtpPassword: 'smtp-pass',
          client_secret: 'cs',
          currentPassword: 'old',
          newPassword: 'new',
        },
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          const call = eventsService.recordAdminEvent.mock.calls[0][0];
          expect(call.representation).toEqual({
            username: 'newuser',
            password: '[REDACTED]',
            clientSecret: '[REDACTED]',
            smtpPassword: '[REDACTED]',
            client_secret: '[REDACTED]',
            currentPassword: '[REDACTED]',
            newPassword: '[REDACTED]',
          });
          done();
        },
      });
    });

    it('should handle null body gracefully', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
        body: null,
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({ representation: undefined }),
          );
          done();
        },
      });
    });

    it('should use adminUser.id as fallback when userId is missing', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
        adminUser: { id: 'admin-id-2' },
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({ adminUserId: 'admin-id-2' }),
          );
          done();
        },
      });
    });

    it('should use "api-key" when adminUser has no userId or id', (done) => {
      const context = createContext({
        method: 'POST',
        path: '/admin/realms/test/users',
        adminUser: {},
      });

      interceptor.intercept(context as any, nextHandler).subscribe({
        complete: () => {
          expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
            expect.objectContaining({ adminUserId: 'api-key' }),
          );
          done();
        },
      });
    });
  });
});
