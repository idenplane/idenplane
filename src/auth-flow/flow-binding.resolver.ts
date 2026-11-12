import { Injectable } from '@nestjs/common';
import type { AuthenticationFlow, Client, Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isAuthFlowRuntimeEnabled } from './auth-flow-runtime.js';
import {
  validateFlowSteps,
  type FlowValidationError,
} from './flow-validator.js';

export type FlowBindingSource = 'client' | 'realm';

export type MisconfiguredReason = 'flow_not_found' | 'flow_invalid';

export type FlowBindingResolution =
  | { kind: 'legacy' }
  | { kind: 'bound'; flow: AuthenticationFlow; source: FlowBindingSource }
  | {
      kind: 'misconfigured';
      reason: MisconfiguredReason;
      flowId: string;
      source: FlowBindingSource;
      errors?: FlowValidationError[];
    };

export type ResolverRealm = Pick<
  Realm,
  'id' | 'authFlowsEnabled' | 'browserFlowId'
>;
export type ResolverClient = Pick<Client, 'authFlowId'>;

/**
 * Decides which authentication flow (if any) a login for `client` in `realm`
 * runs. Not called by the login path yet — the runtime that consumes it lands
 * separately behind AUTH_FLOW_RUNTIME_ENABLED.
 *
 * Resolution order (fixed by the design; do not reorder):
 *   1. AUTH_FLOW_RUNTIME_ENABLED unset            → legacy
 *   2. realm.authFlowsEnabled false               → legacy (even with bindings)
 *   3. client.authFlowId ?? realm.browserFlowId   → none → legacy
 *   4. load that flow *in this realm* and validate → any failure → misconfigured
 *
 * `misconfigured` must fail closed (the caller shows an error page). It never
 * falls back to legacy login, to `isDefault`, or to "any flow of the realm":
 * silently downgrading a bound client would weaken its login.
 */
@Injectable()
export class FlowBindingResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    realm: ResolverRealm,
    client: ResolverClient | null | undefined,
  ): Promise<FlowBindingResolution> {
    if (!isAuthFlowRuntimeEnabled()) return { kind: 'legacy' };
    if (!realm.authFlowsEnabled) return { kind: 'legacy' };

    const clientFlowId = client?.authFlowId ?? null;
    const flowId = clientFlowId ?? realm.browserFlowId ?? null;
    if (!flowId) return { kind: 'legacy' };
    const source: FlowBindingSource = clientFlowId ? 'client' : 'realm';

    const flow = await this.prisma.authenticationFlow.findFirst({
      where: { id: flowId, realmId: realm.id },
    });
    if (!flow) {
      return {
        kind: 'misconfigured',
        reason: 'flow_not_found',
        flowId,
        source,
      };
    }

    const errors = validateFlowSteps(flow.steps);
    if (errors.length > 0) {
      return {
        kind: 'misconfigured',
        reason: 'flow_invalid',
        flowId,
        source,
        errors,
      };
    }

    return { kind: 'bound', flow, source };
  }
}
