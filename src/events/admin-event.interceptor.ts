import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { EventsService } from './events.service.js';
import { ResourceType, OperationType } from './event-types.js';
import type { OperationTypeValue, ResourceTypeValue } from './event-types.js';

const RESOURCE_TYPE_MAP: Array<{ pattern: RegExp; type: ResourceTypeValue }> = [
  // More-specific patterns must come before broader ones to avoid mis-classification.
  // e.g. /saml-service-providers before /service-accounts, /client-scopes before /clients
  {
    pattern: /\/saml-service-providers/,
    type: ResourceType.SAML_SERVICE_PROVIDER,
  },
  { pattern: /\/service-accounts/, type: ResourceType.SERVICE_ACCOUNT },
  { pattern: /\/client-scopes/, type: ResourceType.SCOPE },
  { pattern: /\/identity-providers/, type: ResourceType.IDP },
  { pattern: /\/user-federation/, type: ResourceType.USER_FEDERATION },
  { pattern: /\/custom-attributes/, type: ResourceType.CUSTOM_ATTRIBUTE },
  { pattern: /\/risk-assessments/, type: ResourceType.RISK_ASSESSMENT },
  { pattern: /\/auth-flows/, type: ResourceType.AUTH_FLOW },
  { pattern: /\/organizations/, type: ResourceType.ORGANIZATION },
  { pattern: /\/brute-force/, type: ResourceType.BRUTE_FORCE },
  { pattern: /\/webhooks/, type: ResourceType.WEBHOOK },
  { pattern: /\/policies/, type: ResourceType.AUTHORIZATION_POLICY },
  { pattern: /\/impersonat/, type: ResourceType.IMPERSONATION },
  { pattern: /\/sessions/, type: ResourceType.SESSION },
  { pattern: /\/plugins/, type: ResourceType.PLUGIN },
  { pattern: /\/migration/, type: ResourceType.MIGRATION },
  // Broad single-segment patterns last
  { pattern: /\/users/, type: ResourceType.USER },
  { pattern: /\/clients/, type: ResourceType.CLIENT },
  { pattern: /\/roles/, type: ResourceType.ROLE },
  { pattern: /\/groups/, type: ResourceType.GROUP },
  { pattern: /\/realms/, type: ResourceType.REALM },
];

const METHOD_TO_OPERATION: Record<string, OperationTypeValue> = {
  POST: OperationType.CREATE,
  PUT: OperationType.UPDATE,
  PATCH: OperationType.UPDATE,
  DELETE: OperationType.DELETE,
};

@Injectable()
export class AdminEventInterceptor implements NestInterceptor {
  constructor(private readonly eventsService: EventsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      return next.handle();
    if (!request.path.startsWith('/admin/')) return next.handle();

    // Skip events API and auth endpoints
    if (
      request.path.includes('/events') ||
      request.path.includes('/admin-events')
    ) {
      return next.handle();
    }
    if (request.path.includes('/admin/auth/')) return next.handle();

    type AdminRequest = Request & {
      realm?: { id: string };
      adminUser?: { userId?: string; id?: string };
    };
    const adminReq = request as AdminRequest;
    const realm = adminReq.realm;
    const adminUser = adminReq.adminUser;

    if (!realm || !adminUser) return next.handle();

    const operationType = METHOD_TO_OPERATION[method];
    if (!operationType) return next.handle();

    const resourceType = this.resolveResourceType(request.path);
    if (!resourceType) return next.handle();

    const representation =
      method !== 'DELETE' ? this.redactBody(request.body) : undefined;

    return next.handle().pipe(
      tap(() => {
        this.eventsService.recordAdminEvent({
          realmId: realm.id,
          adminUserId: adminUser.userId ?? adminUser.id ?? 'api-key',
          operationType,
          resourceType,
          resourcePath: request.path,
          representation,
          ipAddress: request.ip,
        });
      }),
    );
  }

  private resolveResourceType(path: string): ResourceTypeValue | null {
    for (const entry of RESOURCE_TYPE_MAP) {
      if (entry.pattern.test(path)) return entry.type;
    }
    return null;
  }

  private redactBody(body: unknown): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const redacted: Record<string, unknown> = {
      ...(body as Record<string, unknown>),
    };
    const sensitiveKeys = [
      'password',
      'clientSecret',
      'smtpPassword',
      'client_secret',
      'currentPassword',
      'newPassword',
    ];
    for (const key of sensitiveKeys) {
      if (key in redacted) redacted[key] = '[REDACTED]';
    }
    return redacted;
  }
}
